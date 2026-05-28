---
title: "Talise — Sui RPC Migration Patterns"
subtitle: "Recipe book for Phase 1 sub-plans: JSON-RPC → gRPC / GraphQL"
author: "Talise Engineering"
date: "2026-05-28"
toc: true
toc-depth: 2
---

# How to use this doc

Every Phase 1 sub-plan migrates one or more JSON-RPC sites to gRPC (point reads,
execution, lookups) or GraphQL (paginated history, multi-entity reads). This
file is a recipe book: pick the pattern that matches your site, copy the
before/after, swap field paths per the shape diff, and watch for the listed
pitfalls.

**Canonical clients.**

- `sui()` — `SuiGrpcClient`, defined in `web/lib/sui.ts`. Default for everything.
- `suiGraphQL()` — `SuiGraphQLClient`, defined in `web/lib/sui-graphql.ts`
  (added in 0.3). Used only for cursor-paginated history queries.
- `suiJsonRpc()` — `SuiJsonRpcClient`, defined in `web/lib/sui.ts`. **Deleted at
  the end of Phase 5.** Do not introduce new call sites.

**Normalizer.** For `getTransaction`, all four verifier sites consume a
canonical shape produced by `normalizeTransactionShape()` (defined in
`web/lib/sui-shapes.ts`, stub in 0.7, impl in 1.3). Verifier sub-plans 1.4–1.7
read from the normalized shape; the helper hides which transport was used.

---

# Pattern 1 — `getObject` → `core.getObject`

Used by: `/api/pk/status` (1.2), `/api/vault/state` Bag reads (1.10), the
verifier helpers indirectly.

## Before (JSON-RPC)

From `web/app/api/pk/status/route.ts:58-65`:

```ts
const o = await jsonRpcClient.getObject({
  id: registryId,
  options: { showType: true },
});
registryExists = !!o?.data?.objectId;
```

For full content reads (e.g. `/api/vault/state` Shared Cap inspection,
`web/app/api/vault/state/route.ts:218-247`):

```ts
const obj = await client.getObject({
  id: capId,
  options: { showOwner: true, showType: true, showContent: true },
});
const d = obj.data;
const isShared = Boolean((d.owner as { Shared?: unknown })?.Shared);
const t = d.type;                           // string
const content = d.content;                  // { dataType, fields, ... }
const fields = (content as { fields: unknown }).fields;
```

## After (gRPC)

```ts
const o = await sui().getObject({
  objectId: registryId,
  include: { content: true },  // omit if you only need version/digest/type
});
registryExists = !!o.object?.objectId;

// Full content read:
const obj = await sui().getObject({
  objectId: capId,
  include: { content: true, owner: true, objectType: true },
});
const d = obj.object;
const isShared = d.owner?.kind === "shared";  // discriminated kind, not nested key
const t = d.objectType;                       // top-level, not nested
const fields = d.content?.json;               // parsed move object, key/value
```

## Shape diff

| Concept | JSON-RPC path | gRPC path |
|---|---|---|
| Wrapper | `res.data` | `res.object` |
| Object id | `res.data.objectId` | `res.object.objectId` |
| Version (seq) | `res.data.version` (string) | `res.object.version` (bigint-string) |
| Digest | `res.data.digest` | `res.object.digest` |
| Type | `res.data.type` | `res.object.objectType` |
| Owner — Address | `res.data.owner.AddressOwner` (string) | `res.object.owner.kind === "address"` then `res.object.owner.address` |
| Owner — Shared | `res.data.owner.Shared` (object) | `res.object.owner.kind === "shared"` |
| Owner — Object | `res.data.owner.ObjectOwner` (string) | `res.object.owner.kind === "object"` then `res.object.owner.address` |
| Move object fields | `res.data.content.fields` (after `dataType === "moveObject"` check) | `res.object.content.json` (already parsed) |
| BCS bytes | `res.data.bcs.bcsBytes` (under `showBcs`) | `res.object.content.bcs` (`include.content` returns both) |

## Common pitfalls

- gRPC requires `include` flags; without `include.content` the `content` field is `undefined` (not `{ dataType: "package" }`-style sentinel).
- Owner is a discriminated union with `.kind`; the JSON-RPC `AddressOwner` / `Shared` / `ObjectOwner` key-based shape doesn't appear.
- `content.json` is already a JS object (no `fields` indirection, no `dataType` guard needed).
- gRPC throws on missing object; JSON-RPC returned `{ data: null, error: {...} }`. Wrap in try/catch for "exists?" checks.

---

# Pattern 2 — `getBalance` → `core.listBalances`

Used by: `/api/pk/status` operator balance (1.2), `lib/sui.ts` `getSuiBalance` etc.

## Before (JSON-RPC)

From `web/app/api/pk/status/route.ts:42-46`:

```ts
const bal = await jsonRpcClient.getBalance({
  owner: operatorAddress,
  coinType: "0x2::sui::SUI",
});
operatorBalanceSui = Number(bal.totalBalance) / 1e9;
```

## After (gRPC)

Two shapes depending on whether you want one coin or every coin the address holds:

