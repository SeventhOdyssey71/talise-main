import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { resolveRecipient, walletApi, type RecipientResolution } from "@/api/wallet";
import {
  crossBorderApi,
  crossBorderErrorCopy,
  DESTINATIONS,
  isBookable,
  isCommitted,
  ORIGINS,
  payout,
  type CorridorEntry,
  type CrossBorderQuote,
} from "@/api/crossborder";
import { ApiError } from "@/api/client";
import { useSession } from "@/auth/session";
import { Flag } from "@/design/assets";
import { SendNumpad } from "@/components/wallet/SendNumpad";
import { SendingView } from "@/components/wallet/SendingView";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { Divider } from "@/design/components/Divider";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { Eyebrow, MicroLabel } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2, shortAddr } from "@/lib/format";

type Step = "recipient" | "amount" | "review" | "sending" | "complete" | "failure";
type Dest = (typeof DESTINATIONS)[number];

/** CrossBorderFlowView — server-authoritative. Recipient → Amount → Review → Sending → Complete/Failure. */
export default function SendAbroadScreen() {
  const router = useRouter();
  const { user } = useSession();
  const origin = ORIGINS.find((o) => o.code === user?.accountType) ?? ORIGINS.find((o) => o.code === (user as { country?: string })?.country) ?? ORIGINS[0];

  const [step, setStep] = useState<Step>("recipient");
  const [dest, setDest] = useState<Dest | null>(null);
  const [resolved, setResolved] = useState<RecipientResolution | null>(null);
  const [raw, setRaw] = useState("");
  const [quote, setQuote] = useState<CrossBorderQuote | null>(null);
  const [fail, setFail] = useState<{ headline: string; message: string; retry: boolean } | null>(null);
  const close = () => router.back();

  const confirm = async () => {
    setStep("sending");
    try {
      const res = await crossBorderApi.confirm(quote!.transferId);
      if (isCommitted(res.state)) setStep("complete");
      else {
        setFail(crossBorderErrorCopy(null, "The transfer couldn't be committed. No funds moved."));
        setStep("failure");
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      setFail(crossBorderErrorCopy(code, e instanceof Error ? e.message : "Transfer failed."));
      setStep("failure");
    }
  };

  if (step === "sending")
    return (
      <SendingView
        title="Sending…"
        subtitle="Locking the chain leg, then handing off to the local payout. You can close this — we'll keep going."
        onDone={close}
      />
    );
  if (step === "complete")
    return (
      <SuccessfulTxView
        title={resolved?.displayName ? `Sent to ${resolved.displayName}` : "Sent"}
        subtitle="On chain now — landing in their bank shortly"
        amountText={quote ? payout(quote.recipientGets.amount, quote.recipientGets.currency) : undefined}
        onDone={close}
      />
    );
  if (step === "failure")
    return (
      <FailureStep
        fail={fail}
        onRetry={() => { setQuote(null); setStep("amount"); }}
        onClose={close}
      />
    );

  if (step === "amount")
    return (
      <AmountStep
        origin={origin}
        dest={dest!}
        raw={raw}
        setRaw={setRaw}
        onBack={() => setStep("recipient")}
        onQuoted={(q) => { setQuote(q); setStep("review"); }}
        onError={(f) => setFail(f)}
      />
    );

  if (step === "review")
    return <ReviewStep quote={quote!} raw={raw} origin={origin} dest={dest!} resolved={resolved!} onBack={() => setStep("amount")} onConfirm={confirm} onReprice={setQuote} />;

  return (
    <RecipientStep
      origin={origin}
      dest={dest}
      setDest={setDest}
      resolved={resolved}
      setResolved={setResolved}
      onClose={close}
      onNext={() => setStep("amount")}
    />
  );
}

/* ─── Recipient ──────────────────────────────────────────── */
function RecipientStep({ origin, dest, setDest, resolved, setResolved, onClose, onNext }: {
  origin: (typeof ORIGINS)[number]; dest: Dest | null; setDest: (d: Dest) => void;
  resolved: RecipientResolution | null; setResolved: (r: RecipientResolution | null) => void; onClose: () => void; onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const [corridors, setCorridors] = useState<CorridorEntry[]>([]);
  const [resolving, setResolving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    crossBorderApi.corridors().then(setCorridors).catch(() => {});
  }, []);
  const bookable = (d: Dest) => {
    if (corridors.length === 0) return true; // optimistic before registry loads
    const c = corridors.find((x) => x.fromCountry === origin.code && x.toCountry === d.code);
    return c ? isBookable(c.status) : false;
  };

  const onInput = (q: string) => {
    setInput(q); setResolved(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 3) return;
    debounce.current = setTimeout(async () => {
      setResolving(true);
      try { setResolved(await resolveRecipient(q.trim())); } catch { setResolved(null); } finally { setResolving(false); }
    }, 250);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <Header label="Send abroad" onClose={onClose} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.lg, paddingTop: spacing.md }}>
        <View style={styles.glass}>
          <View style={styles.originRow}>
            <Flag code={origin.flag} size={30} />
            <View>
              <Eyebrow>You pay from</Eyebrow>
              <Text style={styles.originText}>{origin.name} · {origin.ccy}</Text>
            </View>
          </View>
        </View>

        <View style={{ gap: spacing.md }}>
          <Eyebrow>Recipient gets paid in</Eyebrow>
          <View style={styles.chips}>
            {DESTINATIONS.filter((d) => d.code !== origin.code).map((d) => {
              const ok = bookable(d);
              const on = dest?.code === d.code;
              return (
                <Pressable
                  key={d.code}
                  disabled={!ok}
                  onPress={() => setDest(d)}
                  style={[styles.chip, { backgroundColor: on ? "rgba(121,217,108,0.16)" : colors.surfaceGlass, borderColor: on ? colors.accent : colors.line, opacity: ok ? 1 : 0.55 }]}
                >
                  <Flag code={d.flag} size={30} />
                  <Text style={styles.chipName}>{d.name}</Text>
                  <Text style={styles.chipCcy}>{ok ? d.ccy : "Soon"}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: spacing.md }}>
          <Eyebrow>To</Eyebrow>
          <View style={styles.glass}>
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
            {resolving ? <><ActivityIndicator size="small" color={colors.fgDim} /><Text style={styles.resolveDim}>Resolving…</Text></>
              : resolved ? <><Icon name="checkmark.circle.fill" size={11} color={colors.accent} /><Text style={[styles.resolveDim, { color: colors.accent }]}>{resolved.displayName ?? shortAddr(resolved.address)}</Text></>
              : null}
          </View>
        </View>
      </ScrollView>
      <FgButton title="Next" enabled={!!dest && !!resolved} onPress={onNext} insetBottom={insets.bottom} />
    </View>
  );
}

/* ─── Amount ─────────────────────────────────────────────── */
function AmountStep({ origin, dest, raw, setRaw, onBack, onQuoted, onError }: {
  origin: (typeof ORIGINS)[number]; dest: Dest; raw: string; setRaw: (s: string) => void; onBack: () => void;
  onQuoted: (q: CrossBorderQuote) => void; onError: (f: { headline: string; message: string; retry: boolean }) => void;
}) {
  const insets = useSafeAreaInsets();
  const [available, setAvailable] = useState(0);
  const [loading, setLoading] = useState(false);
  const [inlineErr, setInlineErr] = useState<string | null>(null);
  useEffect(() => { walletApi.balances().then((b) => setAvailable(b.usdsui)).catch(() => {}); }, []);

  const amount = Number(raw) || 0;
  const over = amount > available; // USD ≈ source (display simplification)
  const enabled = amount > 0 && !over && !loading;

  const getRate = async () => {
    setLoading(true); setInlineErr(null);
    try {
      onQuoted(await crossBorderApi.quote(origin.code, dest.code, amount));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      const copy = crossBorderErrorCopy(code, e instanceof Error ? e.message : "Couldn't lock a rate.");
      setInlineErr(copy.message);
      onError(copy);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <Header label="Amount" sub={`to ${dest.name}`} onBack={onBack} />
      <View style={styles.amountArea}>
        <Text style={styles.amountText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          <Text style={styles.amountSymbol}>{origin.ccy === "USD" ? "$ " : ""}</Text>
          {raw === "" ? "0" : raw}
        </Text>
        <View style={styles.estimateLine}>
          <Icon name="arrow.turn.down.right" size={10} color={colors.accent} />
          <Text style={styles.estimateText}>{amount.toFixed(2)} USDsui moves on chain</Text>
        </View>
        {over ? <MicroLabel style={{ color: colors.danger, letterSpacing: 1.5 }}>OVER AVAILABLE BALANCE</MicroLabel> : null}
      </View>
      <View style={styles.walletPill}>
        <View style={[styles.dot, { backgroundColor: colors.accent }]} />
        <Text style={styles.walletText}>MAIN WALLET</Text>
        <Text style={styles.walletDot}>·</Text>
        <Text style={styles.walletText}>{local2(available)}</Text>
      </View>
      <View style={{ paddingHorizontal: 24 }}><SendNumpad value={raw} onChange={setRaw} /></View>
      {inlineErr ? <Text style={styles.inlineErr}>{inlineErr}</Text> : null}
      <FgButton title={loading ? "Locking rate…" : "Get rate"} enabled={enabled} onPress={getRate} insetBottom={insets.bottom} />
    </View>
  );
}

/* ─── Review ─────────────────────────────────────────────── */
function ReviewStep({ quote, raw, origin, dest, resolved, onBack, onConfirm, onReprice }: {
  quote: CrossBorderQuote; raw: string; origin: (typeof ORIGINS)[number]; dest: Dest; resolved: RecipientResolution;
  onBack: () => void; onConfirm: () => Promise<void>; onReprice: (q: CrossBorderQuote) => void;
}) {
  const insets = useSafeAreaInsets();
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((quote.quote.expiresAt - Date.now()) / 1000)));
  const [repricing, setRepricing] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((quote.quote.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && !repricing) {
        setRepricing(true);
        crossBorderApi.quote(origin.code, dest.code, Number(raw) || 0)
          .then((q) => { onReprice(q); })
          .catch(() => {})
          .finally(() => setRepricing(false));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [quote, origin, dest, raw, repricing, onReprice]);

  const feeSource = (Number(raw) || 0) * (quote.quote.spreadBps / 10000);
  const gate = secondsLeft > 0 && !repricing;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <Header onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
        <Text style={styles.reviewTitle}>Review transfer</Text>
        <View style={styles.glass}>
          <Eyebrow>You send · {origin.name}</Eyebrow>
          <Text style={styles.reviewAmount}>{origin.ccy === "USD" ? "$ " : ""}{raw}</Text>
          <Text style={styles.reviewSub}>{quote.amountUsd.toFixed(2)} USDsui moves on chain</Text>
        </View>
        <View style={styles.arrow}><Icon name="arrow.down" size={15} color={colors.fgMuted} /></View>
        <View style={styles.glass}>
          <Eyebrow>Recipient · {quote.recipientGets.currency}</Eyebrow>
          <Text style={styles.reviewTo} numberOfLines={1}>{resolved.displayName ?? shortAddr(resolved.address)}</Text>
          <Text style={styles.reviewSub}>{shortAddr(resolved.address)}</Text>
        </View>
        <View style={styles.quoteBlock}>
          <View style={styles.quoteHead}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="lock.fill" size={12} color={colors.accent} />
              <Text style={styles.rateLine}>1 {origin.ccy} = {quote.quote.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} {quote.recipientGets.currency}</Text>
            </View>
            <Text style={[styles.held, { color: secondsLeft <= 5 ? colors.warmGold : colors.fgMuted }]}>
              {repricing ? "Updating…" : `Rate held ${secondsLeft}s`}
            </Text>
          </View>
          <Divider />
          <QRow label={`Fee (${(quote.quote.spreadBps / 100).toFixed(2)}%)`} value={payout(feeSource, origin.ccy)} />
          <QRow label="Total debit" value={payout(Number(raw) || 0, origin.ccy)} />
          <Divider />
          <View style={styles.getsRow}>
            <Text style={styles.getsLabel}>Recipient gets</Text>
            <Text style={styles.getsValue}>{payout(quote.recipientGets.amount, quote.recipientGets.currency)}</Text>
          </View>
          <Text style={styles.quoteFoot}>Locked at the held rate. Talise settles this as digital dollars, 1:1, then pays out locally.</Text>
        </View>
      </ScrollView>
      <View style={[styles.slideWrap, { paddingBottom: insets.bottom + spacing.md, opacity: gate ? 1 : 0.5 }]}>
        <SlideToConfirm title={gate ? "Slide to send" : "Rate updating…"} tint={colors.accent} onConfirm={gate ? onConfirm : async () => {}} />
      </View>
    </View>
  );
}

function FailureStep({ fail, onRetry, onClose }: { fail: { headline: string; message: string; retry: boolean } | null; onRetry: () => void; onClose: () => void }) {
  return (
    <View style={[styles.screen, styles.failCenter]}>
      <View style={styles.failIcon}><Icon name="exclamationmark.triangle" size={30} color={colors.danger} /></View>
      <Text style={styles.failTitle}>{fail?.headline ?? "Transfer didn't go through"}</Text>
      <Text style={styles.failSub}>{fail?.message ?? ""}</Text>
      <View style={styles.failButtons}>
        {fail?.retry ? <Pressable style={styles.failRetry} onPress={onRetry}><Text style={styles.failRetryText}>Try again</Text></Pressable> : null}
        <Pressable style={styles.failDone} onPress={onClose}><Text style={styles.failDoneText}>Close</Text></Pressable>
      </View>
    </View>
  );
}

function QRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.qrow}><Text style={styles.qLabel}>{label}</Text><Text style={styles.qValue}>{value}</Text></View>;
}

