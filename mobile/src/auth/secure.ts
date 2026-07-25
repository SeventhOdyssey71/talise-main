import * as SecureStore from "expo-secure-store";

/**
 * Secure (Keychain / Android Keystore) storage — mirrors the iOS SecureSessionStore,
 * EphemeralKeyStore, ProofCache and PinService keychain items. All items use
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY (no sync, no biometric gate on read), the
 * same accessibility class as iOS.
 */

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// Keys — expo-secure-store has one service per app, so the iOS service names are
// folded into descriptive keys.
const K = {
  bearer: "talise.session.bearer",
  ephemeral: "talise.zklogin.ephemeral.v1",
  proofCache: "talise.proofcache.v1",
  pin: (userId: string) => `talise.pin.${userId}`,
} as const;

async function get(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, OPTS);
}
async function set(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTS);
}
async function del(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTS);
}

export const secure = {
  // Bearer session token
  getBearer: () => get(K.bearer),
  setBearer: (t: string) => set(K.bearer, t),
  clearBearer: () => del(K.bearer),

  // Ephemeral Ed25519 secret (base64, 32 bytes)
  getEphemeral: () => get(K.ephemeral),
  setEphemeral: (b64: string) => set(K.ephemeral, b64),
  clearEphemeral: () => del(K.ephemeral),

  // Proof cache (JSON blob: { maxEpoch, jwtRandomness, proof })
  getProofCache: () => get(K.proofCache),
  setProofCache: (json: string) => set(K.proofCache, json),
  clearProofCache: () => del(K.proofCache),

  // PIN blob (base64 of salt16 ‖ sha256(salt‖pin)), per-user
  getPin: (userId: string) => get(K.pin(userId)),
  setPin: (userId: string, blob: string) => set(K.pin(userId), blob),
  clearPin: (userId: string) => del(K.pin(userId)),
};
