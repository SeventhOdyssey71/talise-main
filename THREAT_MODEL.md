# Talise — Threat Model

This document is the security posture of Talise, a consumer payments app on Sui.
It is written for engineers and external reviewers (including security firms
performing pre-audit reads). Claims here are grounded in the code paths that
implement them; file references point at the exact lines that enforce the
mitigation. Where something is planned-but-not-yet-implemented, this document
says so explicitly — auditors should be able to trust both the "done" column
and the "not yet" column.

## 1. Trust Boundaries

Each boundary lists the actors that cross it and the assets in motion.

- **iOS app ↔ Talise backend.** Authenticated with a HMAC-signed Bearer token
  (`Authorization: Bearer …`) plus, on App Attest-capable devices, an
  `X-App-Attest` assertion and `X-App-Attest-KeyId` header attached to every
  request (`ios/Talise/Network/APIClient.swift:60-71`). The payload hash that
  the assertion commits to is `SHA-256(body)`, so a replay on a different
  payload fails the server-side assertion check.

- **iOS app ↔ Google OAuth.** Talise mediates OAuth server-side so that the
  Google `id_token` ends up with the same `aud` Shinami sees on the web flow
  (`web/app/api/auth/mobile/start/route.ts:36-140`,
  `ios/Talise/Auth/ZkLoginCoordinator.swift:67-92`). The crucial property is
  the OAuth `nonce` parameter — it is the Poseidon hash of
  `(extendedEphemeralPubKey, maxEpoch, jwtRandomness)`. Google embeds that
  string verbatim into `id_token.nonce`, which the zkLogin prover later
  verifies — see §4.

- **Backend ↔ Onara sponsor.** Talise's web tier signs the user side of every
  transaction; gas is owned + signed by the Onara worker, which enforces a
  per-policy gas budget and a command-kind allowlist before broadcasting
  (`web/app/api/zk/sponsor-execute/route.ts:115-145`,
  `onara/api/policies/talise.json`). The Talise tier never touches the sponsor
  wallet private key.

- **Backend ↔ Shinami prover.** The prover sees `(jwt, salt, ephemeralPubKey,
  maxEpoch, jwtRandomness)`. Critically, the JWT nonce binding (§4) means
  the prover only mints a usable zkLogin proof when those values are
  consistent with the JWT the user signed in with — a swap on any of them
  breaks the proof.

- **Backend ↔ Sui mainnet RPC.** We use the public fullnode and Shinami's
  managed node. Reads are non-authoritative until a tx digest is observed.

- **iOS app ↔ Sui Payment Kit (on-chain).** The PK `processRegistryPayment`
  MoveCall (`web/lib/intents/wrap-payment-kit.ts:261-306`,
  `web/lib/payment-kit.ts:135-171`) is the durable receipt for every
  Talise-originated tx. The receipt object is the source of truth that the
  activity classifier reads back — the iOS UI shows the receipt's kind, not
  the user's free-text memo (§3).

- **Talise registry ↔ AdminCap holder.** The `talise` PaymentRegistry is a
  *shared* object — anyone can write PaymentRecord dynamic fields under it —
  but withdrawals from any merchant balance held under it require the
  `RegistryAdminCap` issued at mint time. That cap was transferred to the
  operator wallet during one-shot bootstrap and is held off-app
  (`web/lib/pk-bootstrap.ts:55-100`). See §5 for rotation posture.

## 2. Asset Inventory

| Asset | Custody | Lifetime |
|---|---|---|
| USDsui in user wallet | User's zkLogin Sui address (self-custodial) | Persistent on chain |
| Bearer token | iOS Keychain (`io.talise.app` Keychain service, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) | 24h TTL, revocable via `mobile_sessions.revoked` (`web/lib/mobile-sessions.ts:23,107-128`) |
| Ephemeral Curve25519 private key | iOS Keychain (`io.talise.app.zklogin.ephemeral`, same accessibility) | Per-session; regenerated on each sign-in (`ios/Talise/Auth/EphemeralKeyStore.swift:24-43`) |
| Cached zkLogin proof + (maxEpoch, randomness) | iOS Keychain (`io.talise.app.proof-cache`) — survives relaunch, never iCloud | Bound to current `maxEpoch` (~48h) |
| Mobile session row | Server DB (`mobile_sessions`: token_hash, jwt, salt, ephemeral_pubkey_b64, max_epoch, randomness, revoked) | 24h |
| AdminCap for `talise` PK registry | Operator wallet (off-platform; same key as `talise.sui` operator) | Rotation = new registry (deliberate friction) |
| Sponsor wallet SUI | Onara worker (off-platform) | N/A to Talise |