```ts
// Singular — use the SDK's gRPC convenience wrapper (returns ONE Balance).
const res = await sui().getBalance({
  owner: operatorAddress,
  coinType: "0x2::sui::SUI",
});
const mistStr = res.balance.balance;
operatorBalanceSui = Number(BigInt(mistStr)) / 1e9;

// Plural — when you need every coin the address holds (portfolio view).
const list = await sui().listBalances({ owner: operatorAddress });
for (const b of list.balances) {
  console.log(b.coinType, b.balance);
}
```

`sui()` (`SuiGrpcClient`) exposes both `getBalance` (singular convenience) and
`listBalances` (the raw gRPC list call). Singular is just a filtered wrapper
around the list method.

## Shape diff

| Concept | JSON-RPC `getBalance` | gRPC `getBalance` | gRPC `listBalances` |
|---|---|---|---|
| Total amount | `bal.totalBalance` (string) | `res.balance.balance` (string) | `list.balances[i].balance` (string) |
| Coin type | `bal.coinType` (string) | `res.balance.coinType` (string) | `list.balances[i].coinType` (string) |
| Coin object count | `bal.coinObjectCount` (number) | not exposed | not exposed |
| Locked balance | `bal.lockedBalance` (object) | not exposed | not exposed |
| List shape | n/a (singular call) | n/a (singular wrapper) | `list.balances: Balance[]` |
| Pagination | n/a | n/a | none — single round-trip returns all balances |

## Common pitfalls

- `totalBalance` is gone; the field is `balance` and the wrapper is `res.balance` (nested).
- `coinObjectCount` and `lockedBalance` don't have gRPC equivalents. Sites that read them (none today, but watch in code review) need a `listCoins` follow-up to count.
- `listBalances` does NOT paginate — it's a single response. If an address holds 100k coin types this could be large; in practice Sui addresses hold <50.
- When the address has zero of `coinType`, gRPC still returns `res.balance` with `balance: "0"` (no throw). JSON-RPC did the same. Safe to read directly.

---

# Pattern 3 — `getCoins` → `core.listCoins` (cursor)

Used by: `lib/zkclient.ts` USDsui coin discovery (1.10), any PTB that splits coins.

## Before (JSON-RPC)

From `web/lib/zkclient.ts:560-566`:

```ts
const coinsRes = await client.getCoins({
  owner: opts.senderAddress,
  coinType: USDSUI_COIN_TYPE,
});
const coins = (coinsRes.data ?? []).slice().sort((a, b) =>
  BigInt(b.balance) - BigInt(a.balance) > 0n ? 1 : -1
);
const primary = tx.object(coins[0].coinObjectId);
```

## After (gRPC)

```ts
const coinsRes = await sui().listCoins({
  owner: opts.senderAddress,
  coinType: USDSUI_COIN_TYPE,
  limit: 50,           // default 50; bump to 200 for whales
  // cursor: undefined on first page
});
const coins = (coinsRes.coins ?? []).slice().sort((a, b) =>
  BigInt(b.balance) - BigInt(a.balance) > 0n ? 1 : -1
);
const primary = tx.object(coins[0].coinObjectId);

// If hasNextPage, walk:
let cursor = coinsRes.nextCursor;
while (cursor) {
  const page = await sui().listCoins({
    owner: opts.senderAddress,
    coinType: USDSUI_COIN_TYPE,
    limit: 50,
    cursor,
  });
  coins.push(...(page.coins ?? []));
  cursor = page.nextCursor;
}
```

## Shape diff

| Concept | JSON-RPC | gRPC |
|---|---|---|
| Data array | `res.data` (array of CoinStruct) | `res.coins` (array of Coin) |
| Cursor | `res.nextCursor` (string, ObjectID-like) | `res.nextCursor` (opaque string — DO NOT parse) |
| Has-next flag | `res.hasNextPage` (boolean) | not exposed — check `res.nextCursor != null` instead |
| Coin id | `data[i].coinObjectId` | `coins[i].coinObjectId` (same key) |
| Balance | `data[i].balance` (string) | `coins[i].balance` (string) |
| Version | `data[i].version` | `coins[i].version` |
| Digest | `data[i].digest` | `coins[i].digest` |
| Coin type | `data[i].coinType` | `coins[i].coinType` |

## Common pitfalls

- `hasNextPage` flag is gone — `nextCursor` is the only signal. Stop when it's null/undefined.
- gRPC cursor is OPAQUE — don't decode, slice, or compare it. JSON-RPC's cursor happened to be an ObjectID; gRPC's is a base64-encoded protobuf state.
- `limit` default is 50 on both transports. Bumping past ~200 returns `RESOURCE_EXHAUSTED` on the public endpoint.
- Coin sort order is NOT guaranteed across pages. Collect all then sort, don't assume descending balance.

---

# Pattern 4 — `getOwnedObjects` → `core.listOwnedObjects` (filter + cursor)

Used by: `lib/suins-lookup.ts` (1.10), `lib/deepbook-margin.ts` (1.10).

## Before (JSON-RPC)

From `web/lib/deepbook-margin.ts:121-126`:

```ts
const objs = await client.getOwnedObjects({
  owner: address,
  filter: { StructType: SUPPLIER_CAP_TYPE },
  options: { showContent: true },
});
return objs.data[0]?.data?.objectId ?? null;
```

