/**
 * Non-custodial note-master escrow envelope tests (privacy Step 1).
 *
 * Hermetic: pure WebCrypto (`crypto.subtle`, present in Node 20+), no network.
 * These prove the property that makes the escrow non-custodial — the server
 * stores a blob it cannot open — plus round-trip correctness and the
 * backward-compat discriminator the escrow route relies on.
 */
import { describe, expect, it } from "vitest";
import {
  WRAP_PREFIX,
  generateRecoveryCode,
  normalizeRecoveryCode,
  isWrappedEnvelope,
  wrapNoteMaster,
  unwrapNoteMaster,
} from "@/lib/shield/sdk/escrow-wrap";

function master(fill = 7): Uint8Array {
  const m = new Uint8Array(32);
  for (let i = 0; i < 32; i++) m[i] = (i * 31 + fill) & 0xff;
  return m;
}

describe("shield escrow envelope", () => {
  it("round-trips: unwrap(wrap(master, code), code) === master", async () => {
    const m = master();
    const code = generateRecoveryCode();
    const env = await wrapNoteMaster(m, code);
    const back = await unwrapNoteMaster(env, code);
    expect(Array.from(back)).toEqual(Array.from(m));
  });

  it("rejects the wrong recovery code (GCM auth failure)", async () => {
    const m = master();
    const env = await wrapNoteMaster(m, generateRecoveryCode());
    await expect(unwrapNoteMaster(env, generateRecoveryCode())).rejects.toThrow();
  });

  it("envelope does NOT contain the plaintext master (server can't read it)", async () => {
    const m = master(99);
    const env = await wrapNoteMaster(m, generateRecoveryCode());
    // The raw master bytes, as hex, must not appear anywhere in the stored blob.
    const masterHex = Array.from(m)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const blobHex = Buffer.from(env.slice(WRAP_PREFIX.length), "base64").toString("hex");
    expect(blobHex.includes(masterHex)).toBe(false);
  });

  it("is wrapped/legacy discriminator matches the route's contract", async () => {
    const env = await wrapNoteMaster(master(), generateRecoveryCode());
    expect(isWrappedEnvelope(env)).toBe(true);
    // A legacy plaintext-hex master (64 hex chars) is NOT a wrapped envelope.
    expect(isWrappedEnvelope("a".repeat(64))).toBe(false);
    expect(isWrappedEnvelope("")).toBe(false);
  });

  it("normalizes recovery-code separators, case, and I/L/O confusions", async () => {
    const m = master();
    const code = generateRecoveryCode();
    const env = await wrapNoteMaster(m, code);
    // Same code typed with lowercase, extra spaces, and no dashes must still open it.
    const messy = ("  " + code.toLowerCase().replace(/-/g, "  ") + " ").trim();
    const back = await unwrapNoteMaster(env, messy);
    expect(Array.from(back)).toEqual(Array.from(m));
  });

  it("normalizeRecoveryCode maps I/L→1 and O→0", () => {
    expect(normalizeRecoveryCode("il-o o")).toBe("1100");
    expect(normalizeRecoveryCode("A1B2-C3D4")).toBe("A1B2C3D4");
  });

  it("re-wrapping the same master yields a different envelope, both valid", async () => {
    const m = master(3);
    const code = generateRecoveryCode();
    const a = await wrapNoteMaster(m, code);
    const b = await wrapNoteMaster(m, code);
    expect(a).not.toEqual(b); // fresh salt + iv per wrap
    expect(Array.from(await unwrapNoteMaster(a, code))).toEqual(Array.from(m));
    expect(Array.from(await unwrapNoteMaster(b, code))).toEqual(Array.from(m));
  });

  it("rejects too-short master or code, and non-envelopes", async () => {
    await expect(wrapNoteMaster(new Uint8Array(8), generateRecoveryCode())).rejects.toThrow();
    await expect(wrapNoteMaster(master(), "abc")).rejects.toThrow();
    await expect(unwrapNoteMaster("not-an-envelope", generateRecoveryCode())).rejects.toThrow();
  });

  it("generated recovery codes are ~128-bit and formatted in dash groups", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-Z]{1,4}(-[0-9A-Z]{1,4})+$/);
    expect(normalizeRecoveryCode(code).length).toBeGreaterThanOrEqual(24); // 128 bits ≈ 26 base32 chars
  });

  // ── Cross-language Known-Answer Test (fund-safety anchor) ──────────────────
  // The iOS non-custodial cutover reimplements this envelope in Swift
  // (PBKDF2-SHA256 600k → AES-256-GCM, salt(16)‖iv(12)‖ct, base64, "tsw1:").
  // If the Swift decode path diverges by a single byte, a master wrapped on one
  // platform is UNRECOVERABLE on another. This fixed vector pins the wire format:
  // any reimplementation MUST unwrap this exact envelope to master 0x00..0x1f.
  it("KAT: the fixed envelope unwraps to the known master", async () => {
    const envelope =
      "tsw1:2fmbARUfLw+TztUET80RepW88CERwviuUhxs4ZzALxmzCMozhymHwU+NTu/Lbc+/qwsAn/EnjdpnMqYk2+i+BlmJNUaU3c2WTvLqYw==";
    const code = "TALISE-KAT-CODE-0001";
    const expected = new Uint8Array(32).map((_, i) => i); // 0x00,0x01,…,0x1f
    const back = await unwrapNoteMaster(envelope, code);
    expect(Array.from(back)).toEqual(Array.from(expected));
  });
});