## 3. Abuse Vectors → Mitigations

| Vector | Impact | Mitigation | Code reference |
|---|---|---|---|
| Stolen bearer (replay) | Attacker drains the user wallet up to daily limit | Bearer is HMAC-signed (`sign()` in `web/lib/auth.ts`); server hashes the inner token before lookup (token plaintext never stored); rows carry `expires_at` + `revoked`; App Attest assertion binds the request to the device on every call | `web/lib/mobile-sessions.ts:63-128`, `ios/Talise/Network/APIClient.swift:60-71` |
| Stolen ephemeral key (no JWT) | Useless on its own — no valid signature | Ephemeral key is regenerated on each sign-in; signatures only verify under the zkLogin wrapper which needs JWT + proof + matching ephemeral pubkey | `ios/Talise/Auth/EphemeralKeyStore.swift:34-43` |
| Swapped ephemeral pubkey at execute time | Prover rejects with `-32602 Invalid params` | The JWT's `nonce` claim is the Poseidon hash of `(extEphPubKey, maxEpoch, randomness)`. Sponsor-execute pulls the (ephPubKey, maxEpoch, randomness) tuple back from `mobile_sessions` (NOT from the client), so a different ephemeral key cannot reuse the JWT | `web/app/api/auth/mobile/start/route.ts:65-90`, `web/app/api/zk/sponsor-execute/route.ts:80-114` |
| Forged App Attest assertion | None today, but server-side cert-chain validation is **planned** | Server logs the keyId today; cryptographic walk of Apple's attestation cert chain is on the roadmap (`X-App-Attest` header is present and the iOS path is implemented end-to-end) | `ios/Talise/Auth/AppAttestService.swift`, server validator: roadmap |
| Onara sponsor exfiltration | Sponsor cannot sign as the user | Sponsor signs only as `gasOwner`; user signature is required for the sender side; sponsor sees only PTB bytes + the user's already-assembled zkLogin signature; sponsor policy caps gas budget and command kinds | `web/app/api/zk/sponsor-execute/route.ts:115-145`, `onara/api/policies/talise.json` |
| Payment Kit receipt replay | Cannot collide on chain | PK enforces uniqueness of `(nonce, amount, receiver, coinType)` via `PaymentKey` hashing; Talise nonces are 27–36 ASCII bytes with a 4-char base36 random slot so two identical sends in the same millisecond still produce distinct keys | `web/lib/intents/wrap-payment-kit.ts:36-189` |
| Prover MITM / prover swap | Cannot substitute proofs | Prover URL is configured server-side; nonce binding (above) means a swapped prover would still need to produce a proof against the exact `(jwt.nonce, ephPubKey, maxEpoch, randomness)` quadruple — and the iss/aud of the JWT is fixed to Talise's Google client | `web/app/api/auth/mobile/start/route.ts`, `web/lib/zksigner.ts` |
| Malicious PaymentRecord under `talise` registry | Cannot move funds, can only emit noisy receipts | The registry is shared by design — but withdrawals require the AdminCap held by the operator; iOS reads the receipt's `kind` from the parsed nonce schema (`t1<kind1>…`) rather than trusting a free-text memo; activity classifier filters on (receiver == user, sender, amount) before classifying | `web/lib/intents/wrap-payment-kit.ts:208-244`, `web/lib/activity.ts` |
| Stale bearer (predates Poseidon-nonce binding) | Sponsor-execute would 500 obscurely | Detected explicitly: server returns 401 with `code: "session_rebind_required"`; iOS intercepts the code and auto-signs-out instead of looping | `web/app/api/zk/sponsor-execute/route.ts:92-110`, `ios/Talise/Auth/ZkLoginCoordinator.swift:354-385` |
| Onramp / off-ramp partner compromise | Funds in custodial transit at Stripe/Yellow Card are at the partner's risk perimeter | Out of scope for Talise — disclosed; Talise only credits USDsui after settlement webhook is HMAC-verified | Plans 14/15 (`web/app/api/onramp/**` planned) |
| AddressBalance form of stablecoin (May 2026) | Coin lookups would silently miss balance | `coinWithBalance` is used as the unified accessor — Sui Payment Kit's call handles both legacy `Coin<T>` and the new `AddressBalance<T>` uniformly so no surface in Talise needs to branch | `web/lib/payment-kit.ts`, `web/lib/intents/wrap-payment-kit.ts` |
| Sponsor-execute called from a non-Talise origin | Attacker would still need a live bearer + ephemeral signature pair | Bearer auth + App Attest header gates the route; the policy-enforcing leg is Onara | `web/app/api/zk/sponsor-execute/route.ts:35-50` |
| BLAKE2b implementation bug producing a wrong digest | Sui validator rejects signature — funds-safe but UX-breaking | Pure-Swift BLAKE2b-256 verified by known-answer tests against `@noble/hashes` (empty input, `"abc"`, and Sui-intent-prefixed `"hello"`). The self-test is provided as `Blake2b.runSelfTest()` but is **not** auto-run on launch — deliberately, since `hash256` is on the signing hot path and a fatal init would break Send | `ios/Talise/Sui/Blake2b.swift:151-182` |

