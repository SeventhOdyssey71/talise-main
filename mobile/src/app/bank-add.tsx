import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { bankApi, NIBSS_BANKS, type BankLinkPrepare, type NibssBank } from "@/api/bank";
import { ApiError } from "@/api/money";
import { BankLogo } from "@/design/assets";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** AddBankAccountView — resolve a NIBSS account then link it to the handle. */
export default function BankAddScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [bank, setBank] = useState<NibssBank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [prepared, setPrepared] = useState<BankLinkPrepare | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? NIBSS_BANKS.filter((b) => b.name.toLowerCase().includes(q)) : NIBSS_BANKS;
  }, [query]);

  const canCheck = !!bank && accountNumber.length === 10;

  const onAccountChange = (t: string) => {
    setAccountNumber(t.replace(/[^0-9]/g, "").slice(0, 10));
    setPrepared(null);
    setErr(null);
  };

  const pickBank = (b: NibssBank) => {
    setBank(b);
    setPrepared(null);
    setErr(null);
    setPickerOpen(false);
    setQuery("");
  };

  const check = async () => {
    if (!bank || !canCheck) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await bankApi.prepare(bank.bankCode, accountNumber);
      setPrepared(p);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr("That account is already linked to your handle.");
      } else if (
        e instanceof ApiError &&
        (e.status === 503 || (e.message || "").toLowerCase().includes("not configured"))
      ) {
        setErr("Bank linking is rolling out — check back soon.");
      } else {
        setErr("Couldn't verify that account. Check the number and bank.");
      }
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    if (!prepared) return;
    setBusy(true);
    setErr(null);
    try {
      await bankApi.confirm(prepared);
      router.back();
    } catch {
      setErr("Couldn't link that account right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader title="Add bank account" onClose={() => router.back()} />

        <LabeledField label="BANK">
          <Pressable style={styles.selectField} onPress={() => setPickerOpen(true)}>
            {bank ? (
              <View style={styles.selectValue}>
                <BankLogo code={bank.bankCode} size={24} />
                <Text style={styles.selectText}>{bank.name}</Text>
              </View>
            ) : (
              <Text style={styles.selectPlaceholder}>Select bank</Text>
            )}
            <Icon name="chevron.down" size={14} color={colors.fgMuted} />
          </Pressable>
        </LabeledField>

        <LabeledField label="ACCOUNT NUMBER">
          <FieldInput
            keyboardType="number-pad"
            placeholder="10-digit account number"
            value={accountNumber}
            onChangeText={onAccountChange}
            maxLength={10}
          />
        </LabeledField>

        {prepared ? <Text style={styles.resolved}>✓ {prepared.accountName}</Text> : null}
        {err ? <Text style={styles.err}>{err}</Text> : null}

        {prepared ? (
          <TaliseButton title={busy ? "Linking…" : "Link account"} variant="primary" size="lg" loading={busy} onPress={link} />
        ) : (
          <TaliseButton
            title={busy ? "Checking…" : "Check account"}
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!canCheck}
            onPress={check}
          />
        )}
      </ScrollView>

      {pickerOpen ? (
        <View style={styles.picker}>
          <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.lg }}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select bank</Text>
              <Pressable style={styles.disc} onPress={() => setPickerOpen(false)} hitSlop={8}>
                <Icon name="xmark" size={15} color={colors.fgMuted} />
              </Pressable>
            </View>

            <FieldInput placeholder="Search banks" value={query} onChangeText={setQuery} autoCorrect={false} />

            <View style={{ gap: spacing.xs }}>
              {filtered.map((b) => {
                const selected = bank?.bankCode === b.bankCode;
                return (
                  <Pressable key={b.bankCode} style={styles.bankRow} onPress={() => pickBank(b)}>
                    <BankLogo code={b.bankCode} size={28} />
                    <Text style={styles.bankName}>{b.name}</Text>
                    {selected ? <Icon name="checkmark" size={15} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  selectField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  selectValue: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  selectText: { fontFamily: family.sans, fontSize: 16, color: colors.fg, flexShrink: 1 },
  selectPlaceholder: { fontFamily: family.sans, fontSize: 16, color: colors.fgDim },
  resolved: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.accent },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  picker: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerTitle: { fontFamily: family.sans, fontSize: 24, fontWeight: "500", color: colors.fg, letterSpacing: -0.8 },
  disc: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  bankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bankName: { fontFamily: family.sans, fontSize: 15, color: colors.fg, flex: 1 },
});
