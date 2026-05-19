# Talise — system flow map

Every flow on mainnet. No DB-as-source-of-truth for anything that lives on chain. The DB caches sessions, transaction history, and onboarding bookkeeping; on-chain state (addresses, balances, names, NFTs) is queried fresh.

---

## Components in play

| Component | Where | Role |
|---|---|---|
| Browser | client | Holds ephemeral Ed25519 keypair (55 min TTL), localStorage |
| Next.js server | `web/` | Routes, server-only RPC fan-out, session cookies |
| Shinami | `api.us1.shinami.com` | zkLogin salt (`shinami_zkw_getOrCreateZkLoginWallet`) + proof (`shinami_zkp_createZkLoginProof`) |
| Onara | `localhost:8787` (or hosted) | Gas-station — signs as `gasOwner` from a hot-wallet mnemonic |
| SuiNS operator | `web/lib/suins-operator.ts` | Holds `talise.sui` parent NFT, signs subname mints |
| @t2000/sdk | server-side, in `/api/t2000/execute` | NAVI lending (save) + Cetus aggregator (swap) |
| Sui mainnet | `fullnode.mainnet.sui.io` | Source of truth for balances, SuiNS records, NFT ownership |
| libSQL | `web/.data/talise.db` | Session metadata, onboarding flags, tx_history cache, invoices |

---

## 1. Sign-in (zkLogin via Shinami)

Goal: turn a Google sign-in into a stable Sui address with NO seed phrase.

```
Browser                  Next.js server              Google           Shinami           Sui mainnet
   │                          │                        │                 │                   │
   ├─ /  (landing)             │                        │                 │                   │
   │  Click "Sign in"          │                        │                 │                   │
   │                          │                        │                 │                   │
   ├─ provisionEphemeralAuth  │                        │                 │                   │
   │  • generate Ed25519 keypair (client)               │                 │                   │
   │  • generateRandomness, fetch epoch via /api/sui/epoch ──────────────────────────────────► getCurrentEpoch
   │  • maxEpoch = epoch + 10                                              │                   │
   │  • nonce = generateNonce(pubKey, maxEpoch, randomness)                │                   │
   │  • write { priv, pub, randomness, maxEpoch, createdAt } to localStorage                  │
   │                          │                        │                 │                   │
   ├─ window.location → accounts.google.com?nonce=…&state=…                │                   │
   │                          │                        │                 │                   │
   │                          │      ◄─────────────────┤ Google login    │                   │
   │                          │                        │                 │                   │
   │                          │   redirect → /auth/callback?code=…&state=…                    │
   │                          │                        │                 │                   │
   ├─ /auth/callback ─────────►                        │                 │                   │
   │                          │ exchangeCodeForTokens(code) ──────────► id_token              │
   │                          │ shinamiGetWallet(id_token) ────────────────────► salt+address (deterministic per Google sub)
   │                          │ upsertUser({ googleSub, suiAddress, salt, … })                 │
   │                          │ setSessionCookie(user.id)                  │                   │
   │                          │ setSigningCookie(jwt, salt) ← httpOnly, encrypted              │
   │                          │                        │                 │                   │
   │   ◄ 302  /home (or /business or /onboarding)      │                 │                   │
```

**Key invariants:**
- The ephemeral private key never leaves the browser except into `/api/t2000/execute` (one-shot 55 min TTL, same-origin TLS).
- The JWT and salt never leave the server (`talise_jwt` cookie is httpOnly + signed + base64-encoded).
- The user's Sui address is deterministic: same Google account → same address forever, because Shinami's salt is keyed on `(iss, sub)`.

---

## 2. Identity (claim `name.talise.sui`)

Goal: user picks a handle. We mint a SuiNS subname NFT to their wallet. **They own the NFT; we hold no DB row for it.**