function Header({ label, sub, onBack, onClose }: { label?: string; sub?: string; onBack?: () => void; onClose?: () => void }) {
  return (
    <View style={styles.header}>
      {onBack ? <Pressable style={styles.disc} onPress={onBack} hitSlop={8}><Icon name="chevron.left" size={16} color={colors.fg} /></Pressable>
        : onClose ? <Pressable style={styles.disc} onPress={onClose} hitSlop={8}><Icon name="xmark" size={15} color={colors.fgMuted} /></Pressable>
        : <View style={styles.disc} />}
      <View style={{ alignItems: "center" }}>
        {label ? <MicroLabel style={{ letterSpacing: 1.5, color: colors.fgDim }}>{label}</MicroLabel> : null}
        {sub ? <Text style={styles.headerSub}>{sub}</Text> : null}
      </View>
      <View style={styles.disc} />
    </View>
  );
}

function FgButton({ title, enabled, onPress, insetBottom }: { title: string; enabled: boolean; onPress: () => void; insetBottom: number }) {
  return (
    <View style={{ paddingHorizontal: spacing.xl, paddingBottom: insetBottom + spacing.md }}>
      <Pressable style={[styles.fgBtn, { opacity: enabled ? 1 : 0.35 }]} disabled={!enabled} onPress={onPress}>
        <Text style={styles.fgBtnText}>{title}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, height: 40 },
  disc: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceGlass, alignItems: "center", justifyContent: "center" },
  headerSub: { fontFamily: family.mono, fontSize: 10, fontWeight: "300", color: colors.fgMuted, marginTop: 2 },
  glass: { backgroundColor: colors.surfaceGlass, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 16 },
  originRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  originText: { fontFamily: family.sans, fontSize: 14, color: colors.fg, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { width: "31%", alignItems: "center", gap: 4, paddingVertical: 12, borderRadius: 16, borderWidth: 1 },
  chipName: { fontFamily: family.sans, fontSize: 13, color: colors.fg },
  chipCcy: { fontFamily: family.mono, fontSize: 9, fontWeight: "300", color: colors.fgMuted },
  inputField: { fontFamily: family.sans, fontSize: 17, color: colors.fg },
  resolveStatus: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 16, marginHorizontal: 4 },
  resolveDim: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.fgDim },

  amountArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  amountText: { fontFamily: family.sans, fontSize: 72, fontWeight: "500", color: colors.fg, letterSpacing: -2 },
  amountSymbol: { fontSize: 56, fontWeight: "200", color: colors.fgMuted },
  estimateLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  estimateText: { fontFamily: family.mono, fontSize: 12, fontWeight: "300", color: colors.fgMuted },
  walletPill: { flexDirection: "row", alignItems: "center", alignSelf: "center", gap: 8, backgroundColor: colors.surfaceGlass, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 18 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  walletText: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1.5, color: colors.fg },
  walletDot: { fontFamily: family.mono, fontSize: 10, color: colors.fgDim },
  inlineErr: { fontFamily: family.sans, fontSize: 13, color: colors.danger, textAlign: "center", marginTop: spacing.sm },
  fgBtn: { height: 56, borderRadius: 28, backgroundColor: colors.fg, alignItems: "center", justifyContent: "center" },
  fgBtnText: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.bg },

  reviewTitle: { fontFamily: family.sans, fontSize: 24, fontWeight: "500", color: colors.fg, letterSpacing: -0.5, marginTop: spacing.sm },
  reviewAmount: { fontFamily: family.sans, fontSize: 40, fontWeight: "500", color: colors.fg, letterSpacing: -1, marginTop: 6 },
  reviewSub: { fontFamily: family.mono, fontSize: 12, fontWeight: "300", color: colors.fgDim, marginTop: 4 },
  reviewTo: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fg, marginTop: 6 },
  arrow: { alignSelf: "center", width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceGlass, alignItems: "center", justifyContent: "center" },
  quoteBlock: { backgroundColor: colors.surfaceGlass, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  quoteHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rateLine: { fontFamily: family.mono, fontSize: 12, color: colors.fg },
  held: { fontFamily: family.mono, fontSize: 11, fontWeight: "300" },
  qrow: { flexDirection: "row", justifyContent: "space-between" },
  qLabel: { fontFamily: family.sans, fontSize: 13, fontWeight: "300", color: colors.fgMuted },
  qValue: { fontFamily: family.sans, fontSize: 13, color: colors.fg },
  getsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  getsLabel: { fontFamily: family.sans, fontSize: 14, color: colors.fg },
  getsValue: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.accent },
  quoteFoot: { fontFamily: family.mono, fontSize: 10, fontWeight: "300", color: colors.fgDim, lineHeight: 15 },
  slideWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },

  failCenter: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  failIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(160,90,62,0.15)", alignItems: "center", justifyContent: "center" },
  failTitle: { fontFamily: family.sans, fontSize: 26, fontWeight: "500", color: colors.fg, letterSpacing: -0.6, textAlign: "center" },
  failSub: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
  failButtons: { position: "absolute", bottom: 40, left: spacing.xl, right: spacing.xl, gap: spacing.md },
  failRetry: { height: 56, borderRadius: 28, backgroundColor: colors.fg, alignItems: "center", justifyContent: "center" },
  failRetryText: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.bg },
  failDone: { height: 56, borderRadius: 28, backgroundColor: colors.surfaceGlass, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  failDoneText: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
});
