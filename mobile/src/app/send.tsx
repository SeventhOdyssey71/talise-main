import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getContacts, resolveRecipient, walletApi, type ContactDTO, type RecipientResolution } from "@/api/wallet";
import { signAndSubmitSend } from "@/auth/zklogin";
import { useSession } from "@/auth/session";
import { SendNumpad } from "@/components/wallet/SendNumpad";
import { SendingView } from "@/components/wallet/SendingView";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { Divider } from "@/design/components/Divider";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { Eyebrow, MicroLabel } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2, shortAddr, splitAmount } from "@/lib/format";

type Step = "amount" | "recipient" | "review" | "sending" | "complete" | "failure";
const MINT_INK = colors.inkOnAccent;

/** SendFlowView — same-currency send. Amount → Recipient → Review → Sending → Complete/Failure. */
export default function SendScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("amount");
  const [rawAmount, setRawAmount] = useState("");
  const [resolved, setResolved] = useState<RecipientResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);

  const amountUsd = Number(rawAmount) || 0;
  const close = () => router.back();

  const send = async () => {
    setStep("sending");
    setError(null);
    try {
      const res = await signAndSubmitSend(resolved!.address, amountUsd, "USDsui");
      setDigest(res.digest);
      setStep("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send didn't land on chain. No funds moved.");
      setStep("failure");
    }
  };

  if (step === "sending") return <SendingView onDone={close} />;
  if (step === "complete")
    return (
      <SuccessfulTxView
        title="Transaction Successful!"
        subtitle="gas cost = 0, money arrives < 1s"
        amountText={local2(amountUsd)}
        onShareReceipt={() => digest && Share.share({ message: `https://suivision.xyz/txblock/${digest}` })}
        onDone={close}
      />
    );
  if (step === "failure")
    return <FailureStep message={error} onRetry={() => { setRawAmount(""); setResolved(null); setStep("amount"); }} onDone={close} />;

  if (step === "recipient")
    return (
      <RecipientStep
        resolved={resolved}
        setResolved={setResolved}
        onBack={() => setStep("amount")}
        onNext={() => setStep("review")}
      />
    );

  if (step === "review")
    return <ReviewStep amount={rawAmount} amountUsd={amountUsd} resolved={resolved!} onBack={() => setStep("recipient")} onConfirm={send} />;

  return <AmountStep raw={rawAmount} setRaw={setRawAmount} onClose={close} onNext={() => setStep("recipient")} />;
}

/* ─── Amount ─────────────────────────────────────────────── */
function AmountStep({ raw, setRaw, onClose, onNext }: { raw: string; setRaw: (s: string) => void; onClose: () => void; onNext: () => void }) {
  const insets = useSafeAreaInsets();
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    walletApi.balances().then((b) => setAvailable(b.usdsui)).catch(() => {});
  }, []);
  const amountUsd = Number(raw) || 0;
  const over = amountUsd > available;
  const enabled = amountUsd > 0 && !over;
  const display = raw === "" ? "0" : raw;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <FlowHeader label="Send" onClose={onClose} />
      <View style={styles.amountArea}>
        <Text style={styles.amountText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
          <Text style={styles.amountSymbol}>$ </Text>
          {display}
        </Text>
        {over ? <MicroLabel style={{ color: colors.danger, letterSpacing: 1.5 }}>OVER AVAILABLE BALANCE</MicroLabel> : null}
      </View>
      <View style={styles.walletPill}>
        <View style={styles.dot} />
        <Text style={styles.walletText}>MAIN WALLET</Text>
        <Text style={styles.walletDot}>·</Text>
        <Text style={styles.walletText}>{local2(available)}</Text>
      </View>
      <View style={styles.pad}>
        <SendNumpad value={raw} onChange={setRaw} />
      </View>
      <Pressable
        style={[styles.mintBtn, { backgroundColor: enabled ? colors.greenMint : colors.surface2 }]}
        disabled={!enabled}
        onPress={onNext}
      >
        <Text style={[styles.mintBtnText, { color: enabled ? MINT_INK : colors.fgDim }]}>Review</Text>
      </Pressable>
    </View>
  );
}

