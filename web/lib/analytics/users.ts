import { db } from "@/lib/db";

/**
 * One indexable Talise subname user — a row in `users` that has claimed a
 * `talise_username`. These are the rows of the analytics dashboard.
 */
export type IndexedUser = {
  userId: number;
  handle: string;
  address: string;
  joinedAt: number;
};

/**
 * List every Talise subname user to index: rows in `users` with a non-null
 * `talise_username`, excluding tombstoned (deleted) addresses.
 *
 * Maps each row to IndexedUser:
 *   • handle    = talise_username (already stored without "@" / ".talise.sui")
 *   • address   = sui_address (0x…)
 *   • joinedAt  = created_at (already epoch ms in this table; BIGINT column
 *                 parsed as a JS number by the db layer)
 *
 * Resilient by contract: on ANY error (DB unreachable, schema drift, …) it
 * returns [] rather than throwing, so a reindex run degrades to "no users"
 * instead of crashing.
 */
export async function listIndexedUsers(): Promise<IndexedUser[]> {
  try {
    const r = await db().execute({
      sql: `SELECT id, talise_username, sui_address, created_at
              FROM users
             WHERE talise_username IS NOT NULL
               AND sui_address NOT LIKE 'deleted:%'`,
      args: [],
    });

    const out: IndexedUser[] = [];
    for (const row of r.rows) {
      const id = Number(row.id);
      const handle = row.talise_username;
      const address = row.sui_address;
      const joinedAt = Number(row.created_at);

      // Defensive: skip malformed rows rather than emit a broken IndexedUser.
      if (!Number.isFinite(id)) continue;
      if (typeof handle !== "string" || handle.length === 0) continue;
      if (typeof address !== "string" || address.length === 0) continue;

      out.push({
        userId: id,
        handle,
        address,
        joinedAt: Number.isFinite(joinedAt) ? joinedAt : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}
