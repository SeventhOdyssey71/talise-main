import { secure } from "@/auth/secure";

/**
 * ProofCache — the zkLogin session material: maxEpoch, jwtRandomness, and the
 * (optional) minted ZK proof. Persisted in the keychain and re-hydrated on
 * launch (sessionCredentialsPresent() requires maxEpoch != null).
 *
 * CRITICAL: `proof` is kept as a parsed OBJECT and forwarded as-is in request
 * bodies — never re-stringified into a string field, or the server's valibot
 * rejects it ("Expected object, found string").
 */
export type ProofPoints = Record<string, unknown>;
export type Proof = { proofPoints?: ProofPoints } & Record<string, unknown>;

export type ProofCacheData = {
  maxEpoch: number;
  jwtRandomness: string;
  proof?: Proof | null;
};

let cached: ProofCacheData | null = null;
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const raw = await secure.getProofCache();
  if (raw) {
    try {
      cached = JSON.parse(raw) as ProofCacheData;
    } catch {
      cached = null;
    }
  }
}

async function persist(): Promise<void> {
  if (cached) await secure.setProofCache(JSON.stringify(cached));
  else await secure.clearProofCache();
}

export const proofCache = {
  async get(): Promise<ProofCacheData | null> {
    await hydrate();
    return cached;
  },
  async maxEpoch(): Promise<number | null> {
    await hydrate();
    return cached?.maxEpoch ?? null;
  },
  async set(data: ProofCacheData): Promise<void> {
    await hydrate();
    cached = data;
    await persist();
  },
  /** Store a freshly-minted proof, keeping maxEpoch/randomness. */
  async setProof(proof: Proof | null): Promise<void> {
    await hydrate();
    if (!cached) return;
    cached = { ...cached, proof };
    await persist();
  },
  /** Only forward a proof that is a real object with a proofPoints object. */
  async validProof(): Promise<Proof | null> {
    await hydrate();
    const p = cached?.proof;
    if (p && typeof p === "object" && p.proofPoints && typeof p.proofPoints === "object") return p;
    return null;
  },
  async clear(): Promise<void> {
    cached = null;
    hydrated = true;
    await secure.clearProofCache();
  },
};
