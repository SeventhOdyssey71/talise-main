/**
 * memory-client.ts — BROWSER side of the Talise agent's server-blind memory.
 *
 * Server-blind contract: the 32-byte AES key lives ONLY in this device's
 * IndexedDB and is never sent anywhere. The server only ever sees ciphertext
 * (via /api/agent/memory/blob) and an opaque blobId pointer (/api/agent/memory).
 *
 * Everything here DEGRADES SILENTLY: any failure (no key, network, decode,
 * disabled feature returning 404, malformed blob) resolves to an empty result.
 * Nothing thrown here may ever break the chat flow.
 *
 * Codec + types are owned by ./memory (isomorphic, WebCrypto). We only do the
 * browser glue: device key in IndexedDB, fetch the pointer + blob, en/decrypt,
 * a short in-memory cache, MEMORY-fence parsing, and prompt recall lines.
 */

import {
  decryptDoc,
  encryptDoc,
  emptyDoc,
  factsToLines,
  mergeFacts,
  type MemoryDoc,
  type MemoryFact,
  type MemoryFactType,
  type MemoryKeyProvider,
} from "@/lib/agent/memory";

// ---------------------------------------------------------------------------
// Device key provider (IndexedDB-backed, generate-on-first-use)
// ---------------------------------------------------------------------------

const IDB_NAME = "talise-memory";
const IDB_STORE = "keys";
const KEY_ID = "memory-key-v1";
const RAW_KEY_LEN = 32;

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no-indexeddb"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb-open-failed"));
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb-get-failed"));
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb-put-failed"));
  });
}

/**
 * DeviceKeyProvider — a MemoryKeyProvider whose 32-byte raw key is generated
 * once (crypto.getRandomValues) and persisted in IndexedDB. The key never
 * leaves the device. A single in-flight getKey() is shared so concurrent
 * callers don't race two different keys into storage.
 */
export class DeviceKeyProvider implements MemoryKeyProvider {
  private cached: Uint8Array | null = null;
  private inflight: Promise<Uint8Array> | null = null;

  async getKey(): Promise<Uint8Array> {
    if (this.cached) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.loadOrCreate();
    try {
      this.cached = await this.inflight;
      return this.cached;
    } finally {
      this.inflight = null;
    }
  }

  private async loadOrCreate(): Promise<Uint8Array> {
    const db = await openKeyDb();
    try {
      const existing = await idbGet(db, KEY_ID);
      if (existing instanceof Uint8Array && existing.byteLength === RAW_KEY_LEN) {
        return existing;
      }
      if (existing instanceof ArrayBuffer && existing.byteLength === RAW_KEY_LEN) {
        return new Uint8Array(existing);
      }
      const fresh = new Uint8Array(RAW_KEY_LEN);
      globalThis.crypto.getRandomValues(fresh);
      await idbPut(db, KEY_ID, fresh);
      return fresh;
    } finally {
      db.close();
    }
  }
}

/** Shared singleton — one device key per browser profile. */
export const deviceKeyProvider = new DeviceKeyProvider();

// ---------------------------------------------------------------------------
// In-memory cache (~5 min) of the decrypted doc + its pointer
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedDoc: MemoryDoc | null = null;
let cachedBlobId: string | null = null;
let cachedAt = 0;

function cacheFresh(): boolean {
  return cachedDoc !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Load / save against the auth-gated server routes
// ---------------------------------------------------------------------------

/**
 * loadMemory — GET the current pointer, fetch + decrypt its blob.
 * Returns the in-memory cache when fresh. Returns an empty doc (never throws)
 * if memory is disabled, the user has no pointer yet, or anything fails.
 */
export async function loadMemory(force = false): Promise<MemoryDoc> {
  if (!force && cacheFresh()) return cachedDoc as MemoryDoc;

  try {
    const ptrRes = await fetch("/api/agent/memory", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!ptrRes.ok) return rememberEmpty();

    const ptr = (await ptrRes.json()) as { blobId?: string | null };
    const blobId = ptr?.blobId ?? null;
    if (!blobId) return rememberEmpty(null);

    const blobRes = await fetch(
      `/api/agent/memory/blob?id=${encodeURIComponent(blobId)}`,
      { method: "GET" },
    );
    if (!blobRes.ok) return rememberEmpty(blobId);

    const bytes = new Uint8Array(await blobRes.arrayBuffer());
    if (bytes.byteLength === 0) return rememberEmpty(blobId);

    const key = await deviceKeyProvider.getKey();
    const doc = await decryptDoc(bytes, key);

    cachedDoc = doc;
    cachedBlobId = blobId;
    cachedAt = Date.now();
    return doc;
  } catch {
    return rememberEmpty();
  }
}

function rememberEmpty(blobId: string | null = cachedBlobId): MemoryDoc {
  const doc = emptyDoc();
  cachedDoc = doc;
  cachedBlobId = blobId;
  cachedAt = Date.now();
  return doc;
}

/**
 * saveMemory — encrypt the doc, POST the ciphertext to get a fresh blobId,
 * then PUT the pointer. Updates the in-memory cache on success. Returns the
 * new blobId, or null on any failure (degrades silently).
 */
export async function saveMemory(doc: MemoryDoc): Promise<string | null> {
  try {
    const key = await deviceKeyProvider.getKey();
    const blob = await encryptDoc(doc, key);

    const postRes = await fetch("/api/agent/memory/blob", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: blob as BodyInit,
    });
    if (!postRes.ok) return null;

    const { blobId } = (await postRes.json()) as { blobId?: string };
    if (!blobId) return null;

    const putRes = await fetch("/api/agent/memory", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blobId }),
    });
    if (!putRes.ok) return null;

    cachedDoc = doc;
    cachedBlobId = blobId;
    cachedAt = Date.now();
    return blobId;
  } catch {
    return null;
  }
}

