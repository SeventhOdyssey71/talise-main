/**
 * Pure helpers for Talise usernames.
 *
 * User-facing form is `name@talise`. The SuiNS canonical form is
 * `name.talise.sui` (the operator owns `talise.sui` and gives users subnames).
 * Both forms strip to the same bare username, which is what we store in DB.
 *
 * No DB, no fetch, no side effects. Safe to import client or server.
 */

export type ParsedHandle = { username: string; raw: string };

/** Hard constraint enforced everywhere: lowercase a-z, 0-9, underscore. 3-20 chars. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Reserved usernames that no user may claim. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "talise",
  "support",
  "help",
  "api",
  "www",
  "root",
]);

/**
 * Strip wrappers (`@`, `@talise`, `.talise.sui`), lowercase, validate.
 * Returns the bare username, or null if the input doesn't conform.
 */
export function normalizeHandle(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // strip leading `@`
  if (s.startsWith("@")) s = s.slice(1);

  // strip `@talise` suffix
  if (s.endsWith("@talise")) s = s.slice(0, -"@talise".length);

  // strip `.talise.sui` suffix
  if (s.endsWith(".talise.sui")) s = s.slice(0, -".talise.sui".length);

  if (!USERNAME_RE.test(s)) return null;
  return s;
}

/** Render a bare username as the user-facing form. */
export function formatHandle(username: string): string {
  return `${username}@talise`;
}

/** True if the input looks like a Sui address (0x + 64 hex chars). */
export function isHexAddress(input: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(input);
}