From `web/lib/suins-lookup.ts:85-100` (with display + pagination):

```ts
const r = await client.getOwnedObjects({
  owner,
  options: { showType: true, showDisplay: true },
  cursor,
});
for (const o of r.data ?? []) {
  const t = o.data?.type ?? "";
  if (!/subdomain_registration::SubDomainRegistration/.test(t)) continue;
  const name = o.data?.display?.data?.name ?? "";
  // ...
}
if (!r.hasNextPage || !r.nextCursor) break;
cursor = r.nextCursor;
```

## After (gRPC)

```ts
const objs = await sui().listOwnedObjects({
  owner: address,
  filter: { structType: SUPPLIER_CAP_TYPE },  // camelCase!
  include: { content: true },
  limit: 50,
});
return objs.objects[0]?.objectId ?? null;

// With display + pagination:
const r = await sui().listOwnedObjects({
  owner,
  include: { objectType: true, display: true },
  limit: 50,
  cursor,
});
for (const o of r.objects ?? []) {
  const t = o.objectType ?? "";
  if (!/subdomain_registration::SubDomainRegistration/.test(t)) continue;
  const name = o.display?.name ?? "";
  // ...
}
if (!r.nextCursor) break;
cursor = r.nextCursor;
```

## Shape diff

| Concept | JSON-RPC | gRPC |
|---|---|---|
| Filter key | `filter.StructType` (PascalCase) | `filter.structType` (camelCase) |
| Filter — package | `filter.Package` | `filter.package` |
| Filter — MoveModule | `filter.MoveModule: { package, module }` | `filter.moveModule: { package, module }` |
| Data array | `res.data[].data` (double-nested) | `res.objects[]` (flat) |
| Object id | `data[i].data.objectId` | `objects[i].objectId` |
| Type | `data[i].data.type` | `objects[i].objectType` |
| Display | `data[i].data.display.data.name` | `objects[i].display.name` (no `.data` wrapper) |
| Content fields | `data[i].data.content.fields` (after `dataType === "moveObject"`) | `objects[i].content.json` |
| Cursor | `res.nextCursor` + `res.hasNextPage` | `res.nextCursor` only |

## Common pitfalls

- **Filter is camelCased.** `StructType` → `structType`. This is the #1 silent miss in code review.
- The double-nested `data[].data` envelope is flattened to `objects[]`. Strip the inner `.data` access everywhere.
- `display` payload is no longer wrapped in `.data` — `display.name` not `display.data.name`.
- `limit` default is 50, max 1000 (gRPC) vs 50 max (JSON-RPC). Up the limit when scanning whales.
- `filter.MatchAll` / `MatchAny` JSON-RPC compositions don't have gRPC equivalents. Compose client-side: list-all + filter in TS.

---

# Pattern 5 — `getTransactionBlock` → `core.getTransaction` ⚠ LARGEST DIFF

Used by: `/api/tx/record` (1.4), `/api/vault/record` (1.5), `/api/vault/migrate-confirm` (1.6), `/api/vault/repoint-confirm` (1.7).

**All four sites consume the normalized shape from `normalizeTransactionShape()`
(`web/lib/sui-shapes.ts`).** The helper is what you call — do not call
`sui().getTransaction()` directly in route handlers.

## Before (JSON-RPC)

From `web/app/api/tx/record/route.ts:224-258`:

```ts
const tx = await suiJsonRpc().getTransactionBlock({
  digest: input.digest,
  options: {
    showEffects: true,
    showBalanceChanges: true,
    showInput: false,
    showEvents: false,
  },
});

const status = tx?.effects?.status?.status;        // "success" | "failure"
if (status !== "success") {
  return { ok: false, reason: `tx status is ${status ?? "unknown"}` };
}

const changes = tx.balanceChanges ?? [];
for (const c of changes) {
  const owner = typeof c.owner === "object" && c.owner && "AddressOwner" in c.owner
    ? (c.owner.AddressOwner as string).toLowerCase()
    : null;
  if (!owner || owner !== merchantAddress) continue;
  if (!isUsdsui(c.coinType)) continue;
  const delta = BigInt(c.amount);                  // signed string
  if (delta > 0n) merchantReceivedMicro += delta;
}
```

## After (gRPC)

```ts
import { fetchAndNormalizeTransaction } from "@/lib/sui-shapes";

const tx = await fetchAndNormalizeTransaction(input.digest, {
  effects: true,
  balanceChanges: true,
});
if (tx.status !== "success") {
  return { ok: false, reason: `tx status is ${tx.status}` };
}
for (const c of tx.balanceChanges) {
  if (c.ownerAddress !== merchantAddress) continue;
  if (!isUsdsui(c.coinType)) continue;
  if (c.amount > 0n) merchantReceivedMicro += c.amount;
}
```

Internally the helper calls:

```ts
const res = await sui().getTransaction({
  digest,
  include: { effects: true, events: true, transaction: true, balanceChanges: true },
});
```

and normalizes the proto-shaped response into a flat TS type.

## Shape diff (raw — what `normalizeTransactionShape` hides)