## 4. Cryptography Choices & Provenance

- **BLAKE2b-256.** Pure-Swift implementation of RFC 7693, no key. Cross-checked
  against `@noble/hashes/blake2.js` (the same impl `@mysten/sui` uses
  transitively) with three known-answer vectors: empty input, `"abc"`, and the
  Sui intent-prefixed `[0,0,0] || "hello"`
  (`ios/Talise/Sui/Blake2b.swift:151-182`). Self-test is opt-in (`runSelfTest()`)
  and is not auto-invoked on launch.

- **Ed25519.** `CryptoKit.Curve25519.Signing.PrivateKey`. Apple-vendored,
  audited as part of CryptoKit. The Sui SerializedSignature is assembled as
  `0x00 || sig (64) || pubkey (32)` (97 bytes) per the Sui spec
  (`ios/Talise/Auth/ZkLoginCoordinator.swift:194-210`).

- **Sui intent signing.** `digest = BLAKE2b256([0,0,0] || tx_bytes)` (the
  3-byte prefix is `[scope=TransactionData, version=V0, app_id=Sui]`), then
  `ed25519_sign(ephemeralSK, digest)`. We signed the raw intent message in
  an earlier revision and the validator rejected with "Invalid signature was
  given to the function" — the current code documents the failure mode
  inline (`ios/Talise/Auth/ZkLoginCoordinator.swift:194-218`).

- **Poseidon nonce.** Generated server-side via
  `generateNonce(ephPubKey, maxEpoch, randomness)` from `@mysten/sui/zklogin`
  (`web/app/api/auth/mobile/start/route.ts:90`). We don't roll our own
  Poseidon — we use the same primitive Shinami's prover recomputes.

- **HMAC-SHA256.** Backs `sign()` / `verify()` for bearer tokens and OAuth
  state. The secret lives in `SESSION_SECRET`.

- **App Attest.** Apple-vendored hardware attestation. Per-install keyId,
  rotated automatically when the user uninstalls + reinstalls.

- **Curve25519 ephemeral key storage.** Why Curve25519 instead of Secure
  Enclave: SE supports only P-256, and `SecKeyCreateRandomKey` for SE keys
  fails outright on the iOS Simulator. zkLogin requires sig scheme flag
  `0x00` (Ed25519). The key persists in Keychain with
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — device-bound, no
  iCloud sync (`ios/Talise/Auth/EphemeralKeyStore.swift:10-43`).

## 5. Key Rotation & Recovery

- **Ephemeral key** — regenerated on every sign-in; previous key is
  overwritten (`io.talise.app.zklogin.ephemeral`).
- **Bearer** — 24h TTL (`MOBILE_SESSION_TTL_MS = 1000 * 60 * 60 * 24`,
  `web/lib/mobile-sessions.ts:23`); `revokeAllMobileSessions(userId)` flips
  the `revoked` column for all live sessions for a user; the iOS app rotates
  bearers on cold start.
- **App Attest key** — bound to install, regenerated on uninstall +
  reinstall.
