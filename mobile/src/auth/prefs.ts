import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Non-secret app state — mirrors the iOS UserDefaults keys (session timestamps,
 * last user, display snapshots, attest keyId, flags). Secrets live in secure.ts.
 */

const K = {
  lastUserId: "io.talise.snapshot.lastUserId",
  signInAt: "io.talise.session.signInAt",
  attestKeyId: "io.talise.app.attest.keyId",
  biometricRequired: "biometric.required.for.transactions",
  pinFlowReset: "io.talise.pinFlowReset.v1",
  snapshotUser: (userId: string) => `io.talise.snapshot.user.${userId}`,
} as const;

async function getJSON<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
async function setJSON(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const prefs = {
  getLastUserId: () => AsyncStorage.getItem(K.lastUserId),
  setLastUserId: (id: string) => AsyncStorage.setItem(K.lastUserId, id),
  clearLastUserId: () => AsyncStorage.removeItem(K.lastUserId),

  /** Sign-in timestamp (epoch ms) — 3-day session TTL is measured from here. */
  getSignInAt: async (): Promise<number | null> => {
    const v = await AsyncStorage.getItem(K.signInAt);
    return v ? Number(v) : null;
  },
  setSignInAt: (ms: number) => AsyncStorage.setItem(K.signInAt, String(ms)),
  clearSignInAt: () => AsyncStorage.removeItem(K.signInAt),

  getAttestKeyId: () => AsyncStorage.getItem(K.attestKeyId),
  setAttestKeyId: (id: string) => AsyncStorage.setItem(K.attestKeyId, id),

  /** Biometric consent required for fund-moving actions (default true). */
  getBiometricRequired: async (): Promise<boolean> => {
    const v = await AsyncStorage.getItem(K.biometricRequired);
    return v == null ? true : v === "1";
  },
  setBiometricRequired: (on: boolean) => AsyncStorage.setItem(K.biometricRequired, on ? "1" : "0"),

  getPinFlowReset: () => AsyncStorage.getItem(K.pinFlowReset),
  setPinFlowReset: () => AsyncStorage.setItem(K.pinFlowReset, "1"),

  /** Whether the user has signed in before (drives the SignIn screen copy). */
  getHasSignedIn: async (): Promise<boolean> => (await AsyncStorage.getItem("talise.hasSignedInBefore")) === "1",
  setHasSignedIn: () => AsyncStorage.setItem("talise.hasSignedInBefore", "1"),

  // Display-only cached user snapshot (fast launch; never used in money paths)
  getUserSnapshot: <T>(userId: string) => getJSON<T>(K.snapshotUser(userId)),
  setUserSnapshot: (userId: string, user: unknown) => setJSON(K.snapshotUser(userId), user),
  clearUserSnapshot: (userId: string) => AsyncStorage.removeItem(K.snapshotUser(userId)),
};