| Concept | JSON-RPC path | gRPC path |
|---|---|---|
| Top wrapper | `tx` (the response IS the tx) | `res.transaction` |
| Digest | `tx.digest` | `res.transaction.digest` |
| Status | `tx.effects.status.status` (`"success"` / `"failure"`) | `res.transaction.effects.status.kind` (`"success"` / `"failure"` — but key is `kind` not `status`) |
| Failure reason | `tx.effects.status.error` (string) | `res.transaction.effects.status.error` (proto-shaped: `{ code, message }`) |
| Sender | `tx.transaction.data.sender` | `res.transaction.transaction.sender` (one level flatter) |
| Gas owner | `tx.transaction.data.gasData.owner` | `res.transaction.transaction.gasData.owner` |
| Gas budget | `tx.transaction.data.gasData.budget` | `res.transaction.transaction.gasData.budget` |
| Gas price | `tx.transaction.data.gasData.price` | `res.transaction.transaction.gasData.price` |
| Gas payment | `tx.transaction.data.gasData.payment[]` | `res.transaction.transaction.gasData.payment[]` |
| Tx kind | `tx.transaction.data.transaction.kind` (e.g. `"ProgrammableTransaction"`) | `res.transaction.transaction.kind` (one level flatter) |
| PTB commands | `tx.transaction.data.transaction.transactions[]` | `res.transaction.transaction.commands[]` |
| PTB inputs | `tx.transaction.data.transaction.inputs[]` | `res.transaction.transaction.inputs[]` |
| Object changes | `tx.objectChanges[]` (top-level array of `{ type: "created" \| "mutated" \| ... }`) | `res.transaction.objectChanges[]` (under `transaction`, with `kind` discriminator instead of `type`) |
| Object change discriminator | `change.type === "created"` | `change.kind === "created"` |
| Created object id | `change.objectId` | `change.objectId` (same key) |
| Created object type | `change.objectType` | `change.objectType` (same key) |
| Owner of created obj | `change.owner.AddressOwner` | `change.owner.kind === "address"` then `change.owner.address` |
| Balance changes | `tx.balanceChanges[]` | `res.transaction.balanceChanges[]` |
| Balance change owner | `c.owner.AddressOwner` (string OR `{Shared}` etc.) | `c.owner.kind === "address"` then `c.owner.address` |
| Balance change amount | `c.amount` (signed string) | `c.amount` (signed string — same) |
| Balance change coinType | `c.coinType` | `c.coinType` (same) |
| Effects.created[] | `tx.effects.created[]` with `{ owner, reference: { objectId, version, digest } }` | `res.transaction.effects.created[]` flat `{ objectId, version, digest, owner }` |
| Effects.mutated[] | `tx.effects.mutated[]` (same shape as created) | `res.transaction.effects.mutated[]` flat |
| Events | `tx.events[]` with `{ id: {txDigest, eventSeq}, packageId, transactionModule, sender, type, parsedJson, bcs, timestampMs }` | `res.transaction.events.events[]` (extra `.events` envelope) with `{ packageId, module, sender, eventType, parsedJson, bcs }` |
| Event type key | `ev.type` | `ev.eventType` |
| Event module | `ev.transactionModule` | `ev.module` |
| Event txDigest | `ev.id.txDigest` | derived: outer `res.transaction.digest` (events don't carry their own copy) |
| Timestamp | `tx.timestampMs` (string ms since epoch) | `res.transaction.timestamp` (RFC3339 string — needs `Date.parse`) |
| Checkpoint | `tx.checkpoint` | `res.transaction.checkpoint` |

## Normalized shape (what every verifier site reads)

```ts
// web/lib/sui-shapes.ts
export type NormalizedTransaction = {
  digest: string;
  status: "success" | "failure";
  errorMessage: string | null;
  sender: string;
  gasOwner: string;
  gasBudget: bigint;
  gasPrice: bigint;
  timestampMs: number;
  checkpoint: string | null;
  balanceChanges: Array<{
    ownerKind: "address" | "object" | "shared" | "immutable";
    ownerAddress: string | null;      // null for shared/immutable
    coinType: string;
    amount: bigint;                   // signed
  }>;
  objectChanges: Array<{
    kind: "created" | "mutated" | "deleted" | "wrapped" | "transferred" | "published";
    objectId: string;
    objectType: string | null;
    ownerKind: "address" | "object" | "shared" | "immutable" | null;
    ownerAddress: string | null;
  }>;
  events: Array<{
    packageId: string;
    module: string;
    eventType: string;                // canonical "0x...::module::EventName"
    sender: string;
    parsedJson: unknown;
  }>;
};
```

## Common pitfalls

- **Don't call `sui().getTransaction()` directly in route handlers.** Use `normalizeTransactionShape()`. The verifier code must not branch on transport.
- `effects.status.status` is now `effects.status.kind`. Easy regression.
- `objectChanges[].type` is now `kind`. The filter logic in `groupCreated` (`lib/zkclient.ts:267-279`) reads `c.type === "created"` — that file gets touched in 1.10.
- Owner is `{ kind: "address", address: "0x..." }` not `{ AddressOwner: "0x..." }`. The verifier in `tx/record` walks this — that's why the normalizer flattens it into `ownerAddress`.
- `timestamp` is RFC3339 (e.g. `"2026-05-27T15:30:00.000Z"`) not epoch-ms string. Convert with `Date.parse(ts)` if you need ms.
- Events are double-nested: `res.transaction.events.events[]`. Yes, really.
- `include.transaction` must be true to get `sender`, `gasData`, `commands`, `inputs`. Without it the inner `transaction` field is undefined.

---

# Pattern 6 — `executeTransactionBlock` → `core.executeTransaction`

Used by: `lib/zkclient.ts` user-paid path (1.10), `lib/suins-operator.ts` mint (1.10).

The hot path (`/api/send/gasless-submit/route.ts:89`) already uses gRPC and is
the canonical example.

## Before (JSON-RPC)

From `web/lib/suins-operator.ts:130-134`:

```ts
const result = await client.executeTransactionBlock({
  transactionBlock: bytes,          // Uint8Array — base64-encoded over the wire
  signature,                        // base64 string
  options: { showEffects: true, showObjectChanges: true },
});

if (result.effects?.status?.status !== "success") {
  const reason = result.effects?.status?.error ?? "unknown failure";
  throw new Error(`subname mint failed: ${reason}`);
}

for (const ch of result.objectChanges ?? []) {
  // c.type, c.objectId, c.objectType
}
```

## After (gRPC)

From `web/app/api/send/gasless-submit/route.ts:89-92` (already migrated, use as reference):

```ts
const result = (await sui().executeTransaction({
  transaction: fromBase64(body.bytesB64),   // Uint8Array — NOT base64
  signatures: [zkLoginSignature],           // PLURAL — array of base64 strings
})) as Record<string, unknown>;

// Result is a discriminated union — Onara-style.
const txInner =
  (result.Transaction as { digest?: string } | undefined) ??
  (result.FailedTransaction as { digest?: string } | undefined);
const digest = (result.digest as string | undefined) ?? txInner?.digest ?? "";
```

## Shape diff

| Concept | JSON-RPC | gRPC |
|---|---|---|
| Tx bytes param | `transactionBlock` (`Uint8Array` OR base64 string) | `transaction` (`Uint8Array` ONLY — no base64 string accepted) |
| Signature param | `signature` (singular, base64) OR `signature: string[]` | `signatures` (plural, base64 strings) |
| Options param | `options.showEffects`, `options.showObjectChanges`, etc. | `include.effects`, `include.objectChanges`, `include.events` |
| Discriminator | none — flat object | `result.$kind` is `"Transaction"` or `"FailedTransaction"`; payload at `result.Transaction` or `result.FailedTransaction` |
| Digest | `result.digest` | `result.digest` (top-level) AND `result.Transaction.digest` (also) |
| Status | `result.effects.status.status` | `result.Transaction.effects.status.kind` (if success); on failure use `$kind === "FailedTransaction"` |
| Object changes | `result.objectChanges[]` | `result.Transaction.objectChanges[]` (when `include.objectChanges`) |
| Effects | `result.effects` | `result.Transaction.effects` |

## Common pitfalls

- **`transaction` is `Uint8Array`, not base64.** Wrap with `fromBase64(...)` if you have base64 from the client.
- **`signatures` is plural even for one sig.** Always wrap in an array.
- **Discriminated result.** A failed tx returns `$kind: "FailedTransaction"` with NO `Transaction` key. Always read digest via the union pattern in the example above.
- The gasless path also passes `signal: AbortSignal` (timeout) — keep that when migrating user-paid paths in 1.10.
- gRPC executeTransaction does NOT wait for the next checkpoint before returning. Reads issued immediately after may be stale by one checkpoint. For verifier flows, the JSON-RPC `waitForLocalExecution` knob is gone — if you need read-after-write semantics, poll `core.getTransaction(digest)` until it appears.

---

# Pattern 7 — `queryEvents` (paginated history) → GraphQL

gRPC has `subscriptionService.subscribeEvents` (streaming forward from now),
NOT a paginated historical query. Use GraphQL for any code that walks past
events.

Used by: `lib/activity.ts` (1.8), `/api/cron/auto-swap-sweep` (1.9), `/api/vault/state` event scans (1.10).

## Before (JSON-RPC)

From `web/lib/activity.ts:704-723`:

```ts
const page = await c.queryEvents<P>({
  query: { MoveEventType: moveEventType },
  cursor,
  limit: Math.min(FETCH_LIMIT, MAX_SCAN - scanned),
  order: "descending",
});
for (const ev of page.data ?? []) {
  if (!ev.parsedJson) continue;
  const digest = ev.id?.txDigest;
  out.push({
    digest,
    timestampMs: Number(ev.timestampMs ?? 0),
    parsedJson: ev.parsedJson,
  });
}
if (!page.hasNextPage || !page.nextCursor) break;
cursor = page.nextCursor;
```

## After (GraphQL)

```ts
import { suiGraphQL } from "@/lib/sui-graphql";
import { graphql } from "@mysten/sui/graphql/schemas/latest";

const EVENTS_QUERY = graphql(`
  query EventsByType($type: String!, $first: Int!, $after: String) {
    events(
      filter: { emittingModule: $type }
      first: $first
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sendingModule { name package { address } }
        type { repr }
        sender { address }
        contents { json }
        timestamp
        transactionBlock { digest }
      }
    }
  }
