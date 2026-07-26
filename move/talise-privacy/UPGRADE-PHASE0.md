# Phase 0 — shipping the F-1 fix on-chain

**Status: PREPARED, NOT EXECUTED.** Nothing in this document has been run. No
package was published or upgraded, no transaction was submitted, no env var was
changed. This is the runbook plus the reasoning behind it.

What Phase 0 changed in code (`sources/shielded_pool.move`):

1. **step 3b `assert_relayer_fee`** — a `relayer_fee` is payable only on a
   public leg (`value > 0`), only up to `value`, only up to an immutable
   `MAX_RELAYER_FEE_BPS` (500 = 5%) share of `value`, only up to the operator's
   absolute `RelayerPolicy.max_fee`, and only to the ONE configured official
   relayer. Fail-closed: a pool with no policy pays no fee at all.
2. **step 7 `assert_compliant`** — `assert!(!self.paused)` moved ABOVE the
   `value == 0` early return, so the kill switch covers the private leg.
3. **step 12 `assert_value_conserved`** — the pool-balance invariant
   (`Δbalance == signed public value`) is now asserted at runtime.

The verifying key in `constants.move` was **not touched** (that is the ceremony
phase, owned by someone else).

---

## 0. READ THIS FIRST — an upgrade alone does NOT close F-1

Sui package upgrades are additive: the **old package version stays on-chain and
stays callable forever**. A `ShieldedPool` object's type identity is
`<original-id>::shielded_pool::ShieldedPool<T>`, and *every* version of the
package accepts objects of that type. So after upgrading, an attacker can
simply target the OLD package id:

```
0x8722…f9bf::shielded_pool::transact(<pool>, …)      # old, vulnerable code
0xNEW…::shielded_pool::transact(<pool>, …)            # new, fixed code
```

Both entry points operate on the same shared object. Updating `SHIELD_PKG` in
Vercel changes what *our* clients build; it does not stop anyone else from
constructing a PTB against the old id by hand. **The drain does not need our
app** — `transact` is `public` on a shared object and the proving key is a public
3.8 MB browser asset.

The usual Sui defence is a `version: u64` field on the shared object that every
entry point asserts against a module constant; bumping the object's version then
makes the old code abort. That only works if the guard was in the code from day
one. `ShieldedPool` has no version field, and a package upgrade **may not add
one** (see §1), so the old code cannot be locked out that way.

### Therefore: publish fresh, do not upgrade in place

**Recommended path (§3): a fresh `sui client publish`.** A new publish gets a new
`original-id`, so `0xNEW::shielded_pool::ShieldedPool<USDsui>` is a *different
type* that the old package physically cannot touch. That is the only airtight
option, and it costs nothing extra operationally: the plan is already to mint a
fresh pool, and a fresh publish also mints a fresh `Registry` (one more env id to
update).

§2 documents the in-place `sui client upgrade` with the existing `UpgradeCap`
anyway, because it was requested — and §2.4 gives the one code change that would
make an in-place upgrade genuinely safe, if preserving the package id ever
matters more than the extra coordination.

---

## 1. What an upgrade may and may not change

The "compatible" upgrade policy (`policy: 0` on both caps) allows:

* adding new modules, new structs, new public functions;
* changing function *bodies*;
* adding new dynamic fields at runtime.

It forbids changing an existing struct's layout — including **adding a field**.

This is why the Phase-0 fee policy lives in a **dynamic field**
(`RelayerPolicyKey` → `RelayerPolicy { relayer, max_fee }`) rather than as two
new `ShieldedPool` fields. Adding `official_relayer` / `max_relayer_fee` to
`ShieldedPool` would fail the local compatibility check that `sui client
upgrade` runs before it submits anything. Everything Phase 0 adds is additive:

| added | kind | upgrade-safe |
| --- | --- | --- |
| `RelayerPolicyKey`, `RelayerPolicy` | new structs | yes |
| `set_relayer_policy`, `relayer_policy`, `max_relayer_fee_bps` | new public funs | yes |
| `assert_relayer_fee`, `assert_value_conserved`, `relayer_policy_or_closed` | new private funs | yes |
| `events::RelayerPolicySet` + emitter | new struct + new fun | yes |
| `EInvalidRelayerFee` (811), `EValueNotConserved` (812) | new constants | yes |
| reordered `paused` assert, new asserts in `process_transaction` | function bodies | yes |

`ShieldedPool`, `Registry`, `PoolAdminCap`, `MerkleTree`, `Proof`, `ExtData`,
`NoteAccount` are all **unchanged in layout**, so existing objects keep working
and `original-id` is preserved — the upgrade changes `published-at` only.

Verify locally before touching the chain (this is the default; do **not** pass
`--skip-verify-compatibility`):

