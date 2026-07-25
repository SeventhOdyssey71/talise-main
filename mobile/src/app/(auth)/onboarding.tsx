import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/auth/session";
import { claimHandleSilently, submitOnboarding } from "@/auth/zklogin";
import { Eyebrow } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** ios KYCView — the live new-user step. Country + account type → /api/onboarding. */
const COUNTRIES: { code: string; name: string }[] = [
  { code: "NG", name: "Nigeria" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "OTHER", name: "Other" },
];
type AccountType = "personal" | "business";
const ACCOUNTS: { type: AccountType; title: string; sub: string }[] = [
  { type: "personal", title: "Personal", sub: "Send, receive, earn" },
  { type: "business", title: "Business", sub: "Invoices, payroll" },
];

const MINT_INK = colors.inkOnAccent;

export default function OnboardingScreen() {
  const { user, completeOnboarding } = useSession();
  const [step, setStep] = useState<"kyc" | "bankLink">("kyc");
  const [country, setCountry] = useState("NG");
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    setSubmitting(true);
    if (user) await claimHandleSilently(user);
    completeOnboarding({ ...(user ?? { id: "" }), accountType });
  };

  const onContinue = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await submitOnboarding(country, accountType);
      if (country === "NG") {
        setSubmitting(false);
        setStep("bankLink");
      } else {
        await finish();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't finish setup.");
      setSubmitting(false);
    }
  };

  if (step === "bankLink") return <BankLink onContinue={finish} busy={submitting} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.section}>
        <Eyebrow>Verify · 1 of 1</Eyebrow>
        <Text style={styles.h1}>Finish setting up{"\n"}your account</Text>
        <Text style={styles.lede}>
          We verified your Google account. One last step: tell us where you&apos;ll be using Talise, and whether this is
          for you or your business.
        </Text>
      </View>

      <View style={styles.section}>
        <Eyebrow>Country</Eyebrow>
        <View style={styles.group}>
          {COUNTRIES.map((c, i) => (
            <Pressable
              key={c.code}
              onPress={() => setCountry(c.code)}
              style={[styles.row, i > 0 && styles.rowDivider]}
            >
              <Text style={styles.rowName}>{c.name}</Text>
              {country === c.code ? <Icon name="checkmark" size={13} color={colors.fg} /> : null}
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Eyebrow>Account type</Eyebrow>
        <View style={styles.tiles}>
          {ACCOUNTS.map((a) => {
            const on = accountType === a.type;
            return (
              <Pressable
                key={a.type}
                onPress={() => setAccountType(a.type)}
                style={[styles.tile, { backgroundColor: on ? colors.greenMint : colors.surface }]}
              >
                <Text style={[styles.tileTitle, { color: on ? MINT_INK : colors.fg }]}>{a.title}</Text>
                <Text style={[styles.tileSub, { color: on ? "rgba(10,20,12,0.66)" : colors.fgMuted }]}>{a.sub}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryMint label="Continue" busy={submitting} onPress={onContinue} />
    </ScrollView>
  );
}

/** OnboardingBankLinkView (NG-only). Full bank linking lands in Phase 8; Skip/Add both proceed. */
function BankLink({ onContinue, busy }: { onContinue: () => void; busy: boolean }) {
  const PROPS = [
    { icon: "dollarsign.circle.fill", t: "Receive in Naira", s: "Friends send you USDsui; it lands in your bank as NGN." },
    { icon: "bolt.fill", t: "No extra steps later", s: "Linked once, your @handle is ready to be paid." },
    { icon: "lock.fill", t: "Private", s: "Senders only see your bank name — never your account number." },
  ];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.bankHeaderIcon}>
        <Icon name="building.columns.fill" size={26} color={colors.accent} />
      </View>
      <Text style={styles.h1}>Get paid in Naira</Text>
      <Text style={styles.lede}>
        Add a Nigerian bank account so people can pay you straight to your bank — in Naira. You can always do this later
        from your profile.
      </Text>
      <View style={[styles.group, { marginTop: spacing.md }]}>
        {PROPS.map((p, i) => (
          <View key={p.t} style={[styles.propRow, i > 0 && styles.rowDivider]}>
            <Icon name={p.icon} size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.propT}>{p.t}</Text>
              <Text style={styles.propS}>{p.s}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={{ height: spacing.lg }} />
      <PrimaryMint label="Add bank account" busy={busy} onPress={onContinue} />
      <Pressable onPress={onContinue} style={styles.skip} hitSlop={8}>
        <Text style={styles.skipText}>Skip for now</Text>
      </Pressable>
    </ScrollView>
  );
}

function PrimaryMint({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={busy ? undefined : onPress} style={[styles.cta, busy && { opacity: 0.85 }]}>
      {busy ? <ActivityIndicator size="small" color={MINT_INK} /> : <Text style={styles.ctaLabel}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.xxl, paddingBottom: spacing.xxxl },
  section: { gap: spacing.md },
  h1: { fontFamily: family.sans, fontSize: 30, fontWeight: "500", color: colors.fg, letterSpacing: -0.8, lineHeight: 35 },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowName: { fontFamily: family.sans, fontSize: 14, color: colors.fg },
  tiles: { flexDirection: "row", gap: spacing.md },
  tile: { flex: 1, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  tileTitle: { fontFamily: family.sans, fontSize: 15, fontWeight: "500" },
  tileSub: { fontFamily: family.sans, fontSize: 12 },
  error: { fontFamily: family.sans, fontSize: 12, color: colors.danger },
  cta: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.greenMint,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: MINT_INK },
  bankHeaderIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  propRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, padding: 16 },
  propT: { fontFamily: family.sans, fontSize: 14, fontWeight: "500", color: colors.fg },
  propS: { fontFamily: family.sans, fontSize: 12, color: colors.fgMuted, marginTop: 2, lineHeight: 17 },
  skip: { alignSelf: "center", paddingVertical: spacing.lg, marginTop: spacing.sm },
  skipText: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, fontWeight: "500" },
});
