/**
 * Talise shielded-pool SDK — trial-decrypt scanning.
 *
 * The recipient discovers incoming notes by fetching every emitted commitment
 * (+ its encrypted output ciphertext) from the indexer and trial-decrypting
 * each ciphertext with the viewing key. A successful decrypt whose recomputed
 * commitment matches the on-chain commitment is one of the recipient's notes.
 *
 * The commitments feed is served by `/api/shield/commitments` (owned by the
 * indexer/merkle agent — Workstream C). This module only CONSUMES it; the exact
 * row shape is defined defensively here and adjusted when that route lands.
 *
 * CRYPTO STATUS: the decrypt step + commitment recompute use the STUBBED
 * Poseidon / encryption (see keys.ts, encrypt.ts). The scan LOOP itself (fetch,
 * paginate, match) is real.
 */

import { decryptNote } from "./encrypt";
import { noteCommitment, type SpendableNote } from "./note";

/** A commitment row as served by `/api/shield/commitments`. */
export type CommitmentRow = {
  /** Leaf index in the Merkle tree. */
  leafIndex: number;
  /** The on-chain commitment field element (decimal string for u256 safety). */
  commitment: string;
  /** Hex (0x…) of the `encrypted_output` ciphertext for this leaf. */
  encryptedOutput: string;
};

export type ScanOptions = {
  /** Base URL for the commitments API. Default same-origin `/api/shield/commitments`. */
  baseUrl?: string;
  /** Custom fetch (tests / RN). Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Only scan leaves at/after this index (incremental rescan). Default 0. */
  fromLeafIndex?: number;
  /** Page size for the cursor fetch. Default 500. */
  pageSize?: number;
};

/**
 * Scan the commitments feed and return the notes that belong to `viewingKey`.
 * Pure consumer of the indexer — never signs, never holds spend authority.
 */
export async function scanNotes(
  viewingKey: bigint,
  opts: ScanOptions = {}
): Promise<SpendableNote[]> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? "/api/shield/commitments";
  const pageSize = opts.pageSize ?? 500;
  let cursor = opts.fromLeafIndex ?? 0;

  const found: SpendableNote[] = [];

  // Bounded cursor walk: stop when a page returns fewer rows than requested.
  for (;;) {
    const url = `${baseUrl}?from=${cursor}&limit=${pageSize}`;
    const res = await doFetch(url);
    if (!res.ok) {
      throw new Error(`scan fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as { commitments?: CommitmentRow[] };
    const rows = json.commitments ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const note = tryDecryptRow(row, viewingKey);
      if (note) found.push(note);
    }

    if (rows.length < pageSize) break;
    cursor = rows[rows.length - 1].leafIndex + 1;
  }

  return found;
}

/**
 * Trial-decrypt one row. Returns the note iff (a) decrypt succeeds AND (b) the
 * recomputed commitment matches the on-chain commitment — the binding check
 * that turns a weak stub-decrypt accept into a real match.
 */
export function tryDecryptRow(
  row: CommitmentRow,
  viewingKey: bigint
): SpendableNote | null {
  const ct = hexToBytes(row.encryptedOutput);
  if (!ct) return null;
  const note = decryptNote(ct, viewingKey);
  if (!note) return null;

  const recomputed = noteCommitment(note);
  let onchain: bigint;
  try {
    onchain = BigInt(row.commitment);
  } catch {
    return null;
  }
  if (recomputed !== onchain) return null;

  return { ...note, commitment: recomputed, leafIndex: row.leafIndex };
}

function hexToBytes(hex: string): Uint8Array | null {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}