```bash
cd move/talise-privacy
sui move build          # must be warning-free
sui move test           # 36/36 must pass, incl. f1_fee_drain_now_aborts
npx move-doctor@latest --verbose   # 100/100
```

---

## 2. In-place upgrade (existing `UpgradeCap`)

### 2.1 The two environments are NOT the same package

`Published.toml` in this repo only records **testnet**:

| | testnet (`Published.toml`) | mainnet (`web/.env.example`) |
| --- | --- | --- |
| `original-id` == `published-at` | `0x4c6a334ba2438470b9d55c141e456bc564cab5f684e4fcc14fede9d30c46f823` | `0x8722790773958722225cf91f5a6762689dc13f97076534c05ebd3505d586f9bf` |
| `UpgradeCap` | `0x7f86f7281ef16c26da6bbe63abc9cdc0374ead8c5ae8086a7733c084c5008455` | `0xed003bda9a0e076bafdca34fc58bbef39aa2c95069c2cd21fb6b97d567062598` |
| `ShieldedPool<USDsui>` | — | `0x6bcd28763456db543d0c29acb34970b81e4d7f004d2581fce46b813ece8152c1` |
| `PoolAdminCap` | — | `0xaba382239cdd835d586dc6b16aadef0469ed296e12e478539a6db35eb6569384` |
| owner of both caps | — | `0xb7297dc4389143e3dec6e4796aec36250297a04e998a479cae27d1f65ccf6009` |

**`0x7f86…8455` is the TESTNET cap.** Using it upgrades `0x4c6a33…`, which is
*not* what `SHIELD_PKG` points at. The vulnerable code that holds real money is
mainnet `0x8722…f9bf`, whose cap is `0xed003b…2598` (verified on mainnet:
`policy: 0`, `version: 1`, `package: 0x8722…f9bf`). Fixing only testnet would
leave the live exposure untouched.

### 2.2 The invocation

```bash
cd move/talise-privacy

# TESTNET
sui client switch --env testnet
sui client upgrade \
  --upgrade-capability 0x7f86f7281ef16c26da6bbe63abc9cdc0374ead8c5ae8086a7733c084c5008455 \
  --gas-budget 500000000

# MAINNET  (sign as 0xb7297dc4…6009, which owns the cap)
sui client switch --env mainnet
sui client upgrade \
  --upgrade-capability 0xed003bda9a0e076bafdca34fc58bbef39aa2c95069c2cd21fb6b97d567062598 \
  --gas-budget 500000000
```

Notes:

* Run it from the package directory; `[package_path]` defaults to `.`.
* Add `--dry-run` first to see the compatibility verdict and gas without
  submitting.
* Do not pass `--skip-verify-compatibility` or `--skip-dependency-verification`.
  The first is the check described in §1; the second is what proves the on-chain
  dependency bytecode matches these sources.
* On success the CLI rewrites `Published.toml`: `published-at` becomes the NEW
  package id, `original-id` and `upgrade-capability` stay as they are, `version`
  becomes 2. **Commit that change** — it is the record of which code is live.

### 2.3 What the upgrade does and does not achieve

* Existing objects (pool, registry, caps, merkle tree) are untouched and remain
  usable by the new code. No migration is needed for them.
* The new pools created by the new `new()` get the `RelayerPolicy` dynamic field
  pre-installed, closed (`@0x0`, 0).
* The **existing** pool has no such field. `relayer_policy_or_closed` returns
  `(@0x0, 0)` when the field is absent, so it refuses every fee — fail-closed
  without any migration step. `set_relayer_policy` installs the field on first
  call if it is missing.
* **The old package id keeps executing the OLD code.** `SHIELD_PKG` must be
  repointed at the new `published-at` as part of the security fix, or our own
  clients keep calling the vulnerable module. But per §0, repointing the env var
  is necessary and **not sufficient** — the old id stays callable by anyone.

### 2.4 If you insist on upgrading in place: lock the old code out

One additive change makes old-package `transact` abort on newly created pools:
store the Merkle tree under a **new dynamic-field key type**.

```move
public struct MerkleTreeKeyV2() has copy, drop, store;   // new struct: upgrade-safe
// new():            dof::add(&mut pool.id, MerkleTreeKeyV2(), merkle::new(ctx));
// merkle_tree():    dof::borrow(&self.id, MerkleTreeKeyV2())
```

The old module's `process_transaction` reaches `assert_root_is_known` at step 2,
which borrows `MerkleTreeKey()`; on a V2 pool that field does not exist, so the
old code aborts **before any balance moves**. Old `new()` cannot help an attacker
either: it needs the one shared `Registry`, and `registry.pools.add` aborts
because the CoinType is already registered.