`);

let cursor: string | null = null;
let scanned = 0;
while (scanned < MAX_SCAN) {
  const res = await suiGraphQL().query({
    query: EVENTS_QUERY,
    variables: { type: moveEventType, first: 50, after: cursor },
  });
  const page = res.data?.events;
  if (!page) break;
  for (const ev of page.nodes ?? []) {
    scanned++;
    if (!ev.contents?.json) continue;
    out.push({
      digest: ev.transactionBlock?.digest ?? "",
      timestampMs: Date.parse(ev.timestamp ?? "") || 0,
      parsedJson: ev.contents.json as P,
    });
  }
  if (!page.pageInfo.hasNextPage) break;
  cursor = page.pageInfo.endCursor;
}
```

## Shape diff

| Concept | JSON-RPC `queryEvents` | GraphQL `events` |
|---|---|---|
| Filter — by Move event type | `query.MoveEventType: "0x...::mod::Evt"` | `filter.emittingModule: "0x...::mod"` + post-filter on `type.repr` OR `filter.eventType: "0x...::mod::Evt"` |
| Filter — by sender | `query.Sender: "0x..."` | `filter.sender: "0x..."` |
| Filter — by package | `query.Package: "0x..."` | `filter.emittingModule: "0x..."` (package address only) |
| Pagination cursor (in) | `cursor: string \| null` | `after: string \| null` (Relay) |
| Pagination limit | `limit: number` | `first: number` |
| Order | `order: "descending" \| "ascending"` | descending by default — pass `last`/`before` for ascending |
| Data array | `res.data[]` | `res.events.nodes[]` |
| Has-next | `res.hasNextPage` | `res.events.pageInfo.hasNextPage` |
| Next cursor | `res.nextCursor` | `res.events.pageInfo.endCursor` |
| Event txDigest | `ev.id.txDigest` | `ev.transactionBlock.digest` |
| Event seq within tx | `ev.id.eventSeq` (string) | implicit by array order |
| Parsed JSON | `ev.parsedJson` | `ev.contents.json` |
| BCS bytes | `ev.bcs` (base64) | `ev.contents.bcs` (base64) |
| Type | `ev.type` (string) | `ev.type.repr` (string) |
| Sender | `ev.sender` | `ev.sender.address` |
| Module | `ev.transactionModule` | `ev.sendingModule.name` |
| Timestamp | `ev.timestampMs` (string ms) | `ev.timestamp` (RFC3339 string — parse with `Date.parse`) |