```
Browser                  Next.js                      SuiNS operator        Sui mainnet
   │                       │                             (server-side)         │
   ├─ /claim                                                                   │
   │  ClaimForm                                                                │
   │  user types "sele"                                                        │
   │                       │                                                   │
   ├─ GET /api/username/check?u=sele ───►                                      │
   │                       │ normalizeHandle("sele") → "sele"                  │
   │                       │ guard reserved list                               │
   │                       │ SuinsClient.getNameRecord("sele.talise.sui") ──── │
   │                       │ if null → available                               │
   │   ◄  { available: true }                                                  │
   │                       │                                                   │
   │  (live UsernameCard preview updates as user types)                        │
   │                       │                                                   │
   ├─ click "Claim"                                                            │
   ├─ POST /api/username/claim { username: "sele" } ────►                      │
   │                       │ readSessionEntryId() → user                       │
   │                       │ on-chain availability check via SuinsClient       │
   │                       │ mintSubname({ username, userAddress }):           │
   │                       │   • new Transaction                               │
   │                       │   • SuinsTransaction.createSubName(               │
   │                       │       parentNft: talise.sui NFT,                  │
   │                       │       name: "sele.talise.sui",                    │
   │                       │       expirationTimestampMs: parent expiry,       │
   │                       │       allowChildCreation: false,                  │
   │                       │       allowTimeExtension: false                   │
   │                       │     ) → subname NFT                               │
   │                       │   • tx.transferObjects([nft], user.sui_address)   │
   │                       │   • operator keypair signs as sender ────────────►│ executeTransactionBlock
   │                       │   • parses objectChanges for new NFT id           │
   │   ◄  { ok, username, digest, subnameNftId }                               │
   │                       │                                                   │
   │  (page reload — /home now shows the UsernameCard for "sele")              │
```

**Key invariants:**
- The mint is signed by the operator (the only entity that can mint subnames under `talise.sui`) but the resulting NFT is *transferred to the user*. The user is the owner forever. Talise cannot revoke it without the user's signature.
- No `users.talise_username` column write. The DB is unaware.
- Anywhere in the product that needs to know "does this user have a handle?", we call `findTaliseSubnameForOwner(address)` which scans the user's `SubDomainRegistration` objects on chain.
- Anywhere we resolve "send to name@talise → address", we call `SuinsClient.getNameRecord(...)` — the same record every other Sui wallet sees.

---

## 3. Receive (be paid at `sele@talise`)

Goal: user shares a handle; senders can pay them in one tap from anywhere.

```
Recipient                   Next.js                  Sui mainnet
   │                           │                          │
   ├─ /receive                                            │
   │ Server load:                                         │
   │ findTaliseSubnameForOwner(user.sui_address) ───────► getOwnedObjects(filter: SubDomainRegistration)
   │                            scans returned NFTs for "*.talise.sui"
   │                            returns { username, fullName, nftId } or null
   │                                                      │
   │ if handle:                                           │
   │   render UsernameCard size="lg"                      │
   │   render "Your handle: sele@talise"                  │
   │   render payment link talise.io/p/sele               │
   │                                                      │
   │ if no handle:                                        │
   │   render "Claim your handle" CTA → /claim            │
   │   render ReceiveCard with bare address + QR          │

Sender                      Next.js                  Sui mainnet
   │ Either route:                                        │
   │ (a) talise.io/p/sele  →  app/p/[handle]/page.tsx ──► findTaliseSubnameForOwner is NOT used here;
   │     this route uses the legacy business_handle DB column for the merchant page
   │ (b) /send + types "sele@talise"                     │
   │                          │                          │
   │ GET /api/recipient/resolve?q=sele@talise ──►        │
   │                          │ resolveRecipient:        │
   │                          │   SuinsClient.getNameRecord("sele.talise.sui") ──► targetAddress
   │   ◄ { address: 0x…, displayName: "sele@talise" }    │
   │                          │                          │
   │ form shows chip "Sending to sele@talise · 0x77…05"  │
```

**Key invariants:**
- The recipient never tells Talise their handle. The recipient owns the NFT; chain says who owns it; we read.
- A sender can pay any `name@talise` handle even if the recipient has never opened Talise (as long as they own the NFT).
- If the sender is paying a non-Talise recipient (just a raw `0x…`), the same form works — `isHexAddress(input)` short-circuits the SuiNS lookup.

---

## 4. Send (sponsored, USDsui-only, multi-currency input)

Goal: user types ₦100, recipient gets $0.06 USDsui (or vice versa), gas is on us, settled in one block.

