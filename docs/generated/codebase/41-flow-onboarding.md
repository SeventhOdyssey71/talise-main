# 41. Flow: onboarding

The onboarding flow is intentionally narrow. The product strategy is to
look like an app the user signs into, not a wallet the user sets up. In
the current build there are two distinct entry points, gated by where
the user lands.

## Today: waitlist gate (production)

The web app at `talise.app` is in pre-launch private beta. The landing
page renders the product narrative and routes the user to a waitlist
form rather than to Google sign-in. The CTA on `app/page.tsx` reads
"Join waitlist" and links to `/waitlist`; the in-app `/auth/signin`
route exists but is feature-flagged off for general traffic.

The waitlist intentionally captures intent (email, country, optional
referrer) without burning a Google-OAuth round-trip and without
provisioning a Sui address. There is no zkLogin attempt on the public
landing, no Shinami call, no SuiNS read. The waitlist row is the only
artifact.

## When sign-in is open: the zkLogin path

Once the user is allowed in (waitlist invite, internal staff, iOS beta
tester), the onboarding flow is four steps. The implementation is the
same across iOS and web; what differs is where the OAuth round-trip
happens.

```
Sign in with Google  →  zkLogin derives Sui address  →  Claim @handle  →  Home
```

### Where Google OAuth happens

On **web**, the OAuth round-trip is server-mediated. The browser
generates an ephemeral Ed25519 keypair, fetches the current Sui epoch
from `/api/sui/epoch`, computes `maxEpoch = epoch + 10`, and binds the
ephemeral public key into the OAuth nonce via `generateNonce`. The
browser then redirects to `accounts.google.com` with that nonce. The
callback at `/auth/callback` exchanges the code for the ID token on
the server, calls Shinami's `shinami_zkw_getOrCreateZkLoginWallet` to
materialize a deterministic Sui address from `(iss, sub)`, and sets
two session cookies: `talise_sess` (user id) and `talise_jwt` (httpOnly
signed cookie holding the JWT and salt for later proof generation).

On **iOS**, the same OAuth is handled in-app through `ZkLoginCoordinator`
(`ios/Talise/Auth/ZkLoginCoordinator.swift`). The ephemeral key is
generated locally, the nonce is bound to it before the OAuth sheet is
presented, and the ID token returned by Google is shipped to the web
backend's mobile-session endpoint so the same Shinami address derivation
runs there. The bearer token returned to the iOS client is what every
subsequent `/api/...` request uses, instead of cookies. The mobile path
is what's evolving most recently: the recent `00653cc` and `5421c4b`
commits track race-safety and a base64URL fix for the ephemeral pubkey
in the mobile-start endpoint.

### Why the address is stable

Shinami's salt is keyed on `(iss, sub)`. Same Google account, same Sui
address, forever. Reinstalling the iOS app, logging in on a new device,
or recovering a lost phone all produce the same address. This is what
makes "recovery is Google recovery" a coherent story.

## Handle claim (race-safe)

After sign-in, the user lands on `/onboarding` (or the iOS equivalent),
which checks whether they own a `*.talise.sui` subname NFT. The check
reads the chain via `findTaliseSubnameForOwner(address)`, scanning the
user's `SubDomainRegistration` objects. There is no DB column consulted
for handle resolution.

The claim itself happens in two steps in `web/app/api/username/claim/`:

1. **Pre-mint check.** Normalize the handle, reject reserved names,
   call `SuinsClient.getNameRecord("alice.talise.sui")`. If the on-chain
   record exists, return 409.
2. **Mint.** Build a SuiNS transaction that creates a subname under
   `talise.sui` and transfers the resulting NFT to the user's address.
   The operator key (which holds the `talise.sui` parent NFT) signs as
   the sender. Onara does not sponsor this; the operator pays the gas.

The race-safety pattern matters because two users can hit the same
handle in the same second. The pre-mint check is best-effort. The
authoritative race-loser path is the mint itself: if a second mint
attempt reaches Sui after a first one already grabbed the name, the
SuiNS contract rejects it and the route returns a clean 502 with the
exact on-chain reason. Critically, no DB row is written before the mint
succeeds (commit `5421c4b` tightened this), so we cannot end up with a
"claimed" user who does not own the NFT.

## Why this design

Three properties fall out of the on-chain-first approach:

1. **No DB-as-source-of-truth for handles.** If the Talise database
   burned down tomorrow, every user would still own their Sui address
   (Google + Shinami salt is deterministic) and still own their
   `*.talise.sui` NFT. They could log into a fresh Talise install and
   resume against the same account.
2. **The handle is portable.** A user could in principle take the
   subname NFT to a non-Talise wallet. Resolution from
   `alice@talise.sui` to their address would still work for any other
   Sui app that does a SuiNS lookup.
3. **The DB is a cache.** `tx_history`, `mobile_sessions`, onboarding
   flags, and analytics fields all live in libSQL. None of them gate
   correctness for value movement.

## Cross-references

- `42-flow-send.md` for what happens after the user has a handle.
- `02-move-rbac-and-caps.md` for the on-chain role model that the
  operator key sits inside.
- Recent commits that touched this flow: `5421c4b` (race-safe handle
  claim), `00653cc` (mobile-start base64URL fix), `4180d5a` (proof JSON
  round-trip fix), `c2b9b37` (receipt labeling).