/* ─── Recipient ──────────────────────────────────────────── */
function RecipientStep({
  resolved,
  setResolved,
  onBack,
  onNext,
}: {
  resolved: RecipientResolution | null;
  setResolved: (r: RecipientResolution | null) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const [contacts, setContacts] = useState<ContactDTO[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getContacts().then(setContacts).catch(() => {});
  }, []);

  const runResolve = async (q: string) => {
    setResolving(true);
    setNoMatch(false);
    try {
      const r = await resolveRecipient(q);
      setResolved(r);
    } catch {
      setResolved(null);
      setNoMatch(true);
    } finally {
      setResolving(false);
    }
  };

  const onInput = (q: string) => {
    setInput(q);
    setResolved(null);
    setNoMatch(false);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 3) return;
    debounce.current = setTimeout(() => void runResolve(q.trim()), 250);
  };

  const pickContact = (c: ContactDTO) => {
    setInput(c.name ?? c.address);
    setResolved({ address: c.address, displayName: c.name ?? null });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <FlowHeader label="Send to" onBack={onBack} />
      <View style={styles.inputCard}>
        <MicroLabel style={{ color: colors.fgDim, letterSpacing: 1.5 }}>TO</MicroLabel>
        <TextInput
          value={input}
          onChangeText={onInput}
          placeholder="alice / 0x6487… / @handle"
          placeholderTextColor={colors.fgDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.inputField}
        />
      </View>
      <View style={styles.resolveStatus}>
        {resolving ? (
          <><ActivityIndicator size="small" color={colors.fgDim} /><Text style={styles.resolveDim}>Resolving…</Text></>
        ) : resolved ? (
          <>
            <Icon name="checkmark.circle.fill" size={11} color={colors.greenMint} />
            <Text style={styles.resolveName}>{resolved.displayName ?? shortAddr(resolved.address)}</Text>
            <Text style={styles.resolveAddr}>{shortAddr(resolved.address)}</Text>
          </>
        ) : noMatch ? (
          <><Icon name="exclamationmark.circle" size={11} color={colors.danger} /><Text style={styles.resolveDim}>No match yet for &quot;{input}&quot;</Text></>
        ) : null}
      </View>

      <Eyebrow style={{ marginTop: spacing.lg, marginHorizontal: 28 }}>Recent</Eyebrow>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: spacing.sm }}>
        {contacts.length === 0 ? (
          <Text style={styles.emptyContacts}>No recent recipients yet — your first send will appear here.</Text>
        ) : (
          contacts.map((c, i) => (
            <View key={c.address}>
              {i > 0 ? <Divider inset={70} /> : null}
              <Pressable style={styles.contactRow} onPress={() => pickContact(c)}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactInitial}>{(c.name ?? c.address.replace(/^0x/, "")).slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>{c.name ?? shortAddr(c.address)}</Text>
                  <Text style={styles.contactAddr}>{shortAddr(c.address)}</Text>
                </View>
                {c.sentCount > 0 ? <Text style={styles.contactAddr}>{c.sentCount} sent</Text> : null}
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Pressable
        style={[styles.mintBtn, { backgroundColor: resolved ? colors.greenMint : colors.surface2, marginTop: spacing.md }]}
        disabled={!resolved}
        onPress={onNext}
      >
        <Text style={[styles.mintBtnText, { color: resolved ? MINT_INK : colors.fgDim }]}>Next</Text>
      </Pressable>
    </View>
  );
}

/* ─── Review ─────────────────────────────────────────────── */
function ReviewStep({
  amount,
  amountUsd,
  resolved,
  onBack,
  onConfirm,
}: {
  amount: string;
  amountUsd: number;
  resolved: RecipientResolution;
  onBack: () => void;
  onConfirm: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { whole, frac } = splitAmount(local2(amountUsd));
  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <FlowHeader onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
        <Text style={styles.reviewTitle}>Review send</Text>
        <View style={styles.reviewCard}>
          <Eyebrow>From {user?.handle ?? "you"}</Eyebrow>
          <Text style={styles.reviewAmount}>
            <Text style={{ color: colors.fgMuted, fontWeight: "300" }}>$ </Text>
            {whole}
            <Text style={{ color: colors.fgMuted }}>{frac}</Text>
          </Text>
          <Text style={styles.reviewSub}>{amountUsd.toFixed(2)} USDsui</Text>
        </View>
        <View style={styles.arrow}>
          <Icon name="arrow.down" size={15} color={colors.greenMint} />
        </View>
        <View style={styles.reviewCard}>
          <Eyebrow>To</Eyebrow>
          <Text style={styles.reviewTo} numberOfLines={1}>{resolved.displayName ?? shortAddr(resolved.address)}</Text>
          <Text style={styles.reviewSub}>{shortAddr(resolved.address)}</Text>
        </View>
        <View style={styles.feeLine}>
          <Icon name="checkmark.seal.fill" size={11} color={colors.greenMint} />
          <Text style={styles.feeText}>Network fee $0.00 — Talise auto-routed the rail and sponsored the gas.</Text>
        </View>
      </ScrollView>
      <View style={[styles.slideWrap, { paddingBottom: insets.bottom + spacing.md }]}>
        <SlideToConfirm title="Slide to send" tint={colors.greenMint} onConfirm={onConfirm} />
      </View>
    </View>
  );
}

/* ─── Failure ────────────────────────────────────────────── */
function FailureStep({ message, onRetry, onDone }: { message: string | null; onRetry: () => void; onDone: () => void }) {
  return (
    <View style={[styles.screen, styles.failCenter]}>
      <View style={styles.failIcon}>
        <Icon name="exclamationmark" size={36} color={colors.danger} />
      </View>
      <Text style={styles.failTitle}>Send failed</Text>
      <Text style={styles.failSub}>No funds moved. You can try again or close this.</Text>
      {message ? <Text style={styles.failMsg}>{message}</Text> : null}
      <View style={styles.failButtons}>
        <Pressable style={styles.failRetry} onPress={onRetry}><Text style={styles.failRetryText}>Try again</Text></Pressable>
        <Pressable style={styles.failDone} onPress={onDone}><Text style={styles.failDoneText}>Done</Text></Pressable>
      </View>
    </View>
  );
}

function FlowHeader({ label, onBack, onClose }: { label?: string; onBack?: () => void; onClose?: () => void }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable style={styles.disc} onPress={onBack} hitSlop={8}><Icon name="chevron.left" size={16} color={colors.fg} /></Pressable>
      ) : onClose ? (
        <Pressable style={styles.disc} onPress={onClose} hitSlop={8}><Icon name="xmark" size={15} color={colors.fgMuted} /></Pressable>
      ) : (
        <View style={styles.disc} />
      )}
      {label ? <MicroLabel style={{ letterSpacing: 2, color: colors.fgMuted }}>{label}</MicroLabel> : <View />}
      <View style={styles.disc} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, height: 40 },
  disc: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },

  amountArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  amountText: { fontFamily: family.sans, fontSize: 72, fontWeight: "500", color: colors.fg, letterSpacing: -2 },
  amountSymbol: { fontSize: 56, fontWeight: "200", color: colors.fgMuted, letterSpacing: 0 },
  walletPill: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: 8, backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.greenMint },
  walletText: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1.5, color: colors.fg },
  walletDot: { fontFamily: family.mono, fontSize: 10, color: colors.fgDim },
  pad: { paddingHorizontal: 24 },
  mintBtn: { height: 56, borderRadius: 28, marginHorizontal: 24, marginBottom: 18, alignItems: "center", justifyContent: "center" },
  mintBtnText: { fontFamily: family.sans, fontSize: 16, fontWeight: "500" },

  inputCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, marginHorizontal: 24, marginTop: 16, gap: 6 },
  inputField: { fontFamily: family.sans, fontSize: 17, color: colors.fg },
  resolveStatus: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 28, marginTop: 8, minHeight: 16 },
  resolveDim: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.fgDim },
  resolveName: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.greenMint },
  resolveAddr: { fontFamily: family.mono, fontSize: 10, fontWeight: "300", color: colors.fgDim },
  emptyContacts: { fontFamily: family.sans, fontSize: 13, fontWeight: "300", color: colors.fgDim, marginHorizontal: 28 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 24, paddingVertical: 12 },
  contactAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  contactInitial: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: colors.fg },
  contactName: { fontFamily: family.sans, fontSize: 15, color: colors.fg },
  contactAddr: { fontFamily: family.mono, fontSize: 10, fontWeight: "300", color: colors.fgDim, marginTop: 2 },

  reviewTitle: { fontFamily: family.sans, fontSize: 24, fontWeight: "500", color: colors.fg, letterSpacing: -0.5, marginTop: spacing.sm },
  reviewCard: { backgroundColor: colors.surface, borderRadius: 22, padding: spacing.lg, gap: 6 },
  reviewAmount: { fontFamily: family.sans, fontSize: 40, fontWeight: "500", color: colors.fg, letterSpacing: -1 },
  reviewSub: { fontFamily: family.mono, fontSize: 12, fontWeight: "300", color: colors.fgDim },
  reviewTo: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fg },
  arrow: { alignSelf: "center", width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  feeLine: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", marginTop: spacing.sm },
  feeText: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.fgMuted, flexShrink: 1, textAlign: "center" },
  slideWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },

  failCenter: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  failIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(160,90,62,0.15)", alignItems: "center", justifyContent: "center" },
  failTitle: { fontFamily: family.sans, fontSize: 34, fontWeight: "500", color: colors.fg, letterSpacing: -1 },
  failSub: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgMuted, textAlign: "center" },
  failMsg: { fontFamily: family.sans, fontSize: 13, fontWeight: "300", color: colors.fgMuted, textAlign: "center" },
  failButtons: { position: "absolute", bottom: 40, left: spacing.xl, right: spacing.xl, gap: spacing.md },
  failRetry: { height: 56, borderRadius: 28, backgroundColor: colors.fg, alignItems: "center", justifyContent: "center" },
  failRetryText: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.bg },
  failDone: { height: 56, borderRadius: 28, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  failDoneText: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
});