```
Browser                  Next.js                   Onara              Shinami             Sui mainnet
   │                        │                        │                   │                    │
   ├─ /send                                                                                  │
   │  CurrencyToggle (₦ / $)                                                                 │
   │  recipient field — types "sele@talise"                                                  │
   │  → /api/recipient/resolve ──► SuinsClient.getNameRecord → { address, displayName }     │
   │  amount field — types "100"                                                             │
   │  → amtUsdsui = localToUsdsui(100, "NGN") = 0.0617                                       │
   │  → transferIntent({ asset: "USDsui", amount, recipient, sender })                       │
   │  IntentPreview shows legs live                                                          │
   │                        │                                                                 │
   ├─ click "Send ₦100"                                                                       │
   │                        │                                                                 │
   │ ── Trip 1 — build sponsored bytes ──                                                     │
   │ POST /api/zk/sponsor { transactionKindB64 } ──►                                          │
   │                        │ OnaraClient.status() ───►◄  { address: sponsor 0x8a31… }       │
   │                        │ Transaction.fromKind(kind)                                      │
   │                        │ tx.setSender(user.sui_address)                                  │
   │                        │ tx.setGasOwner(sponsor)                                         │
   │                        │ tx.build({ client }) ─── auto-fetches sponsor coins ──────────► getCoins(owner=sponsor)
   │                        │ returns full TransactionData bytes                              │
   │   ◄ { bytes }                                                                            │
   │                        │                                                                 │
   ├─ keypair.signTransaction(bytes)  ← browser, ephemeral key                                │
   │   produces userSignature (Ed25519 over TX bytes)                                         │
   │                        │                                                                 │
   │ ── Trip 2 — assemble zkLoginSignature + broadcast via Onara ──                          │
   │ POST /api/zk/sponsor-execute                                                             │
   │   { bytesB64, ephemeralPubKeyB64, maxEpoch, randomness, userSignature } ──►              │
   │                        │ readSigningCookie() → { jwt, salt }                              │
   │                        │ assembleZkLoginSignature:                                       │
   │                        │   • Shinami.createZkLoginProof(jwt, maxEpoch,                  │
   │                        │       extendedEphemeralPublicKey, randomness, salt) ──────────► proof
   │                        │   • addressSeed = genAddressSeed(salt, "sub", sub, aud)         │
   │                        │   • getZkLoginSignature({ inputs: proof+addressSeed,           │
   │                        │       maxEpoch, userSignature }) → zkLoginSig                  │
   │                        │ OnaraClient.sponsor({                                          │
   │                        │   sender, txBytes: bytesB64, txSignature: zkLoginSig           │
   │                        │ }) ──►                                                          │
   │                        │                        │ validate against "talise" policy:    │
   │                        │                        │   gasBudgetMax, maxCommands,         │
   │                        │                        │   targets:["*"] (≥1 MoveCall)         │
   │                        │                        │ sponsor keypair signs as gasOwner    │
   │                        │                        │ submit to RPC ────────────────────────► executeTransactionBlock with [zkLoginSig, sponsorSig]
   │                        │                        │ wait for finality                    │
   │                        │   ◄ { digest, effects, objectChanges }                          │
   │                        │ insert into tx_history (digest, kind="send", amount, recipient)│
   │   ◄ { digest, effects, objectChanges }                                                   │
   │                        │                                                                 │
   │ success view: "₦100 sent to sele@talise · settled in one block · gas on us"             │
```

**Key invariants:**
- The user pays $0 in gas. Onara's sponsor wallet covers it.
- Shinami's zk proof anchors the zkLogin signature to the user's address — without it, `executeTransactionBlock` rejects.
- The PTB contains an explicit no-op MoveCall (`0x1::option::none<address>`) so Onara's `targets:["*"]` policy accepts it (the policy gates on MoveCall presence).
- Settlement is atomic — either both signatures verify and the tx lands, or nothing changes.

---

## 5. Receive (passive — someone sends YOU money)

When you open `/home`:

```
Browser                     Next.js                  Sui mainnet                Auto-convert
   │                           │                         │                          │
   ├─ /home  ─────────────────►                          │                          │
   │ getSuiBalance(user)        ◄────────────────────────│                          │
   │ getUsdsuiBalance(user)     ◄────────────────────────│                          │
   │ getUsdcBalance(user)       ◄────────────────────────│                          │
   │ getOwnedCoins(user)        ◄──── pages every coin ──│                          │
   │ findTaliseSubnameForOwner  ◄──── scans NFTs ────────│                          │
   │ getMarginPoolInfo("USDC")  ◄────────────────────────│                          │
   │ userTxs(user.id, 10)  ◄── from local tx_history     │                          │
   │                           │                         │                          │
   │ Render dashboard:                                                              │
   │ • If no subname → "Claim your @username" banner                                │
   │ • If subname → UsernameCard size="sm"                                          │
   │ • Auto-convert banner if any non-USDsui coin owned ─────────────────────────►  AutoConvertBanner
   │ • PersonalBalanceCard — ₦ first, $ secondary, USDsui underneath                │
   │ • Activity list (USD-equiv amounts)                                            │
```

