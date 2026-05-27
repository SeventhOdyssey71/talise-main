# zkLogin architecture

## The full picture

```
+--------------------------------------+
|  iOS app (Talise)                    |
|                                      |
|  ZkLoginService                      |
|    ├── ephemeral Curve25519 key (Keychain)
|    ├── user salt 16 bytes (Keychain) |
|    └── JWT from Google (Keychain)    |
|                                      |
|  ConnectWalletSheet (SwiftUI)        |
+------------+-------------------------+
             |
             | 1. OAuth (PKCE code flow)
             v
+--------------------------------------+
|  accounts.google.com                 |
|    /o/oauth2/v2/auth → code          |
|    /token            → id_token JWT  |
+--------------------------------------+

             | 2. Address derivation
             v
+--------------------------------------+
|  Talise bridge (Node, :8787)         |
|    POST /zklogin/address             |
|         → jwtToAddress(jwt, salt)    |
|    POST /tx/build                    |
|         → BCS-encoded PTB bytes      |
|    POST /zklogin/sign                |
|         → final zkLoginSignature     |
|    POST /sponsor (optional)          |
|         → gas-payment co-sign        |
+------------+-------------------------+
             |
             | 3. ZK proof
             v
+--------------------------------------+
|  Mysten prover                       |
|    prover-dev.mystenlabs.com/v1      |
|    proves user knows JWT preimage    |
|    without revealing it on-chain     |
+------------+-------------------------+
             |
             | 4. Execute tx
             v
+--------------------------------------+
|  Sui RPC fullnode                    |
|    sui_executeTransactionBlock       |
|    verifies zkLoginSignature         |
|    runs the PTB                      |
|    returns digest                    |
+--------------------------------------+
```

## Why each piece exists

### Ephemeral key (Curve25519, on device)
Used to sign the actual tx bytes. Lives in Keychain. Regenerated on sign-out. Rotates with each session if you want extra hygiene. iOS has Curve25519 built in via CryptoKit so no third-party crypto.

### Salt (16 random bytes, on device)
Decouples the user's Google `sub` claim from their on-chain address. Two users with different salts but the same Google account would have different Sui addresses. Stored in Keychain. **Never sent to the bridge except inside the user's own request — the bridge does not persist it.**

### JWT (from Google)
The `id_token` returned by the OAuth code flow. Contains `sub` (stable user ID), `aud` (the OAuth client ID), `exp`. The bridge decodes its payload to extract `sub` for the address-seed Poseidon hash.

### Bridge
Stateless. Does three Sui-SDK-only operations: Poseidon hash (`genAddressSeed`), Blake2b/JWT-to-address (`jwtToAddress`), BCS encoding (`Transaction.build()`). All from `@mysten/sui` + `@mysten/zklogin`. Could be replaced by a pure-Swift implementation later when one exists.

### Mysten prover
Computes the actual ZK SNARK proving the user holds a valid Google JWT. This is the trust-minimization piece — it lets the chain verify the signature without storing the JWT or learning the Google `sub`. The dev prover at `prover-dev.mystenlabs.com` is free for any address. Mainnet uses `prover.mystenlabs.com` (no `-dev`).

### Sui RPC
Standard fullnode endpoint. `sui_executeTransactionBlock` verifies the zkLogin signature against the prover's verification key and the on-chain epoch state. If valid, runs the PTB.

## Signature flow (signing a transaction)

```
1. iOS describes Move call (sender, package, module, fn, args)
        ↓
2. bridge.tx/build → BCS PTB bytes (base64)
        ↓
3. iOS signs intent-prefixed bytes with ephemeral Ed25519
   → userSignature (base64)
        ↓
4. iOS calls prover with {jwt, ephemeralPubKey, jwtRandomness, salt}
   → ZK proof (JSON blob)
        ↓
5. bridge.zklogin/sign → wraps proof + ephemeralSig + addressSeed
   → final zkLoginSignature (base64)
        ↓
6. iOS calls Sui RPC sui_executeTransactionBlock
   → digest if effects.status == "success"
```

The PTB **bytes** are identical across signing strategies — the only thing that changes is what wraps the ephemeral signature. This means you can swap zkLogin for hardware-wallet, paste-key, or any other auth without touching the PTB construction code.

## Sponsored transactions

If `SPONSOR_PRIVATE_KEY_B64` is set in the bridge, the user can have gas paid for them:

```
1. iOS calls /tx/build with onlyTransactionKind: true → tx-kind bytes (no gas)
        ↓
2. iOS calls /sponsor with kind bytes + sender address
        ↓
3. Bridge attaches its own SUI coin as gas, signs as gas-owner
        ↓
4. Returns {signedTxBytesB64, sponsorSignatureB64}
        ↓
5. iOS signs signedTxBytesB64 with ephemeral key, wraps via /zklogin/sign
        ↓
6. Submits with signature list = [zkLoginSig, sponsorSig]
```

User pays zero SUI. Bridge pays gas. New users can sign in with Google and immediately transact without ever holding SUI.

## Persistence model

| Lives | Where | Cleared on |
|---|---|---|
| Google JWT | Keychain (`talise.zkLoginJWT`) | sign-out, JWT expiry, app reset |
| Salt | Keychain (`talise.zkLoginSalt`) | sign-out, app reset |
| Ephemeral key | Keychain (`talise.zkLoginEphemeralKey`) | sign-out, app reset |
| JWT randomness | Keychain (`talise.zkLoginRandomness`) | sign-out, app reset |
| Sui address | UserDefaults (`talise.zkLoginAddress`) | sign-out, app reset |
| Sponsor key | Bridge env var | n/a (server-side) |

On app launch, `ZkLoginService.init()`:
1. Loads JWT from Keychain
2. Calls `jwtIsExpired()` — if true, wipes everything and goes to `.idle`
3. Else loads salt + ephemeral key + randomness + saved address
4. Goes to `.ready(suiAddress:)`

So users stay signed in across app restarts until their JWT expires (typically 60 minutes for Google).

## Security model

- **What the bridge sees:** JWT (already exposed during OAuth), salt, public ephemeral key, public Sui address. **Never:** private ephemeral key, Google password.
- **What the prover sees:** JWT, public ephemeral key, salt, jwt randomness. Same exposure as the bridge.
- **What can a compromised bridge do?** Read user JWTs (limited value — Google rate-limits API calls per-app) and recover their public address. Cannot sign transactions. Cannot drain funds.
- **What can a compromised device do?** Sign any tx with the ephemeral key and the cached JWT until expiry. After JWT expiry, attacker needs to phish Google. Mitigation: keep `defaultMaxEpoch` tight in production (currently 1_000_000 — too loose for prod).
- **The salt** is what binds a Google account to a specific Sui address. If a user wipes their device they lose the salt and the address becomes unrecoverable. **Production should back the salt up** (e.g. user-encrypted iCloud doc, or a salt-recovery service). For the hackathon, sign-out + sign-back-in with a new salt = new address. Acceptable.
