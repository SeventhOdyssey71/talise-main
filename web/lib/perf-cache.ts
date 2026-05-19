type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

/**
 * Tiny in-memory TTL cache for server-side hot-path values like
 * `onara.status()` and `getReferenceGasPrice()`. Lives for the lifetime
 * of the Node process — Next.js Node runtime keeps modules alive across
 * requests so this works in practice.
 *
 * Not safe for per-user secrets. Only use for values that are global
 * and cheap to refetch if the cache is wrong.
 */
export async function memoTtl<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(key: string) {
  store.delete(key);
}
