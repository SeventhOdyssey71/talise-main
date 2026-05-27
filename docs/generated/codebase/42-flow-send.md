# 42. Flow: send

The send flow is the most user-visible piece of the protocol. The user
types a handle, types an amount, taps Send, and the transaction settles
on Sui in roughly one second with the user paying zero gas. This doc
walks the full path from tap to receipt.

## User-facing journey

The iOS Send flow is a 5-step NavigationStack:

1. **Amount.** Full-page numeric pad. Local currency (NGN, KES, GHS,
   ZAR) is the primary display; USDsui sits underneath as the actual
   ledger unit.
2. **Recipient.** Input field with recent-contacts list. The user types
   `alice@talise.sui` (or `alice`, or a raw `0x...64hex` address). A
   live `/api/recipient/resolve` call mirrors what the user typed back
   as a "Sending to alice@talise.sui · 0x77...05" chip.
3. **Review.** "Sending privately" view with from/to glass cards. The
   recent commit `c2b9b37` fixed To/From label correctness here and
   persistent FX so amounts convert consistently across views.
4. **Sending.** Animated paperplane while the two-trip sponsored flow
   runs.
5. **Complete.** Animated checkmark with the digest + a "View receipt"
   affordance.

The web app's `/send` route exposes the same flow on a single page.

## Backend: resolve handle to address

`/api/recipient/resolve?q=alice@talise.sui` does three things:

- If the input matches a raw hex address, pass through unchanged.
- Otherwise, normalize to `alice.talise.sui` and call
  `SuinsClient.getNameRecord("alice.talise.sui")`.
- Return `{ address, displayName }` or 404.

The same code path handles `alice@talise.sui`, `alice.talise.sui`, and
bare `alice` because `resolveRecipient` in `web/lib/handle.ts` normalizes
all three forms. The DB is never consulted; SuiNS is the only source of
truth (the `talise_username` DB column has been deprecated).

If the recipient does not own a Talise handle, the same form still
works: `isHexAddress(input)` short-circuits the SuiNS lookup and the
send goes to the raw address.

## Building the PTB

`/api/send/prepare` constructs a Programmable Transaction Block that
moves USDsui from the sender to the recipient. The PTB has three logical
parts:

1. **The clock-MoveCall shim** (see below).
2. **The transfer.** `coinWithBalance(USDSUI_TYPE, amount)` + a
   `transferObjects([coin], recipient)` command.
3. **The Payment Kit receipt.** A self-ping that tags the tx with a
   typed memo (`kind: send`, sender, receiver, refs) so the activity
   classifier in `web/lib/activity.ts` can render the row authoritatively
   from the PaymentRecord nonce instead of guessing from balance changes.

The output is base64-encoded transaction-kind bytes that the iOS / web
client feeds into `/api/zk/sponsor`.

## The vanilla-transfer shim (the clock MoveCall)

Onara's sponsor policy declares `targets: ["*"]`, which means every
sponsored PTB must contain at least one MoveCall. A vanilla send (just
`coinWithBalance` + `transferObjects`) contains zero MoveCalls because
both are built-in command kinds. Three options were considered:

1. Loosen the Onara policy. Wrangler rejects this at boot: "Allow
   policies require exactly one of targets or sequence." Cannot drop
   both.
2. Route the send through Talise's own Move package (`talise::send`),
   which is itself a MoveCall. This path works in principle but the
   package's `addresses.talise = "0x0"` slot was not yet bootstrapped
   when the send went live, so the registry id was unresolved.
3. Inject a no-op MoveCall that satisfies the policy.

Commit `b7508b5` shipped option (3). Send PTBs now prepend
`0x2::clock::timestamp_ms(Clock@0x6)` to the transaction. The call
reads the Clock's u64 timestamp and discards the return. Zero state
change, essentially free gas, satisfies Onara's "at least one MoveCall"
gate. The `targets:["*"]` wildcard matches `0x2::clock::timestamp_ms`.

