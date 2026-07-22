import { secure } from "@/auth/secure";
import { b64, ed25519PublicKey, randomSecret } from "@/sui/crypto";

/**
 * EphemeralKeyStore — the zkLogin ephemeral Ed25519 key. Rotated (wiped) on
 * every fresh sign-in and on sign-out (a stale key past maxEpoch causes on-chain
 * "ZKLogin expired at epoch N"). Stored as base64 of the 32-byte secret seed.
 */
export const ephemeralKey = {
  /** Load the existing secret or mint + persist a fresh one. */
  async loadOrCreate(): Promise<{ secret: Uint8Array; publicKeyB64: string }> {
    const existing = await secure.getEphemeral();
    let secret: Uint8Array;
    if (existing) {
      secret = b64.decode(existing);
    } else {
      secret = randomSecret();
      await secure.setEphemeral(b64.encode(secret));
    }
    return { secret, publicKeyB64: b64.encode(ed25519PublicKey(secret)) };
  },

  async wipe(): Promise<void> {
    await secure.clearEphemeral();
  },

  async current(): Promise<Uint8Array | null> {
    const s = await secure.getEphemeral();
    return s ? b64.decode(s) : null;
  },

  async publicKeyB64(): Promise<string | null> {
    const secret = await this.current();
    return secret ? b64.encode(ed25519PublicKey(secret)) : null;
  },
};
