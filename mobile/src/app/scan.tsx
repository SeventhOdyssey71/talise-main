import { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";

import { resolveRecipient, walletApi } from "@/api/wallet";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2 } from "@/lib/format";

/**
 * ScanToPayView — camera QR scan (+ manual @handle/address entry) → resolve →
 * ConfirmPaymentSheet. The live bank-account OCR path needs a native text-
 * recognition module (ML Kit); it stays deferred, with manual entry in its place.
 */
type Mode = "camera" | "manual";

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>("camera");
  const [manual, setManual] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [notCode, setNotCode] = useState(false);
  const locked = useRef(false);

  if (balance == null) walletApi.balances().then((b) => setBalance(b.usdsui)).catch(() => {});

  const goToConfirm = async (q: string, amount?: string) => {
    if (locked.current) return;
    locked.current = true;
    setResolving(true);
    try {
      const res = await resolveRecipient(q);
      router.replace({
        pathname: "/confirm-pay",
        params: { address: res.address, name: res.displayName ?? res.display ?? "", amount: amount ?? "" },
      });
    } catch {
      setNotCode(true);
      setResolving(false);
      locked.current = false;
      setTimeout(() => setNotCode(false), 1800);
    }
  };

  const onScan = ({ data }: { data: string }) => {
    const parsed = parseTarget(data);
    if (!parsed) {
      setNotCode(true);
      setTimeout(() => setNotCode(false), 1800);
      return;
    }
    void goToConfirm(parsed.q, parsed.amount);
  };

  const requestOrOpen = () => {
    if (permission && !permission.canAskAgain) Linking.openSettings();
    else requestPermission();
  };

  return (
    <View style={styles.screen}>
      {mode === "camera" && permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={locked.current ? undefined : onScan}
        />
      ) : null}
      <View style={styles.scrim} />

      {/* Top chrome */}
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.disc} hitSlop={8}>
          <Icon name="xmark" size={16} color={colors.fg} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Point &amp; pay</Text>
          <Text style={styles.subtitle}>QR codes, account numbers — one camera.</Text>
        </View>
        <View style={styles.modeToggle}>
          <ModeChip label="Camera" icon="viewfinder" on={mode === "camera"} onPress={() => setMode("camera")} />
          <ModeChip label="Type it in" icon="keyboard" on={mode === "manual"} onPress={() => setMode("manual")} />
        </View>
      </View>

      {/* Center */}
      {mode === "camera" ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.frame} />
        </View>
      ) : (
        <View style={styles.manual}>
          <Text style={styles.manualTitle}>Pay a @handle or address</Text>
          <TextInput
            value={manual}
            onChangeText={setManual}
            placeholder="@name or 0x…"
            placeholderTextColor={colors.fgDim}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.manualInput}
          />
          <Pressable
            style={[styles.continue, !manual.trim() && { opacity: 0.4 }]}
            disabled={!manual.trim()}
            onPress={() => goToConfirm(manual.trim().replace(/^@/, ""))}
          >
            <Text style={styles.continueText}>Continue</Text>
          </Pressable>
        </View>
      )}

      {/* Bottom */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        {balance != null ? (
          <View style={styles.balanceChip}>
            <View style={styles.dot} />
            <Text style={styles.balanceLabel}>Balance</Text>
            <Text style={styles.balanceValue}>{local2(balance)}</Text>
          </View>
        ) : null}
        {mode === "camera" && !permission?.granted ? (
          <Pressable style={styles.enable} onPress={requestOrOpen}>
            <Text style={styles.enableText}>Enable camera to scan</Text>
          </Pressable>
        ) : notCode ? (
          <Text style={styles.notCode}>Not a Talise payment code</Text>
        ) : resolving ? (
          <Text style={styles.caption}>Finding who to pay…</Text>
        ) : (
          <Text style={styles.caption}>Frame a Talise code — Talise reads it and sets up the payment.</Text>
        )}
      </View>
    </View>
  );
}

function ModeChip({ label, icon, on, onPress }: { label: string; icon: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Icon name={icon} size={13} color={on ? colors.greenMint : "rgba(255,255,255,0.6)"} />
      <Text style={[styles.chipText, { color: on ? colors.greenMint : "rgba(255,255,255,0.6)" }]}>{label}</Text>
    </Pressable>
  );
}

function parseTarget(data: string): { q: string; amount?: string } | null {
  const s = data.trim();
  const amountOf = (query?: string) => query?.split("&").find((p) => p.startsWith("amount="))?.slice(7);
  if (s.startsWith("sui:")) {
    const [addr, query] = s.slice(4).split("?");
    return { q: addr, amount: amountOf(query) };
  }
  if (s.startsWith("talise://pay/")) {
    const [handle, query] = s.slice("talise://pay/".length).split("?");
    return { q: handle, amount: amountOf(query) };
  }
  if (s.startsWith("0x") || /^@?[a-z0-9_.\-]{2,}$/i.test(s)) return { q: s.replace(/^@/, "") };
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.42)" },
  top: { paddingHorizontal: spacing.lg, gap: spacing.md },
  disc: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  titleWrap: { alignItems: "center", gap: 2 },
  title: { fontFamily: family.sans, fontSize: 20, fontWeight: "600", color: colors.fg },
  subtitle: { fontFamily: family.sans, fontSize: 12.5, fontWeight: "300", color: "rgba(255,255,255,0.65)" },
  modeToggle: { flexDirection: "row", alignSelf: "center", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" },
  chipOn: { backgroundColor: "rgba(202,255,184,0.14)" },
  chipText: { fontFamily: family.sans, fontSize: 12, fontWeight: "500" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { width: 268, height: 268, borderRadius: 28, borderWidth: 3, borderColor: colors.greenMint },
  manual: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
  manualTitle: { fontFamily: family.sans, fontSize: 18, fontWeight: "500", color: colors.fg },
  manualInput: { height: 54, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 16, fontFamily: family.sans, fontSize: 16, color: colors.fg },
  continue: { height: 54, borderRadius: 27, backgroundColor: colors.greenMint, alignItems: "center", justifyContent: "center" },
  continueText: { fontFamily: family.sans, fontSize: 15, fontWeight: "600", color: colors.inkOnAccent },
  bottom: { paddingHorizontal: spacing.xl, alignItems: "center", gap: spacing.md },
  balanceChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  balanceLabel: { fontFamily: family.mono, fontSize: 10, color: "rgba(255,255,255,0.6)" },
  balanceValue: { fontFamily: family.sans, fontSize: 14, fontWeight: "600", color: colors.fg },
  caption: { fontFamily: family.sans, fontSize: 12.5, fontWeight: "300", color: "rgba(255,255,255,0.65)", textAlign: "center" },
  notCode: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: "#FF6B6B" },
  enable: { backgroundColor: colors.greenMint, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  enableText: { fontFamily: family.sans, fontSize: 14, fontWeight: "600", color: colors.inkOnAccent },
});