Costs, which is why this is NOT the recommended path:

* The new code can no longer operate any pool created by the old package —
  including `0x6bcd28…52c1`. A fresh pool becomes mandatory (it already is).
* It breaks `web/lib/shield/indexer.ts`, which resolves the tree via
  `suix_getDynamicFieldObject` with
  `type: ${SHIELD.packageId}::shielded_pool::MerkleTreeKey`. That is
  `web/**` — owned by another agent this pass — so it needs coordination.

**Related latent bug for whoever owns the SDK:** that same line composes the key
type from `SHIELD.packageId`. Struct types are always named by the **original**
package id, never `published-at`. After any in-place upgrade, setting
`SHIELD_PKG` to the new `published-at` makes that type string wrong and the
lookup return nothing. A fresh publish keeps `original == published-at`, so the
bug stays latent — one more reason to prefer §3.

---

## 3. Recommended: fresh publish + fresh pool

```bash
cd move/talise-privacy
sui client switch --env mainnet
sui client publish --gas-budget 800000000
```

Then, in one PTB or three transactions, as the publisher:

1. `shielded_pool::new<USDSUI>(&mut registry, ctx)` → `(pool, PoolAdminCap)`
2. `shielded_pool::share(pool)`
3. `shielded_pool::set_caps(&mut pool, &cap, 2_500_000, 2_500_000)` — the pilot's
   $2.50/tx caps, matching the current live pool.
4. **Leave the relayer policy CLOSED** (`new()` already installs `(@0x0, 0)`).
   Only call `set_relayer_policy(&mut pool, &cap, <relayer>, <max_fee>)` when the
   relayed path is deliberately opened, and keep `max_fee` small — remember the
   immutable ceiling is 5% of the leg's value, and the operator's cap only ever
   tightens it.

Why a fresh pool regardless of which path §2/§3 you take:

* The VK binds at `new()` (`groth16::prepare_verifying_key` is stored in the pool
  object), so the ceremony phase will need a fresh pool anyway.
* A fresh publish gives a new type identity, which is what actually closes §0.
* The existing pool's Merkle tree and nullifier set are pilot-only state with no
  user-owned notes worth migrating.

Env ids to update afterwards (owned by whoever runs ops — **not changed here**):
`SHIELD_PKG`, `SHIELD_REGISTRY_ID`, `SHIELD_POOL_USDSUI`,
`SHIELD_FIRST_CHECKPOINT` (the new publish checkpoint, so the indexer starts
there), and keep `SHIELD_MAX_RELAYER_FEE=0` until a policy is deliberately
opened. `SHIELD_MAINTENANCE` was not touched.

---

## 4. The live pool is NOT empty — $10 of real USDsui is exposed right now

Read from mainnet while writing this (`sui_getObject` on
`0x6bcd28…52c1`, no transaction submitted):

```
type    : 0x8722…f9bf::shielded_pool::ShieldedPool<0x44f838…b1c1::usdsui::USDSUI>
balance : 10000000        # 10.000000 USDsui — $10, NOT zero
paused  : false
max_deposit / max_withdraw : 2500000 / 2500000
```

The Phase-0 brief assumed the pool was empty. It is not. This is almost
certainly the ~$10 recorded as "stranded, unrecoverable" from the June pilot.
Consequences:

* **That $10 is drainable by any member of the public today**, with the exploit
  the regression test now blocks. It needs no notes, no deposit and no
  permission — a zero-value transfer proof plus
  `relayer_fee = 10_000_000`.
* **`set_paused` will not protect it.** In the *deployed* code the `paused`
  assert sits below the `value == 0` early return; that is the ordering bug this
  phase fixes, and the fix only exists in the new bytecode. Pausing
  `0x6bcd28…52c1` today is a no-op against this path.
* Because it cannot be defended, it should be **removed**, not guarded. F-1 is
  itself the recovery mechanism for the stranded balance: a zero-value transfer
  naming the operator as relayer with `relayer_fee = 10_000_000` pays the whole
  balance to the operator. The funds are recoverable after all — the same bug
  that makes them stealable makes them retrievable.
* Sequence, therefore: **recover the $10 first, then publish the fix.** Doing it
  the other way round with an in-place upgrade would leave the old id (and the
  money) exposed for longer, and the fixed code deliberately refuses that fee,
  so a §3 fresh publish leaves the old pool recoverable only via the old package.

Executing that recovery is a money-path transaction and is explicitly out of
scope for this pass. It needs the deploy wallet
`0xb7297dc4389143e3dec6e4796aec36250297a04e998a479cae27d1f65ccf6009`, a
zero-value proof bound to `0x6bcd28…52c1` and its current root, and a human
decision. Flagging, not doing.