When the auto-convert banner fires (user has e.g. USDC, USDT, SUI):

```
Browser                     Next.js                  Shinami           Onara          Sui mainnet
   │                           │                        │                 │                 │
   ├─ Click "Convert all"                                                                   │
   │ For each non-USDsui coin:                                                              │
   │   POST /api/t2000/execute                                                              │
   │     { op:"swap", from:"USDC", to:"USDsui", amount, ephemeralKey, … } ─►                │
   │                           │ rebuild Ed25519Keypair from posted secret                 │
   │                           │ Shinami.createZkLoginProof ──►◄ proof                     │
   │                           │ T2000.fromZkLogin({ ephemeralKeypair, proof, addr, maxEpoch })
   │                           │ t2000.swap({ from, to, amount }) ──►                       │
   │                           │   (SDK builds Cetus aggregator PTB,                       │
   │                           │    signs with zkLogin signer,                              │
   │                           │    submits to mainnet) ─────────────────────────────────► block
   │   ◄ { digest }                                                                         │
   │ Show progress "2/5 · USDC → USDsui"                                                    │
   │ When done: page reload → balances refresh → USDsui balance up, others zero             │
```

---

## 6. Resolution paths (cheatsheet)

What every "looks up a recipient" call actually does:

| Input | Function | Backend |
|---|---|---|
| `0x...64hex` | `resolveRecipient` | none — pass through |
| `sele@talise` / `sele.talise.sui` / `sele` | `resolveRecipient` | `SuinsClient.getNameRecord` |
| Reverse: "who am I?" | `findTaliseSubnameForOwner(address)` | `getOwnedObjects(filter: SubDomainRegistration)` |
| Availability check while claiming | `/api/username/check` | `SuinsClient.getNameRecord` (null = available) |

**No DB is ever consulted for username resolution.** The `talise_username` column has been deprecated — the schema still has it for backward compat, but every code path now reads from chain.

---

## 7. Failure modes & rollbacks

| Failure | What happens |
|---|---|
| Ephemeral key expired (55 min TTL) on idle | `SessionWatcher` polls every 30s, clears state + bounces to `/?err=session_expired` |
| Ephemeral key expired mid-tx | Form's `hasEphemeralKey()` check → `triggerOauthSignIn({ returnTo: current path })`, user re-auths and lands back |
| Shinami rate limit (-32012) | `ErrorBox` humanizer → "Too many requests in a minute. Give it 60 seconds." |
| Shinami down | Proof call throws → user sees the error |
| Onara down | `/api/zk/sponsor` returns 503 — sponsored sends fail but the user keeps their session |
| Sponsor wallet drained | Onara `/sponsor` returns "policy match but execution failed: no gas" — user retries after we refill |
| Subname mint fails on chain | Claim route returns 502 with the exact reason — no DB row was written, so we stay consistent |
| Subname mint succeeds but DB write fails | Doesn't happen — there is no DB write |
| User loses access to Google account | They lose the zkLogin address (no recovery — same as forgetting a seed phrase, but with the recovery being "log back into Google") |

---

## 8. What is and isn't on chain

| Lives on chain | Lives in DB |
|---|---|
| Sui address (derived via Shinami salt) | Session cookies (`talise_sess`, `talise_jwt`) |
| `*.talise.sui` subname NFTs | tx_history (cache only — chain has the same data) |
| USDsui / SUI / any token balance | invoices (for the link generator) |
| Every payment transaction | onboarding flags (account_type, business_name, business_handle) |
| Every Cetus swap | last_seen_at, country (analytics) |

If our DB burned down tomorrow, every user would still:
- Own their Sui address
- Own their `*.talise.sui` NFT
- Own all their USDsui
- Be able to log in to a new Talise install with the same Google account and get the same address back

That's the test.