## Common pitfalls

- GraphQL's `filter.emittingModule` is package OR `0x...::module` — NOT the full `0x...::module::EventType`. For event-type filtering, use `filter.eventType` instead, or scan-and-filter client side.
- Timestamp is RFC3339 not epoch-ms. Same gotcha as `getTransaction`.
- Cursor format is base64-Relay (`"eyJ0eX..."`). Opaque. Don't decode.
- Public GraphQL endpoint rate-limits at ~20 req/sec. Long walks (`MAX_SCAN > 5000`) need throttling.
- GraphQL response keys are camelCased fields under the schema; if you use the codegen from 2.6, generated types match the schema exactly.

---

# Pattern 8 — `queryTransactionBlocks` (paginated tx history) → GraphQL

gRPC has no equivalent at all — there's no cursor-paginated tx-history method.
This is GraphQL-only.

Used by: `lib/activity.ts` (1.8).

## Before (JSON-RPC)

From `web/lib/activity.ts:921-941`:

```ts
const [from, to] = await Promise.all([
  client.queryTransactionBlocks({
    filter: { FromAddress: address },
    options: { showInput: true, showEffects: true, showObjectChanges: true,
               showBalanceChanges: true, showEvents: true },
    limit: fetchLimit,
    order: "descending",
  }),
  client.queryTransactionBlocks({
    filter: { ToAddress: address },
    options: { ... },
    limit: fetchLimit,
    order: "descending",
  }),
]);
const raw = [...(from.data ?? []), ...(to.data ?? [])];
```

## After (GraphQL)

The big win: GraphQL combines `FromAddress` and `ToAddress` in one query via
`affectedAddress`, halving round-trips.

```ts
const HISTORY_QUERY = graphql(`
  query HistoryByAddress($addr: SuiAddress!, $first: Int!, $after: String) {
    transactionBlocks(
      filter: { affectedAddress: $addr }
      first: $first
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        digest
        sender { address }
        gasInput { gasBudget gasPrice }
        effects {
          status
          timestamp
          checkpoint { sequenceNumber }
          balanceChanges { nodes {
            owner { address }
            coinType { repr }
            amount
          } }
          objectChanges { nodes {
            inputState { address }
            outputState { address asMoveObject { contents { type { repr } } } }
            idCreated
            idDeleted
          } }
          events { nodes {
            type { repr }
            contents { json }
          } }
        }
      }
    }
  }
`);

const res = await suiGraphQL().query({
  query: HISTORY_QUERY,
  variables: { addr: address, first: fetchLimit, after: cursor },
});
const raw = res.data?.transactionBlocks?.nodes ?? [];
```

## Shape diff

