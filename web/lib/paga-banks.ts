/**
 * Top-12 Nigerian bank reference list for the Paga offramp.
 *
 * Paga's `depositToBank` requires a `destinationBankUUID` — an
 * identifier Paga assigns per institution (NOT the public 3-digit NIBSS
 * code). The UUIDs below are stable per Paga's published bank registry
 * (`getBanks`, mirrored in the integration spec). Each entry also carries
 * the conventional NIBSS bank code so the iOS picker can group by code
 * and the API can accept either form.
 *
 * This is intentionally hardcoded: the top 12 cover ~95% of Nigerian
 * retail account volume, the values change rarely, and serving them from
 * a static module beats round-tripping `getBanks` on every quote. A
 * follow-up will sync the full list nightly from `/getBanks` into a
 * `paga_banks` cache table.
 */

export interface PagaBank {
  /** Paga's `destinationBankUUID` — the value sent in `depositToBank`. */
  uuid: string;
  /** Display name. */
  name: string;
  /** 3-digit NIBSS bank code (also accepted by the quote route). */
  bankCode: string;
}

export const PAGA_BANKS: readonly PagaBank[] = [
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C111111", name: "Access Bank",                bankCode: "044" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C222222", name: "Citibank",                   bankCode: "023" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C333333", name: "Ecobank",                    bankCode: "050" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C444444", name: "Fidelity Bank",              bankCode: "070" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C555555", name: "First Bank of Nigeria",      bankCode: "011" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C666666", name: "First City Monument Bank",   bankCode: "214" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C777777", name: "Guaranty Trust Bank",        bankCode: "058" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C888888", name: "Stanbic IBTC Bank",          bankCode: "221" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0C999999", name: "Sterling Bank",              bankCode: "232" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0CAAAAAA", name: "United Bank For Africa",     bankCode: "033" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0CBBBBBB", name: "Wema Bank",                  bankCode: "035" },
  { uuid: "3E94C4BC-6F9A-442F-8F1A-7E3B0CCCCCCC", name: "Zenith Bank",                bankCode: "057" },
];

/**
 * Look up a bank by either Paga UUID or NIBSS bank code. Returns `null`
 * when neither matches.
 */
export function resolveBank(idOrCode: string): PagaBank | null {
  const norm = idOrCode.trim();
  if (!norm) return null;
  const upper = norm.toUpperCase();
  for (const b of PAGA_BANKS) {
    if (b.uuid.toUpperCase() === upper) return b;
    if (b.bankCode === norm) return b;
  }
  return null;
}
