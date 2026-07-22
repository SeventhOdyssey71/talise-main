import { sha256 } from "@noble/hashes/sha2";
import { utf8ToBytes } from "@noble/hashes/utils";
import * as Crypto from "expo-crypto";

import { secure } from "@/auth/secure";
import { b64, concat } from "@/sui/crypto";

/**
 * PIN service — mirrors ios PinService.swift. Stored blob = base64( salt(16) ‖
 * SHA256(salt ‖ utf8(pin)) ) = 48 bytes, per-user, in the keychain. Verify
 * recomputes with the stored salt and constant-time compares the 32-byte digest.
 * No lockout / attempt cap (matches iOS; the UI does shake+clear).
 */
export const pinService = {
  async setPin(userId: string, pin: string): Promise<void> {
    const salt = Crypto.getRandomBytes(16);
    const digest = sha256(concat(salt, utf8ToBytes(pin)));
    await secure.setPin(userId, b64.encode(concat(salt, digest)));
  },

  async verifyPin(userId: string, pin: string): Promise<boolean> {
    const stored = await secure.getPin(userId);
    if (!stored) return false;
    const blob = b64.decode(stored);
    if (blob.length !== 48) return false;
    const salt = blob.subarray(0, 16);
    const expected = blob.subarray(16);
    const actual = sha256(concat(salt, utf8ToBytes(pin)));
    return constantTimeEqual(expected, actual);
  },

  async hasPin(userId: string): Promise<boolean> {
    return (await secure.getPin(userId)) != null;
  },

  async clearPin(userId: string): Promise<void> {
    await secure.clearPin(userId);
  },
};

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