| Concept | JSON-RPC | GraphQL |
|---|---|---|
| Filter — sender | `filter.FromAddress` | `filter.sentAddress` |
| Filter — recipient | `filter.ToAddress` | (no direct equivalent — use `affectedAddress`) |
| Filter — either side | (two calls) | `filter.affectedAddress` (single call) |
| Filter — module call | `filter.MoveFunction: { package, module, function }` | `filter.function: "0x...::mod::fn"` |
| Filter — input object | `filter.InputObject: "0x..."` | `filter.inputObject: "0x..."` |
| Filter — changed object | `filter.ChangedObject: "0x..."` | `filter.changedObject: "0x..."` |
| Cursor | `cursor` (string), `nextCursor` | `after`, `pageInfo.endCursor` |
| Limit | `limit` | `first` |
| Data | `res.data[]` (each is a full tx with `effects`, `objectChanges`, ...) | `res.transactionBlocks.nodes[]` (selected fields per query) |
| Status | `data[i].effects.status.status` | `nodes[i].effects.status` (`"SUCCESS"`/`"FAILURE"` enum) |
| Sender | `data[i].transaction.data.sender` | `nodes[i].sender.address` |
| Timestamp | `data[i].timestampMs` (string ms) | `nodes[i].effects.timestamp` (RFC3339) |

## Common pitfalls

- `affectedAddress` returns both sent + received in one query. Dedupe is no longer needed.
- GraphQL fields are pay-per-pick — only request what you read. Asking for everything (`balanceChanges`, `objectChanges`, `events`) on a 50-limit page can hit endpoint timeout.
- `effects.status` is the enum (uppercase), not the nested object JSON-RPC returned. Compare against `"SUCCESS"` not `"success"`.
- The `affectedAddress` filter doesn't include addresses that ONLY appear as gas payers. If we ever care about gas-only history (we don't today), need a separate filter.

---

# Pattern 9 — `executeTransaction` already-migrated (reference)

This isn't a Phase 1 site — it's a "look here" reference. The hot path is
already gRPC and is the cleanest example of the new transaction shape.

See `web/app/api/send/gasless-submit/route.ts:89-105` and Pattern 6 for the
shape contract. Sub-plans 1.10 (suins-operator, zkclient) follow the same
template.

---

# Pattern 10 — `getLatestSuiSystemState` → shared epoch helper

gRPC has NO direct equivalent. `getLatestSuiSystemState` returns 30+ fields
(epoch, protocol version, validators, gas price, etc.). We only ever read
`epoch` and `referenceGasPrice` from it. The migration is to a shared helper
that uses gRPC's `LedgerService` to get just those two values.

Used by: `/api/sui/epoch` (1.1), `/api/auth/mobile/start` (1.1).

## Before (JSON-RPC)

From `web/app/api/sui/epoch/route.ts:15-16`:

```ts
const state = await suiJsonRpc().getLatestSuiSystemState();
return NextResponse.json({ epoch: state.epoch });
```

From `web/app/api/auth/mobile/start/route.ts:71`:

```ts
const state = await suiJsonRpc().getLatestSuiSystemState();
// uses state.epoch downstream
```

## After (gRPC)

New file `web/lib/sui-epoch.ts`:

```ts
import { sui } from "./sui";

/**
 * Current Sui mainnet epoch. Cached per-request (no TTL — epochs flip every
 * ~24h on mainnet and callers always want the freshest value within a
 * request). gRPC's LedgerService returns the live epoch in one round-trip.
 */
export async function getCurrentEpoch(): Promise<number> {
  // `sui()` (SuiGrpcClient) exposes `getReferenceGasPrice` via the unified
  // BaseClient surface; the same client also exposes the latest checkpoint
  // via `getLatestCheckpoint`, which carries the current epoch.
  const cp = await sui().getLatestCheckpoint({});
  return Number(cp.checkpoint.epoch);
}

export async function getReferenceGasPrice(): Promise<bigint> {
  const price = await sui().getReferenceGasPrice();
  return BigInt(price);
}
```

Both routes call the helper:

```ts
import { getCurrentEpoch } from "@/lib/sui-epoch";
const epoch = await getCurrentEpoch();
return NextResponse.json({ epoch: String(epoch) });
```

## Shape diff

| Concept | JSON-RPC `getLatestSuiSystemState` | gRPC `getLatestCheckpoint` |
|---|---|---|
| Wrapper | flat object | `res.checkpoint` (nested) |
| Epoch | `state.epoch` (string) | `res.checkpoint.epoch` (string — BigInt-safe) |
| Reference gas price | `state.referenceGasPrice` (string) | not here — separate call `sui().getReferenceGasPrice()` |
| Protocol version | `state.protocolVersion` (string) | `res.checkpoint.protocolVersion` (string) |
| Epoch start ms | `state.epochStartTimestampMs` (string) | not directly — derivable from checkpoint timestamp |
| Validators | `state.activeValidators[]` (large array) | not exposed via gRPC |
| Total stake | `state.epochTotalTransactions` etc. | not exposed |
| Storage fund | `state.storageFundBalance` | not exposed |

## Common pitfalls