/**
 * captureAndPersist — convenience: merge freshly captured facts into the
 * currently-loaded doc and persist. Returns the merged doc (or the prior doc
 * unchanged if there's nothing to add or the save fails).
 */
export async function captureAndPersist(facts: MemoryFact[]): Promise<MemoryDoc> {
  const base = await loadMemory();
  if (facts.length === 0) return base;
  const merged = mergeFacts(base, facts);
  await saveMemory(merged);
  return merged;
}

// ---------------------------------------------------------------------------
// MEMORY fence parsing (mirror of the ---INTENT---{json}---END--- parser)
// ---------------------------------------------------------------------------

const MEMORY_FENCE = /---MEMORY---\s*([\s\S]*?)\s*---END---/m;

const FACT_TYPES: readonly MemoryFactType[] = [
  "payee",
  "preference",
  "goal",
  "local-currency",
  "activity-summary",
];

function isFactType(v: unknown): v is MemoryFactType {
  return typeof v === "string" && (FACT_TYPES as readonly string[]).includes(v);
}

/**
 * captureMemoryBlock — pull a `---MEMORY---{...}---END---` fence out of the
 * assistant stream and return validated MemoryFact[]. The inner JSON may be
 * either a bare array of facts or `{ "facts": [...] }`. Each fact must have a
 * known type plus string key/value; ts defaults to now, confidence is optional.
 * Returns [] on no fence / malformed JSON / no valid facts (never throws).
 */
export function captureMemoryBlock(streamText: string): MemoryFact[] {
  const m = streamText.match(MEMORY_FENCE);
  if (!m) return [];

  try {
    const parsed = JSON.parse(m[1].trim()) as unknown;
    const rawFacts: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { facts?: unknown[] })?.facts)
        ? ((parsed as { facts: unknown[] }).facts)
        : [];

    const out: MemoryFact[] = [];
    for (const r of rawFacts) {
      if (!r || typeof r !== "object") continue;
      const f = r as Record<string, unknown>;
      if (!isFactType(f.type)) continue;
      if (typeof f.key !== "string" || typeof f.value !== "string") continue;
      if (!f.key.trim() || !f.value.trim()) continue;
      out.push({
        type: f.type,
        key: f.key.trim(),
        value: f.value.trim(),
        ts: typeof f.ts === "number" && Number.isFinite(f.ts) ? f.ts : Date.now(),
        confidence:
          typeof f.confidence === "number" && Number.isFinite(f.confidence)
            ? f.confidence
            : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * stripMemoryBlock — remove the `---MEMORY---{...}---END---` fence from a
 * rendered assistant message so the raw JSON never flashes to the user
 * (mirrors how AgentChat strips the ---INTENT--- block).
 */
export function stripMemoryBlock(raw: string): string {
  let out = raw;
  let open: number;
  while ((open = out.indexOf("---MEMORY---")) !== -1) {
    const endTag = "---END---";
    const close = out.indexOf(endTag, open);
    if (close === -1) {
      // Unterminated fence (still streaming) — hide from the open tag onward.
      out = out.slice(0, open);
      break;
    }
    out = out.slice(0, open) + out.slice(close + endTag.length);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Recall — human lines for the chat request body / prompt injection
// ---------------------------------------------------------------------------

/**
 * recallLines — load the current memory and render it as human prompt lines
 * (e.g. "payee: mum = mum@talise") to attach to the chat request body so the
 * agent has context. Returns [] on any failure.
 */
export async function recallLines(max?: number): Promise<string[]> {
  try {
    const doc = await loadMemory();
    return factsToLines(doc, max);
  } catch {
    return [];
  }
}

/** Drop the in-memory cache (e.g. on sign-out / account switch). */
export function clearMemoryCache(): void {
  cachedDoc = null;
  cachedBlobId = null;
  cachedAt = 0;
}
