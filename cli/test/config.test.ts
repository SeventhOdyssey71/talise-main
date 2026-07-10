/**
 * Security-critical config tests: base-URL host allowlisting (so a poisoned
 * env or session file can't exfiltrate the bearer) and the on-disk session
 * store (round-trip, 0600 perms, env injection, corrupt-file handling).
 *
 * config.ts captures its config dir at import time, so we point
 * TALISE_CONFIG_DIR at a throwaway temp dir BEFORE importing it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
let cfg: typeof import("../src/config.ts");

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "talise-cli-cfg-"));
  process.env.TALISE_CONFIG_DIR = tmp;
  cfg = await import("../src/config.ts");
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  delete process.env.TALISE_BASE_URL;
  delete process.env.TALISE_ALLOW_INSECURE;
  delete process.env.TALISE_SESSION;
  cfg.clearSession();
});

const sample = () => ({
  bearer: "tok_abc",
  userId: "u_1",
  address: "0xabc",
  handle: "sele",
  ephemeralSecretB64: "c2VjcmV0",
  ephemeralPubKeyB64: "cHVi",
  maxEpoch: 1200,
  randomness: "rand",
  baseUrl: "https://app.talise.io",
  createdAt: 1_700_000_000_000,
});

describe("resolveBaseUrl host allowlist", () => {
  it("accepts app.talise.io and strips trailing slashes", () => {
    expect(cfg.resolveBaseUrl("https://app.talise.io/")).toBe("https://app.talise.io");
    expect(cfg.resolveBaseUrl("https://app.talise.io///")).toBe("https://app.talise.io");
  });

  it("accepts the apex and any *.talise.io subdomain over https", () => {
    expect(cfg.resolveBaseUrl("https://talise.io")).toBe("https://talise.io");
    expect(cfg.resolveBaseUrl("https://staging.talise.io")).toBe("https://staging.talise.io");
  });

  it("rejects a non-talise host (bearer-exfil guard)", () => {
    expect(() => cfg.resolveBaseUrl("https://evil.com")).toThrow(/refusing to use base URL/);
    // look-alike hosts must not slip past the suffix check
    expect(() => cfg.resolveBaseUrl("https://talise.io.evil.com")).toThrow(/refusing/);
    expect(() => cfg.resolveBaseUrl("https://nottalise.io")).toThrow(/refusing/);
  });

  it("rejects http talise.io unless localhost-insecure", () => {
    expect(() => cfg.resolveBaseUrl("http://app.talise.io")).toThrow(/refusing/);
  });

  it("rejects localhost by default, allows it only with TALISE_ALLOW_INSECURE=1", () => {
    expect(() => cfg.resolveBaseUrl("http://localhost:3000")).toThrow(/refusing/);
    process.env.TALISE_ALLOW_INSECURE = "1";
    expect(cfg.resolveBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(cfg.resolveBaseUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("throws on a malformed URL", () => {
    expect(() => cfg.resolveBaseUrl("not a url")).toThrow(/invalid --base-url/);
  });

  it("reads TALISE_BASE_URL from env when no flag is given", () => {
    process.env.TALISE_BASE_URL = "https://staging.talise.io";
    expect(cfg.resolveBaseUrl()).toBe("https://staging.talise.io");
  });

  it("falls back to the default when nothing is set", () => {
    expect(cfg.resolveBaseUrl()).toBe("https://app.talise.io");
  });

  it("re-validates the base URL persisted in the session (tamper guard)", () => {
    // A session file whose baseUrl was tampered to an attacker host must NOT be
    // trusted just because it lives on disk.
    cfg.saveSession({ ...sample(), baseUrl: "https://evil.com" });
    expect(() => cfg.resolveBaseUrl()).toThrow(/refusing to use base URL/);
  });
});

describe("session store", () => {
  it("round-trips a saved session", () => {
    const s = sample();
    cfg.saveSession(s);
    expect(cfg.loadSession()).toEqual(s);
  });

  it("writes the session file with 0600 permissions", () => {
    cfg.saveSession(sample());
    const mode = statSync(cfg.sessionPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clearSession removes the file and requireSession then throws", () => {
    cfg.saveSession(sample());
    cfg.clearSession();
    expect(cfg.loadSession()).toBeNull();
    expect(() => cfg.requireSession()).toThrow(/not signed in/);
  });

  it("loads an env-injected session (TALISE_SESSION base64 JSON)", () => {
    const s = sample();
    process.env.TALISE_SESSION = Buffer.from(JSON.stringify(s)).toString("base64");
    expect(cfg.loadSession()).toEqual(s);
  });

  it("throws a clear error when TALISE_SESSION is not valid base64 JSON", () => {
    process.env.TALISE_SESSION = "@@@not-base64@@@";
    expect(() => cfg.loadSession()).toThrow(/not valid base64 JSON/);
  });

  it("returns null (not a crash) on a corrupt session file", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(cfg.sessionPath(), "{ this is not json", "utf8");
    expect(cfg.loadSession()).toBeNull();
  });
});
