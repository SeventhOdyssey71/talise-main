/**
 * Local session store — the CLI equivalent of iOS Keychain / SecureStore.
 *
 * Everything needed to authenticate AND sign lives in one file at
 * ~/.talise/session.json (mode 0600):
 *   - bearer                 mobile bearer token (Authorization header)
 *   - userId / address       identity
 *   - ephemeralSecretB64     32-byte Ed25519 seed — the signing key, LOCAL ONLY
 *   - ephemeralPubKeyB64     its public key (sent with every send)
 *   - maxEpoch / randomness  the zkLogin binding the JWT nonce was bound to
 *
 * The (pubkey, maxEpoch, randomness) triple MUST match what the server bound at
 * sign-in or the zkLogin proof won't verify — so we persist all three at login.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from "node:fs";

export type Session = {
  bearer: string;
  userId: string;
  address?: string;
  handle?: string;
  ephemeralSecretB64: string;
  ephemeralPubKeyB64: string;
  maxEpoch: number;
  randomness: string;
  baseUrl: string;
  createdAt: number;
};

const DIR = join(homedir(), ".talise");
const FILE = join(DIR, "session.json");

const DEFAULT_BASE_URL = "https://app.talise.io";

/** Resolve the API base URL: explicit flag > env > session > default.
 *  Guarded to a talise.io host so a poisoned env can't exfiltrate the bearer. */
export function resolveBaseUrl(override?: string): string {
  const raw = (override || process.env.TALISE_BASE_URL || "").trim();
  if (!raw) return loadSession()?.baseUrl || DEFAULT_BASE_URL;
  let host: string;
  try {
    host = new URL(raw).host;
  } catch {
    throw new Error(`invalid --base-url: ${raw}`);
  }
  const insecureOk = process.env.TALISE_ALLOW_INSECURE === "1";
  const isTalise = host === "talise.io" || host.endsWith(".talise.io");
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!isTalise && !(insecureOk && isLocal)) {
    throw new Error(
      `refusing to use base URL host "${host}" — must be a talise.io host ` +
        `(set TALISE_ALLOW_INSECURE=1 to allow localhost for local dev)`,
    );
  }
  return raw.replace(/\/+$/, "");
}

/** Load the on-disk session, or an env-injected one (for ephemeral agent
 *  runtimes): TALISE_SESSION = base64 of the JSON. Returns null if none. */
export function loadSession(): Session | null {
  const envB64 = process.env.TALISE_SESSION?.trim();
  if (envB64) {
    try {
      return JSON.parse(Buffer.from(envB64, "base64").toString("utf8")) as Session;
    } catch {
      throw new Error("TALISE_SESSION is set but is not valid base64 JSON");
    }
  }
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Session;
  } catch {
    return null;
  }
}

/** The session or a clear "run talise login" error — for commands that need auth. */
export function requireSession(): Session {
  const s = loadSession();
  if (!s || !s.bearer) {
    throw new Error("not signed in — run `talise login` first");
  }
  return s;
}

export function saveSession(session: Session): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
}

export function clearSession(): void {
  if (existsSync(FILE)) rmSync(FILE, { force: true });
}

export function sessionPath(): string {
  return FILE;
}