- gRPC does NOT expose the full SystemState — no validator set, no storage fund, no per-epoch reward summary. If a future site needs those, fall back to GraphQL's `epoch { ... }` query, not to JSON-RPC.
- Both routes return `epoch` as a string in the existing JSON contract. Stringify the number before returning to preserve API compatibility — the iOS client parses `String → UInt64`.
- `referenceGasPrice` is its own gRPC call; don't merge it with the epoch call to "save a round-trip" — the two values have different cache lifetimes.
- The shared helper is called from BOTH `/api/sui/epoch` (which is on the hot signin path) and `/api/auth/mobile/start`. Avoid adding a per-process cache without TTL — it'll go stale across epoch boundaries (~once per day).

---

# Quick reference card

When migrating a site, find your method in this table and jump to the section:

| JSON-RPC method | Pattern | gRPC / GraphQL replacement |
|---|---|---|
| `getObject` | 1 | `sui().getObject({ objectId, include })` |
| `multiGetObjects` | 1 (loop) | `sui().getObjects({ objectIds, include })` |
| `getBalance` | 2 | `sui().getBalance({ owner, coinType })` |
| `getAllBalances` | 2 | `sui().listBalances({ owner })` |
| `getCoins` | 3 | `sui().listCoins({ owner, coinType, limit, cursor })` |
| `getAllCoins` | 3 | `sui().listCoins({ owner, limit, cursor })` (omit coinType) |
| `getOwnedObjects` | 4 | `sui().listOwnedObjects({ owner, filter, include, limit, cursor })` |
| `getDynamicFields` | 4 | `sui().listDynamicFields({ parentId, limit, cursor })` |
| `getTransactionBlock` | 5 | `normalizeTransactionShape()` (uses `sui().getTransaction`) |
| `executeTransactionBlock` | 6 | `sui().executeTransaction({ transaction, signatures, include })` |
| `dryRunTransactionBlock` | 6 | `sui().simulateTransaction({ transaction })` |
| `queryEvents` | 7 | GraphQL `events { ... }` via `suiGraphQL().query(...)` |
| `queryTransactionBlocks` | 8 | GraphQL `transactionBlocks { ... }` |
| `getLatestSuiSystemState` | 10 | `getCurrentEpoch()` helper in `lib/sui-epoch.ts` |
| `resolveNameServiceAddress` | (not in P1) | `sui().resolveNameServiceAddress({ name })` |
| `resolveNameServiceNames` | (not in P1) | `sui().resolveNameServiceNames({ address })` |

---

# Where the gRPC equivalent is missing or non-obvious

Document these in your sub-plan PR so reviewers know it's intentional:

1. **`getLatestSuiSystemState`.** No direct gRPC method. We use `getLatestCheckpoint` for epoch + protocol version; the rest of SystemState (validators, storage fund) is not exposed on gRPC at all. If we ever need it: GraphQL `epoch { systemStateVersion validatorSet { ... } }`. (Pattern 10.)
2. **`queryEvents` historical pagination.** gRPC only has `subscriptionService.subscribeEvents` (forward stream from now). Historical walks MUST go to GraphQL. (Pattern 7.)
3. **`queryTransactionBlocks`.** No gRPC equivalent — at all. GraphQL only. (Pattern 8.)
4. **`getOwnedObjects` with `MatchAll`/`MatchAny` filter composition.** gRPC filter is flat. Compose client-side: list-all + filter in TS. (Pattern 4.)
5. **`getTransactionBlock` event txDigest.** gRPC events don't carry their own `txDigest` (it's implicit from the parent transaction). The normalizer in 1.3 must inject the outer digest into each event when flattening. (Pattern 5.)
6. **`waitForLocalExecution` knob on `executeTransactionBlock`.** Gone on gRPC. Read-after-write semantics must be implemented via polling `getTransaction(digest)`. None of our hot paths actually need it (the gasless path already returns immediately), but the verifier flows (1.4–1.7) that read a tx right after the user submits MUST handle the digest being not-yet-indexed — retry with backoff. (Pattern 6.)
7. **`coinObjectCount` and `lockedBalance` on `getBalance`.** Not exposed on gRPC. No current site reads them, but watch in 1.2 review. (Pattern 2.)
8. **`SuinsClient` internal calls.** `@mysten/suins`'s `SuinsClient` accepts a generic client. When we pass `sui()` (gRPC), the SDK internally uses the unified `core.*` surface — verified by `lib/payment-kit.ts:71` comment. No explicit migration needed for the SuinsClient itself, only for the wrapper code that constructs it (1.10 `suins-operator`, `suins-lookup`).

---

# How to test your migration

Every Phase 1 sub-plan ships an integration test in `web/__tests__/sui/`
(scaffolded in 0.6). At minimum:

1. **Read sites.** Hit a known mainnet object/address/digest and assert the
   normalized shape values. Use a digest at least 1 epoch old so it's
   guaranteed indexed.
2. **Execute sites.** Use `dry-run` (simulate) against testnet, not actual
   execution. Phase 4 owns the real send-on-mainnet smoke tests.
3. **Shape regression.** If your site touches `normalizeTransactionShape`,
   add a fixture-based unit test that ensures both transports produce the
   same normalized output for the same digest.

When in doubt: copy the existing tests for `getSuiBalance` /
`getUsdsuiBalance` in `lib/sui.ts` — those already use the gRPC client and
work in production.