- **AdminCap for `talise` PK registry** — rotation requires minting a new
  registry under a different name, since the v1 registry id is derived from
  `(namespaceId, registryName)`. This is deliberate friction: the AdminCap
  holder is the operator wallet and we want a single audit trail per
  registry name (`web/lib/pk-bootstrap.ts:55-100`).
- **`SESSION_SECRET` rotation** — invalidates every existing bearer +
  signed-state cookie. Triggers a global forced re-sign-in by design.

## 6. Sponsor Policy Posture (Onara)

From `onara/api/policies/talise.json`:

```json
{
  "name": "talise",
  "enabled": true,
  "gasBudgetMax": 100000000,
  "maxCommands": 50,
  "targets": ["*"],
  "allowedCommandKinds": ["SplitCoins", "MergeCoins", "TransferObjects",
                          "MoveCall", "MakeMoveVec", "Publish"]
}
```

Interpretation:

- **Gas cap.** 0.1 SUI per transaction — high enough to cover a 50-command
  PTB doing PK receipt + NAVI supply + Cetus swap in one shot, low enough
  that a misbehaving client can't burn the sponsor wallet in a single call.
- **Command kinds.** Covers every shape Talise emits today. `Publish` is
  included so the operator can deploy new versions of the Move package via
  the same sponsor path during development — we expect to remove it from the
  consumer policy and route publishes through a separate, gated worker
  before production launch.
- **Targets `["*"]`.** Open during the hackathon to keep iteration speed
  high. This is the largest single posture trade-off in the policy file.
  Production hardening plan: narrow to Talise's own published packages,
  USDsui module, Sui Payment Kit, NAVI, and Cetus aggregator. Tracked in
  WORKPLAN.md.

## 7. Known Gaps + Roadmap

These are the items where the document deliberately says "not yet". An auditor
reading the codebase will find them quickly; we surface them explicitly so the
posture is verifiable rather than aspirational.

- **TLS pinning.** `APIClient.swift` ships with the `PinningDelegate` wired
  in and ready, but `pinnedSPKIs` is empty — the leaf SPKI hash for
  `talise.io` is a `TODO` (`ios/Talise/Network/APIClient.swift:91-98`).
  Until those hashes are populated, the session falls back to default
  system trust evaluation. Action: capture the prod leaf SPKI hash on
  first deploy, ship it alongside the rotation backup hash.

- **App Attest server-side cert-chain verification.** iOS produces the
  assertion + keyId headers correctly; the server today logs them but does
  not yet walk Apple's attestation root chain
  (`/api/auth/attest/register` is implemented; counter + receipt
  verification is the gap). Roadmap: before public launch.

- **KYC tiers.** Schema + UI in progress (Plan 11 in `WORKPLAN.md`). Sumsub
  webhook + `users.kyc_tier` column + `/api/send/prepare` tier-aware
  rejection are designed but not yet on main. The current send path does
  not enforce a daily limit at the API layer.

- **Move contracts (SpendPolicy, Escrow, Recurring, SplitBill).**
  Designed (Plans 17 + 18) but not on mainnet. Until they are, agent-pay
  flows route through the same zkLogin sponsor-execute path as a user-driven
  send, which means the daily-limit gate is the only spend constraint.

- **PK target tightening.** As noted in §6, the sponsor policy still allows
  `targets: ["*"]`. Targeted allowlist before production.

- **Self-test gating in DEBUG builds.** `Blake2b.runSelfTest()` exists and
  passes locally, but it's not auto-invoked at app launch — the comments in
  the file explain why (`hash256` is on the signing hot path; a fatal
  during init would brick the Send screen if the test ever flickered on a
  weird device). Long-term we want a developer-mode toggle that surfaces
  the failure non-fatally.

## 8. References

- Sui Payment Kit Move source — https://docs.sui.io/onchain-finance/payment-kit
- `@noble/hashes` BLAKE2b — https://github.com/paulmillr/noble-hashes
- Onara sponsor policy — `onara/api/policies/talise.json`, vendored from
  https://github.com/unconfirmedlabs/onara
- App Attest — https://developer.apple.com/documentation/devicecheck/dcappattestservice
- zkLogin spec — https://docs.sui.io/concepts/cryptography/zklogin
- Shinami prover — https://shinami.com

---

*Last reviewed against `main` at the time of writing. Pull requests touching
any code path referenced here must update this document in the same commit.*
