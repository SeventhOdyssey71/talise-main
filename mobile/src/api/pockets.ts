import AsyncStorage from "@react-native-async-storage/async-storage";

import { api } from "@/api/client";

/**
 * Currency pockets — multi-currency display over the one USDsui balance. FX from
 * /api/fx; conversion is a preview (USDsui settles 1:1 USD). From ios
 * CurrencyPocketsView / CurrencySettings.
 */

export type TaliseCurrency = { code: string; symbol: string; name: string; flag: string };

/** Supported currencies — verbatim from ios TaliseCurrency.allSupported (+ ISO flag). */
export const CURRENCIES: TaliseCurrency[] = [
  { code: "USD", symbol: "$", name: "US Dollar", flag: "us" },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira", flag: "ng" },
  { code: "GHS", symbol: "₵", name: "Ghanaian Cedi", flag: "gh" },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", flag: "ke" },
  { code: "EUR", symbol: "€", name: "Euro", flag: "eu" },
  { code: "GBP", symbol: "£", name: "British Pound", flag: "gb" },
  { code: "CAD", symbol: "CA$", name: "Canadian Dollar", flag: "ca" },
  { code: "ZAR", symbol: "R", name: "South African Rand", flag: "za" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", flag: "jp" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", flag: "sg" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso", flag: "ph" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", flag: "id" },
  { code: "VND", symbol: "₫", name: "Vietnamese Dong", flag: "vn" },
];

export function currency(code: string): TaliseCurrency {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

const ZERO_DECIMAL = new Set(["JPY", "VND", "IDR", "NGN", "KES"]);

/** Format an amount in a currency with its symbol + 0/2 decimals by convention. */
export function fmtCurrency(amount: number, code: string): string {
  const c = currency(code);
  const digits = ZERO_DECIMAL.has(code) ? 0 : 2;
  return `${c.symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const SPREAD_BPS = 25;
export const QUOTE_TTL_S = 30;
export const FX_TTL_MS = 4 * 3600 * 1000;

export const fxApi = {
  rates: async (): Promise<Record<string, number>> => {
    const r = await api<{ rates?: Record<string, number> }>("/api/fx");
    return r.rates ?? {};
  },
};

/**
 * Client-side quote — crossRate = toRate/fromRate; 25bps spread taken off the
 * gross. Returns the locked rate, gross, net out, and the fee in the target ccy.
 */
export function convert(amountIn: number, fromCode: string, toCode: string, rates: Record<string, number>) {
  const fromRate = rates[fromCode] ?? 1;
  const toRate = rates[toCode] ?? 1;
  const crossRate = toRate / fromRate;
  const grossOut = amountIn * crossRate;
  const amountOut = grossOut * (1 - SPREAD_BPS / 10000);
  const fee = grossOut * (SPREAD_BPS / 10000);
  return { crossRate, grossOut, amountOut, fee };
}

// --- persistence (mirrors the ios UserDefaults keys) ---
const K_DISPLAY = "io.talise.app.displayCurrency";
const K_POCKETS = "io.talise.app.currencyPockets";
const K_RATES = "io.talise.app.fxRates";
const K_RATES_AT = "io.talise.app.fxRatesAt";

export const pocketsStore = {
  getDisplay: async (): Promise<string> => (await AsyncStorage.getItem(K_DISPLAY)) ?? "USD",
  setDisplay: (code: string) => AsyncStorage.setItem(K_DISPLAY, code),

  /** Pinned pocket codes; defaults to [display, USD] on first run. */
  getPockets: async (): Promise<string[]> => {
    const s = await AsyncStorage.getItem(K_POCKETS);
    if (s) return JSON.parse(s) as string[];
    const display = (await AsyncStorage.getItem(K_DISPLAY)) ?? "USD";
    return display === "USD" ? ["USD"] : [display, "USD"];
  },
  setPockets: (codes: string[]) => AsyncStorage.setItem(K_POCKETS, JSON.stringify(codes)),

  /** Cache the FX snapshot; used immediately while a fresh set loads in the background. */
  getCachedRates: async (): Promise<{ rates: Record<string, number>; stale: boolean } | null> => {
    const [raw, at] = await Promise.all([AsyncStorage.getItem(K_RATES), AsyncStorage.getItem(K_RATES_AT)]);
    if (!raw) return null;
    const stale = !at || Date.now() - Number(at) > FX_TTL_MS;
    return { rates: JSON.parse(raw) as Record<string, number>, stale };
  },
  setCachedRates: async (rates: Record<string, number>) => {
    await Promise.all([
      AsyncStorage.setItem(K_RATES, JSON.stringify(rates)),
      AsyncStorage.setItem(K_RATES_AT, String(Date.now())),
    ]);
  },
};