`/api/sweep/prepare` and `/api/earn/supply/prepare` already satisfy the
MoveCall requirement: the former emits MoveCalls per DEX hop through
the Cetus aggregator, and the latter calls
`marginPool.supplyToMarginPool`. Only the vanilla send needed the shim.

## Two-trip sponsored execution

The send is two HTTP round-trips so the user's ephemeral key never
touches the server.

### Trip 1: `/api/zk/sponsor`

The web tier calls Onara to learn the sponsor address, then assembles
the full `TransactionData` bytes with:

- `tx.setSender(user.sui_address)`
- `tx.setGasOwner(sponsor)`
- `tx.build({ client })`, which auto-fetches the sponsor's gas coins.

Returns the bytes to the client.

### Client-side signing

The iOS or web client signs the bytes with the user's ephemeral
Ed25519 key (held in the browser's localStorage or in iOS's
Keychain-backed coordinator). The signature is the user's intent on
this exact byte sequence.

### Trip 2: `/api/zk/sponsor-execute`

The server:

1. Reads the JWT and salt from either the signing cookie (web) or the
   `mobile_sessions` row (iOS).
2. Calls Shinami's `shinami_zkp_createZkLoginProof` (or uses a cached
   proof passed by the client) to generate the zk proof.
3. Wraps the ephemeral signature + proof + address-seed into a
   `zkLoginSignature` (the sender signature).
4. Forwards `{ sender, txBytes, txSignature }` to Onara's `/sponsor`
   endpoint. Onara validates the PTB against the `talise` policy
   (gas budget, max commands, target wildcard, MoveCall presence),
   signs as `gasOwner`, broadcasts to mainnet, and waits for finality.
5. Returns `{ digest, effects, objectChanges }` to the client.

The user paid $0 in gas. Onara's sponsor wallet covered it. The
transaction is atomic: either both signatures verify and the tx lands,
or nothing changes.

## The receipt

Two artifacts come out of a send.

**On-chain PaymentRecord.** The Payment Kit memo from the prepare step
is now a permanent on-chain record under the talise registry. The
nonce encodes kind, timestamp, sender, receiver, and references in a
compact byte layout (`t1<kind1><ts8><rand4><sender6><receiver6>[refs]`),
which `parsePaymentKitNonce` decodes in `web/lib/activity.ts` to render
the history row authoritatively.

**Client-side receipt view.** `ios/Talise/Features/Home/TxReceiptView.swift`
renders the receipt with To/From labels, persistent FX so the amount
converts to the user's display currency regardless of which view they
are in, and a "View on Suiscan" link. The recent `c2b9b37` fix made the
FX persist across the receipt view so the same NGN amount renders
identically in the success screen and later in History.

## Recipient outcomes

What lands in the recipient's wallet depends on what they have set up.

**Recipient has Talise auto-swap enabled.** The recipient's vault is at
the address that `alice@talise.sui` resolves to. The inbound USDsui
flows through Sui's accumulator path (see `43-flow-auto-swap.md`).
Because USDsui is already the destination type, the conversion is
a no-op: the cron worker calls `receive_from_accumulator_to_owner` and
the USDsui lands as a `Coin<USDsui>` in the user's address within
about a minute.

**Recipient has Talise but auto-swap is paused or disabled.** Same
accumulator path, but the worker does not act. The recipient sees the
balance via `suix_getAllBalances` on their next home-screen refresh.

**Recipient does not have Talise.** The send goes to the resolved
SuiNS address (or raw hex). The recipient receives a plain USDsui
balance on chain. Any Sui wallet shows it.

## Cross-references

- `43-flow-auto-swap.md` for what the recipient's wallet does with a
  non-USDsui inbound (the conversion path).
- `44-flow-earn-and-receive.md` for the receive-link surface and
  Earn integration.
- `03-move-auto-swap-flow.md` for the Move-level details of the
  conversion path.
