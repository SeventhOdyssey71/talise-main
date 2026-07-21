import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { handleValid, sanitizeHandle, usernameApi, type UsernameReason } from "@/api/username";
import { FieldInput } from "@/components/wallet/FormField";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

type Status =
  | { kind: "empty" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "invalid" }
  | { kind: "taken" }
  | { kind: "reserved" }
  | { kind: "rpc" };

/** ClaimHandleSheet — pick a .talise.sui subname. */
export default function ClaimHandleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "empty" });
  const [claiming, setClaiming] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  const onChange = (raw: string) => {
    const u = sanitizeHandle(raw);
    setHandle(u);
    setClaimErr(null);
    if (debounce.current) clearTimeout(debounce.current);

    if (!u) {
      setStatus({ kind: "empty" });
      return;
    }
    if (!handleValid(u)) {
      setStatus({ kind: "invalid" });
      return;
    }
    setStatus({ kind: "checking" });
    debounce.current = setTimeout(async () => {
      try {
        const r = await usernameApi.check(u);
        if (r.available) {
          setStatus({ kind: "available" });
        } else {
          const reason = (r.reason ?? "") as UsernameReason;
          if (reason === "reserved") setStatus({ kind: "reserved" });
          else if (reason === "rpc") setStatus({ kind: "rpc" });
          else setStatus({ kind: "taken" });
        }
      } catch {
        setStatus({ kind: "rpc" });
      }
    }, 250);
  };

  const claim = async () => {
    setClaiming(true);
    setClaimErr(null);
    try {
      const r = await usernameApi.claim(handle);
      if (r.ok) setClaimed(true);
      else setClaimErr(r.error ?? "That name was just taken.");
    } catch (e) {
      setClaimErr(e instanceof Error ? e.message : "That name was just taken.");
    } finally {
      setClaiming(false);
    }
  };

  if (claimed) {
    return (
      <View style={styles.screen}>
        <View style={{ paddingTop: insets.top + spacing.md, padding: spacing.xl }}>
          <FlowHeader title="Claimed" onClose={() => router.back()} />
        </View>
        <View style={styles.successCenter}>
          <Icon name="checkmark.seal.fill" size={64} color={colors.greenMint} />
          <Text style={styles.successTitle}>Claimed</Text>
          <Text style={styles.successSub}>{handle}@talise.sui is yours.</Text>
        </View>
        <View style={styles.footer}>
          <TaliseButton title="Done" variant="primary" size="lg" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const canClaim = status.kind === "available" || status.kind === "rpc";

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22, flex: 1 }}>
        <FlowHeader eyebrow="Claim your name" title="Pick your Talise handle" onClose={() => router.back()} />
        <Text style={styles.subtitle}>
          People send to you with name@talise.sui — easier to share than a 0x address.
        </Text>

        <View style={{ gap: 8 }}>
          <View style={styles.inputRow}>
            <FieldInput
              value={handle}
              onChangeText={onChange}
              placeholder="yourname"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              autoFocus
              style={styles.input}
            />
            <Text style={styles.suffix}>@talise.sui</Text>
          </View>
          <StatusLine status={status} handle={handle} />
        </View>

        {claimErr ? <Text style={styles.claimErr}>{claimErr}</Text> : null}

        <View style={{ flex: 1 }} />

        <TaliseButton
          title={claiming ? "Claiming…" : `Claim ${handle || "handle"}@talise.sui`}
          variant="primary"
          size="lg"
          loading={claiming}
          disabled={!canClaim}
          onPress={claim}
        />
      </View>
    </View>
  );
}

function StatusLine({ status, handle }: { status: Status; handle: string }) {
  switch (status.kind) {
    case "empty":
      return null;
    case "checking":
      return <Text style={[styles.status, { color: colors.fgMuted }]}>Checking…</Text>;
    case "available":
      return <Text style={[styles.status, { color: colors.accent }]}>✓ {handle}@talise.sui is available.</Text>;
    case "invalid":
      return <Text style={[styles.status, { color: colors.danger }]}>✗ Use 3–20 lowercase letters, digits, or underscores.</Text>;
    case "taken":
      return <Text style={[styles.status, { color: colors.danger }]}>✗ Someone already claimed that name.</Text>;
    case "reserved":
      return <Text style={[styles.status, { color: colors.danger }]}>✗ That name is reserved.</Text>;
    case "rpc":
      return <Text style={[styles.status, { color: colors.fgMuted }]}>✗ Couldn&apos;t check on chain. Tap claim anyway.</Text>;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  subtitle: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: { flex: 1 },
  suffix: { fontFamily: family.mono, fontSize: 14, color: colors.fgMuted },

  status: { fontFamily: family.sans, fontSize: 13, lineHeight: 18 },
  claimErr: { fontFamily: family.sans, fontSize: 13, color: colors.danger },

  successCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: spacing.xl },
  successTitle: { fontFamily: family.sans, fontSize: 26, fontWeight: "500", color: colors.fg, letterSpacing: -0.6, marginTop: 6 },
  successSub: { fontFamily: family.mono, fontSize: 14, color: colors.fgMuted, textAlign: "center" },

  footer: { padding: spacing.xl, paddingBottom: 40 },
});
