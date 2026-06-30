// web/lib/agent/memory-seal.ts
//
// Seal / zkLogin address-gated MemoryKeyProvider — FUTURE cross-device upgrade.
//
// This file is intentionally dependency-free. @mysten/seal is NOT installed yet,
// so we DO NOT import it. Instead this provider throws a descriptive
// "not yet configured" error if anyone tries to use it before the integration
// below is completed. The device-held provider (memory-device.ts) remains the
// default until SEAL_ENABLED === "true".
//
// ────────────────────────────────────────────────────────────────────────────
// INTEGRATION STEPS (do these when promoting to a cross-device Seal key):
//
// 1. Move policy package — publish a `seal_approve` entry function whose access
//    is gated to the requesting user's zkLogin-derived Sui address. The blob/key
//    identity (the `id` passed to Seal) MUST encode that address so only the
//    owner can decrypt, e.g.:
//
//        // module talise_memory::policy
//        // entry fun seal_approve(id: vector<u8>, owner: address, ctx: &TxContext) {
//        //     assert!(address_from_id_prefix(id) == tx_context::sender(ctx), ENotOwner);
//        //     assert!(owner == tx_context::sender(ctx), ENotOwner);
//        // }
//
//    Record the published package id as SEAL_POLICY_PACKAGE_ID.
//
// 2. Client (@mysten/seal) — once installed:
//      - new SealClient({ suiClient, serverObjectIds, verifyKeyServers: true })
//      - acquire a SessionKey for the user's zkLogin Sui address (signed by the
//        ephemeral zkLogin key) — short TTL, cached per session.
//      - use a key-server THRESHOLD >= 2 (e.g. 2-of-3 allowlisted key servers)
//        so no single key server can recover the key.
//      - encrypt/decrypt against the seal_approve policy from step 1.
//
// 3. Blob tagging — Seal-wrapped memory blobs use version tag 0x20 (device-key
//    blobs use 0x10, see MEMORY_VERSION in ./memory). Writers must stamp 0x20 so
//    readers route to the Seal codec. The 32-byte symmetric key returned by
//    getKey() then feeds the SAME AES-256-GCM doc codec in ./memory unchanged.
//
// 4. Flip SEAL_ENABLED=true (+ SEAL_POLICY_PACKAGE_ID, SEAL_KEY_SERVERS) once the
//    above is live; chooseKeyProvider() will then hand back the Seal provider.
// ────────────────────────────────────────────────────────────────────────────

import type { MemoryKeyProvider } from "@/lib/agent/memory";

/** Blob version tag for Seal-wrapped memory (device-key blobs use 0x10). */
export const MEMORY_SEAL_VERSION = 0x20;

function sealEnabled(): boolean {
  return process.env.SEAL_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Seal / zkLogin address-gated key provider.
 *
 * Implements the same MemoryKeyProvider contract as the device provider, so it
 * is a drop-in replacement. Until the integration steps above are completed it
 * throws a descriptive error rather than silently returning a bogus key.
 */
export class SealMemoryKeyProvider implements MemoryKeyProvider {
  async getKey(): Promise<Uint8Array> {
    if (!sealEnabled()) {
      throw new Error(
        "SealMemoryKeyProvider: not yet configured. @mysten/seal is not " +
          "installed and SEAL_ENABLED !== 'true'. Complete the integration " +
          "steps in lib/agent/memory-seal.ts (Move seal_approve policy gated " +
          "to the user's zkLogin Sui address, SessionKey + key servers " +
          "threshold >= 2, blob tag 0x20) before enabling.",
      );
    }
    // Even when the flag is on, the @mysten/seal wiring is not present in this
    // build. Fail loudly so we never fall back to an insecure/empty key.
    throw new Error(
      "SealMemoryKeyProvider: SEAL_ENABLED is true but the @mysten/seal " +
        "client wiring is not implemented in this build. Install @mysten/seal " +
        "and implement SessionKey acquisition + threshold key-server decryption " +
        "against SEAL_POLICY_PACKAGE_ID.",
    );
  }
}

/**
 * Factory: returns the active MemoryKeyProvider.
 *
 * For now this returns the device-held provider. When SEAL_ENABLED === "true"
 * (and the integration above is complete) it returns the Seal provider for
 * cross-device, address-gated key recovery.
 *
 * The device provider is passed in (rather than imported) to keep this module
 * free of any environment-specific dependency and avoid a circular import with
 * the device provider that may itself import the Seal version tag.
 */
export function chooseKeyProvider(
  deviceProvider: MemoryKeyProvider,
): MemoryKeyProvider {
  if (sealEnabled()) {
    return new SealMemoryKeyProvider();
  }
  return deviceProvider;
}