---

## 5. Post-deploy verification

Against the newly published/upgraded id, before repointing any env var:

1. `sui client object <new pool>` — `paused: false`, balance 0, caps set.
2. `shielded_pool::relayer_policy(<pool>)` reads `(@0x0, 0)` — fees closed.
3. Devinspect (or a $0.01 round trip) a **zero-value transfer with
   `relayer_fee = 1`**: it must abort with **811** (`EInvalidRelayerFee`). This
   is the F-1 assertion, on chain.
4. `set_paused(true)`, then attempt the same zero-value transfer with fee 0: it
   must abort with **810** (`EComplianceRefused`) — the kill switch now covering
   the private leg. Unpause.
5. A deposit and a fee-free withdraw must still work end to end, and the pool
   balance must move by exactly the cleartext value.

Steps 3–5 are the on-chain mirrors of `f1_fee_drain_now_aborts`,
`paused_pool_rejects_zero_value_internal_transfer` and
`conservation_holds_across_deposit_transfer_and_withdraw` in
`tests/poc_relayer_fee_drain_tests.move`.

---

## 6. Is the fee circuit-constrained or on-chain-bounded?

**On-chain-bounded, deliberately, with one part of it structural.**

`ext_data.public_value()` is the only channel through which the fee could reach
the proof's public inputs, and it does so on the deposit leg only
(`value - fee`). On the withdraw leg `public_value` is `-value`, fee-independent:
the fee is carved out of the withdrawn amount, so the pool's outflow is `value`
whatever the fee is. The regression suite makes this visible — one
byte-identical withdraw proof is accepted at fee 0, at the capped fee, and
rejected at cap+1, purely on the on-chain checks.

What IS now structural (no trust required):

* **Conservation.** `Δbalance == signed public_value` on every leg, asserted at
  step 12. The fee can never widen the pool's outflow beyond what the proof
  committed to. F-1 was exactly this equation failing by `fee`.
* **No fee on the private leg.** `value == 0` ⇒ `fee == 0`, so a leg whose proof
  authorises a zero delta can never pay anything.

What is bounded rather than proven:

* **Who gets the fee, and how big it is on a withdraw.** Bounded by the immutable
  5% relative ceiling, the operator's absolute `max_fee`, and the
  official-relayer restriction (a fee only pays the one configured relayer, who
  must also be the submitter, per step 3).

### Residual risk of that choice

A **compromised or dishonest official relayer** can inflate the fee on a
withdraw a user asked it to submit, up to `min(max_fee, 5% of value)`, because
the user's proof does not commit to the fee. It cannot exceed that, cannot touch
any other leg, and cannot be raised by an admin — the 5% ceiling is a module
constant.

That residual is **dominated by a larger gap in the same flow**: `ExtData` has no
`recipient` field, so `transact` returns the withdrawn coin into the *submitter's*
PTB. On a relayed withdraw the relayer receives `value - fee` and is trusted,
entirely off-chain, to forward it. A dishonest relayer does not need the fee
knob — it can keep the whole withdrawal. Capping the fee is therefore necessary
but not what makes relaying safe.

Recommendations for a later, coordinated phase (all need the SDK, none need a
new VK or a recompiled circuit):

1. Bind the fee into the proof by making `public_value` uniformly
   `signed_value - fee` (i.e. `-(value + fee)` on the withdraw leg, the
   Tornado-Nova formula). The existing circuit already accepts any
   `public_amount`; only the prover's arithmetic and this Move function change.
   Then the fee is circuit-constrained and tampering is impossible.
2. Add a `recipient: address` to `ExtData` and `public_transfer` the withdrawn
   coin on-chain instead of returning it, so a relayer cannot redirect it.
3. Until (1) and (2) ship, keep the relayer policy CLOSED and keep the withdraw
   path self-submitted (`relayer == @0x0`), where neither issue exists: the user
   builds the PTB and receives their own coin.

### Assumptions these claims rest on

* `sui::groth16::verify_groth16_proof` is sound and the VK in `constants.move`
  matches the circuit — unchanged this phase, and still a **single-party** setup
  (operator-trusted; the ceremony is a later phase).
* `ext_data.public_value()` is the only place `relayer_fee` enters the public
  inputs. Verified by reading `ext_data.move` and `proof.move`: the 8 inputs are
  `[pool, root, public_value, null0, null1, comm0, comm1, hashed_secret]`.
* `self.balance` is mutated only at steps 8 and 11 of `process_transaction`, so
  bracketing those two steps with `balance_before` / `balance.value()` measures
  the whole delta.
* A `PoolAdminCap` holder is trusted for availability (pause, caps, opening a fee
  policy) but **not** for the fee ceiling, which no cap can raise.
