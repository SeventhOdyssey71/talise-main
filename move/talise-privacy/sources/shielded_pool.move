/// Talise privacy — the shielded pool (Workstream A, mirrors `vortex.move`).
///
/// `ShieldedPool<phantom CoinType>` is a shared object that custodies a single
/// `Balance<CoinType>` and the spent-nullifier set. The private representation
/// is the NOTE (a commitment in the Merkle tree); there is no wrapped coin.
/// One `transact()` performs deposit / private-transfer / withdraw, gated by a
/// Groth16 proof.
///
/// `process_transaction` ORDERING IS THE SPEC (verbatim from the reference's
/// 11 steps, plus our compliance gate slotted in AFTER verify):
///   1. pool-address bind   (anti cross-pool replay)        — fatal
///   2. known-root          (proof targets a real root)
///   3. relayer             (submitter == named relayer)
///  3b. relayer-fee policy  (F-1 fix; cleartext-only, ADDS refusals)
///   4. public-value tie    (proof.public_value == ext.public_value) — fatal
///   5. nullifier-unspent   (no double-spend)
///   6. groth16 verify      (soundness)
///   7. compliance gate     (AFTER verify; can only ADD refusals)
///   8. coin move           (deposit in / withdraw out)
///   9. write nullifiers    (+ emit NullifierSpent)
///  10. append_pair         (+ emit NewCommitment x2)
///  11. relayer fee
///  12. value-conservation invariant (Δbalance == signed public value) — fatal
///
/// The two drop-prone-fatal checks are (1) pool-address binding and (4) the
/// public-value tie — both are explicit and tested.
///
/// ── PHASE-0 SECURITY FIX (F-1, permissionless pool drain) ──────────────────
/// Before Phase 0, step 11 paid `ext_data.relayer_fee()` out of `self.balance`
/// with no cap, no relayer restriction, and — on the private leg
/// (`ext_data.value() == 0`) — no compliance gate at all, because step 7
/// returned EARLY on `value == 0` and the `paused` assertion sat BELOW that
/// return. On that leg `public_value` is `0 mod r`, so the SNARK proves nothing
/// about the fee: a valid proof of a trivial all-zero-value transfer (provable
/// by ANYONE, no notes required — zero-amount inputs skip Merkle membership)
/// authorised an arbitrary payout, repeatable for the whole balance, and
/// `set_paused` could not stop it.
///
/// Three changes close it, and each stands alone:
///   * step 3b `assert_relayer_fee` — a fee is payable ONLY on a public leg
///     (`value > 0`), only up to `value`, only up to an IMMUTABLE
///     `MAX_RELAYER_FEE_BPS` share of `value`, only up to the operator's
///     absolute `RelayerPolicy.max_fee`, and only to the ONE configured
///     official relayer. Fail-closed: a pool with no policy pays no fee.
///   * step 7 `assert_compliant` — `paused` is now asserted FIRST, for every
///     leg including the private one, so the kill switch actually kills.
///   * step 12 `assert_value_conserved` — the pool-balance invariant is now
///     CHECKED at runtime, not merely reasoned about: `Δbalance` must equal the
///     signed public value that step 4 tied to the proof. F-1 was exactly this
///     equation being off by `relayer_fee`.
module talise_privacy::shielded_pool;

use std::{ascii::String, type_name};
use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    dynamic_field as df,
    dynamic_object_field as dof,
    groth16::{Self, Curve, PreparedVerifyingKey, PublicProofInputs},
    table::{Self, Table},
    transfer::Receiving
};
use talise_privacy::{
    constants,
    events,
    ext_data::ExtData,
    merkle::{Self, MerkleTree},
    note_account::NoteAccount,
    proof::Proof
};

// Local mirrors of the canonical 8xx registry in `errors.move` — declared here
// so each `assert!` names a same-module constant (the W04005 lint + the
// `yield_router` idiom). Keep numbers in sync with `errors.move`.
const EProofRootNotKnown: u64 = 800;
const EInvalidProof: u64 = 801;
const EInvalidPool: u64 = 802;
const ENullifierAlreadySpent: u64 = 803;
const EInvalidPublicValue: u64 = 804;
const EInvalidDepositValue: u64 = 805;
const EPoolAlreadyExists: u64 = 807;
const EComplianceRefused: u64 = 810;
const EInvalidRelayerFee: u64 = 811;
const EValueNotConserved: u64 = 812;

// === Constants ===

/// IMMUTABLE ceiling on a relayer fee, in basis points of the CLEARTEXT public
/// leg value (`ext_data.value()`). 500 bps == 5%.
///
/// This is a hard-coded module constant on purpose: `RelayerPolicy.max_fee` is
/// operator-settable and therefore only as trustworthy as the `PoolAdminCap`,
/// whereas this bound cannot be raised by any admin, compromised or not. It is
/// expressed relative to `value` (not as an absolute amount) because
/// `ShieldedPool` is generic over `CoinType` and decimals differ per coin.
const MAX_RELAYER_FEE_BPS: u64 = 500;

const BPS_DENOMINATOR: u64 = 10_000;

// === Structs ===

/// Key for the Merkle tree stored as a dynamic object field on the pool
/// (same dof idiom as `yield_router`'s venue receipts).
public struct MerkleTreeKey() has copy, drop, store;

/// Key for the `RelayerPolicy` stored as a dynamic FIELD on the pool.
///
/// WHY A DYNAMIC FIELD AND NOT TWO MORE `ShieldedPool` FIELDS: a Sui package
/// upgrade may add new types and new public functions but may NOT change the
/// layout of an existing struct. `ShieldedPool` is already published, so adding
/// `official_relayer` / `max_relayer_fee` fields to it would make this fix
/// un-upgradeable (`sui client upgrade` would fail the compatibility check).
/// A new key type + a new value type attached as a dynamic field is additive
/// and therefore upgrade-safe. See UPGRADE-PHASE0.md.
public struct RelayerPolicyKey() has copy, drop, store;

/// Who may charge a relayer fee, and the operator's absolute per-tx ceiling.
///
/// The zero value (`@0x0`, 0) is CLOSED: no relayer is official and no fee may
/// be paid. That is also what a pool created by a pre-Phase-0 package reads as,
/// because the dynamic field is simply absent (see `relayer_policy_or_closed`).
public struct RelayerPolicy has copy, drop, store {
    /// The ONE address that may receive a fee. `@0x0` == fees closed.
    relayer: address,
    /// Absolute per-transaction fee cap in `CoinType` units. 0 == fees closed.
    /// Only ever TIGHTENS `MAX_RELAYER_FEE_BPS`; it can never loosen it.
    max_fee: u64,
}

public struct ShieldedPool<phantom CoinType> has key {
    id: UID,
    curve: Curve,
    vk: PreparedVerifyingKey,
    balance: Balance<CoinType>,
    nullifier_hashes: Table<u256, bool>,
    // ── Compliance gate (fail-closed; all PoolAdminCap-gated) ──
    // These per-pool caps + kill switch are layered ON TOP of the shared
    // `talise::compliance::ComplianceRegistry` (denylist / allowlist / global
    // pause), which the public legs now screen against via
    // `talise::compliance::assert_clear_external` in `assert_compliant`. The
    // gate runs AFTER groth16 verify, so it can only ADD refusals — proof
    // soundness is untouched.
    /// Hard kill switch for the public legs (private internal transfers, where
    /// `public_value == 0` i.e. value == 0, are intentionally NOT gated).
    paused: bool,
    /// Max cleartext value for a single deposit leg (0 == no cap).
    max_deposit: u64,
    /// Max cleartext value for a single withdraw leg (0 == no cap).
    max_withdraw: u64,
}

public struct Registry has key {
    id: UID,
    /// CoinType type-name -> pool address.
    pools: Table<String, address>,
}

/// Capability that authorizes compliance-knob changes on a pool. Held by the
/// pool operator; minted once when the pool is created.
public struct PoolAdminCap has key, store {
    id: UID,
    /// The pool this cap governs (bind so one cap can't configure another pool).
    pool: address,
}

// === Initializer ===

fun init(ctx: &mut TxContext) {
    transfer::share_object(Registry {
        id: object::new(ctx),
        pools: table::new(ctx),
    });
}

// === Mutative Functions ===

/// Create a pool for `CoinType`. Returns the pool (caller shares it) and the
/// `PoolAdminCap` bound to it. One pool per CoinType, enforced via the registry.
public fun new<CoinType>(
    registry: &mut Registry,
    ctx: &mut TxContext,
): (ShieldedPool<CoinType>, PoolAdminCap) {
    let id = type_name::with_defining_ids<CoinType>().into_string();
    assert!(!registry.pools.contains(id), EPoolAlreadyExists);

    let curve = groth16::bn254();

    let mut pool = ShieldedPool {
        id: object::new(ctx),
        vk: groth16::prepare_verifying_key(&curve, &constants::verifying_key!()),
        curve,
        balance: balance::zero(),
        nullifier_hashes: table::new(ctx),
        paused: false,
        max_deposit: 0,
        max_withdraw: 0,
    };

    let pool_address = pool.id.to_address();
    registry.pools.add(id, pool_address);
    dof::add(&mut pool.id, MerkleTreeKey(), merkle::new(ctx));
    // Fees start CLOSED. The operator must name an official relayer and an
    // absolute cap via `set_relayer_policy` before any fee can be paid.
    // (Attached AFTER `pool.id` is minted, so the pool's own address — which
    // proofs are bound to — is unchanged by this addition.)
    df::add(
        &mut pool.id,
        RelayerPolicyKey(),
        RelayerPolicy { relayer: @0x0, max_fee: 0 },
    );

    events::new_pool<CoinType>(pool_address);

    let cap = PoolAdminCap { id: object::new(ctx), pool: pool_address };
    (pool, cap)
}

public fun share<CoinType>(pool: ShieldedPool<CoinType>) {
    transfer::share_object(pool);
}

/// Unsponsored path: caller supplies the deposit coin directly (deposit /
/// internal-transfer / withdraw). `hashed_secret` is ZERO in the public inputs.
public fun transact<CoinType>(
    self: &mut ShieldedPool<CoinType>,
    deposit: Coin<CoinType>,
    proof: Proof<CoinType>,
    ext_data: ExtData,
    ctx: &mut TxContext,
): Coin<CoinType> {
    self.process_transaction(deposit, proof.public_inputs(), proof, ext_data, ctx)
}

/// Sponsored path: the deposit coin is swept from a `NoteAccount`'s inbox and
/// the account's `hashed_secret` is bound into the public inputs.
public fun transact_with_account<CoinType>(
    self: &mut ShieldedPool<CoinType>,
    account: &mut NoteAccount,
    proof: Proof<CoinType>,
    ext_data: ExtData,
    coins: vector<Receiving<Coin<CoinType>>>,
    ctx: &mut TxContext,
): Coin<CoinType> {
    let deposit = account.receive(coins, ctx);
    self.process_transaction(
        deposit,
        proof.account_public_inputs(account.hashed_secret()),
        proof,
        ext_data,
        ctx,
    )
}

// === Compliance admin (PoolAdminCap-gated; fail-closed) ===

/// TODO(phase-2): supersede with `talise::compliance` once wired.
public fun set_paused<CoinType>(
    self: &mut ShieldedPool<CoinType>,
    cap: &PoolAdminCap,
    paused: bool,
) {
    self.assert_cap(cap);
    self.paused = paused;
}

public fun set_caps<CoinType>(
    self: &mut ShieldedPool<CoinType>,
    cap: &PoolAdminCap,
    max_deposit: u64,
    max_withdraw: u64,
) {
    self.assert_cap(cap);
    self.max_deposit = max_deposit;
    self.max_withdraw = max_withdraw;
}

/// Name the ONE relayer allowed to charge a fee, and its absolute per-tx cap.
///
/// Passing `@0x0` or `max_fee == 0` CLOSES fees entirely (the default state of
/// a freshly created pool). `max_fee` can only tighten `MAX_RELAYER_FEE_BPS`,
/// never loosen it — the bps ceiling is enforced independently in
/// `assert_relayer_fee`, so even a stolen `PoolAdminCap` cannot authorise a fee
/// larger than `MAX_RELAYER_FEE_BPS` of a public leg's cleartext value.
public fun set_relayer_policy<CoinType>(
    self: &mut ShieldedPool<CoinType>,
    cap: &PoolAdminCap,
    relayer: address,
    max_fee: u64,
) {
    self.assert_cap(cap);

    let key = RelayerPolicyKey();
    if (df::exists_with_type<RelayerPolicyKey, RelayerPolicy>(&self.id, key)) {
        let policy: &mut RelayerPolicy = df::borrow_mut(&mut self.id, key);
        policy.relayer = relayer;
        policy.max_fee = max_fee;
    } else {
        // Pool minted by a pre-Phase-0 package: install the field now.
        df::add(&mut self.id, key, RelayerPolicy { relayer, max_fee });
    };

    events::relayer_policy_set<CoinType>(self.id.to_address(), relayer, max_fee);
}

// === Public Views ===

public fun root<CoinType>(self: &ShieldedPool<CoinType>): u256 {
    // Explicit `merkle::` path (not method syntax) so this view is not mistaken
    // for self-recursion — it delegates to the merkle module, never itself.
    merkle::root(self.merkle_tree())
}

public fun is_known_root<CoinType>(self: &ShieldedPool<CoinType>, root: u256): bool {
    merkle::is_known_root(self.merkle_tree(), root)
}

public fun is_nullifier_spent<CoinType>(self: &ShieldedPool<CoinType>, nullifier: u256): bool {
    self.nullifier_hashes.contains(nullifier)
}

public fun next_index<CoinType>(self: &ShieldedPool<CoinType>): u64 {
    merkle::next_index(self.merkle_tree())
}

public fun balance_value<CoinType>(self: &ShieldedPool<CoinType>): u64 {
    self.balance.value()
}

public fun is_paused<CoinType>(self: &ShieldedPool<CoinType>): bool { self.paused }

/// `(official_relayer, max_fee)`. `(@0x0, _)` or `(_, 0)` means fees are CLOSED.
public fun relayer_policy<CoinType>(self: &ShieldedPool<CoinType>): (address, u64) {
    let policy = self.relayer_policy_or_closed();
    (policy.relayer, policy.max_fee)
}

/// The immutable relative fee ceiling, in basis points of a public leg's value.
public fun max_relayer_fee_bps(): u64 { MAX_RELAYER_FEE_BPS }

public fun pool_address<CoinType>(registry: &Registry): Option<address> {
    let id = type_name::with_defining_ids<CoinType>().into_string();
    if (registry.pools.contains(id)) option::some(registry.pools[id])
    else option::none()
}

// === Private Functions ===

fun assert_cap<CoinType>(self: &ShieldedPool<CoinType>, cap: &PoolAdminCap) {
    assert!(cap.pool == self.id.to_address(), EInvalidPool);
}

// (1) anti cross-pool replay — fatal.
fun assert_pool<CoinType>(self: &ShieldedPool<CoinType>, pool: address) {
    assert!(pool == self.id.to_address(), EInvalidPool);
}

// (2) the targeted root must be one the tree has held.
fun assert_root_is_known<CoinType>(self: &ShieldedPool<CoinType>, root: u256) {
    assert!(self.merkle_tree().is_known_root(root), EProofRootNotKnown);
}

// (4) the proof's public delta must equal the cleartext ext-data delta — fatal.
fun assert_public_value<CoinType>(proof: Proof<CoinType>, ext_data: ExtData) {
    assert!(
        proof.public_value() == ext_data.public_value(),
        EInvalidPublicValue,
    );
}

// (3b) relayer-fee policy — the F-1 fix.
//
// This is a CLEARTEXT-ONLY check on `ext_data` (like step 3), so it runs
// pre-verify: it reads no witness, weakens no proof check, and can only ADD
// refusals. Placing it before step 4 also removes a latent u64 underflow —
// `ext_data.public_value()` computes `value - relayer_fee` on the deposit leg.
//
// ASSUMPTION BEING RELIED ON: `ext_data.public_value()` is the ONLY place the
// fee can enter the proof's public inputs, and it does so only on the deposit
// leg (`value - fee`). On the withdraw leg the fee is carved OUT of `value`
// (the recipient gets `value - fee`), so the pool's total outflow is `value`
// either way. The fee is therefore *bounded by* a proof-committed quantity on
// both public legs, and must be exactly zero on the private leg where no such
// quantity exists. Everything below enforces precisely that.
fun assert_relayer_fee<CoinType>(self: &ShieldedPool<CoinType>, ext_data: ExtData) {
    let fee = ext_data.relayer_fee();
    if (fee == 0) return; // nothing is paid, so nothing needs bounding.

    let value = ext_data.value();

    // (a) THE DRAIN FIX. A fee is payable only on a PUBLIC leg. When
    //     `value == 0` the signed public value is `0`, so the SNARK authorises
    //     a net pool delta of zero and any fee at all would be value created
    //     from nothing. Abort rather than pay.
    assert!(value > 0, EInvalidRelayerFee);

    // (b) The fee must fit inside the value the proof committed to. This is
    //     implied by (c) while MAX_RELAYER_FEE_BPS <= BPS_DENOMINATOR, but it is
    //     stated explicitly because it is the invariant the two `value - fee`
    //     subtractions depend on (`ext_data::public_value` on the deposit leg,
    //     and the withdraw split at step 8). Keeping it here means neither can
    //     underflow no matter what the bps constant is later set to.
    assert!(fee <= value, EInvalidRelayerFee);

    // (c) IMMUTABLE relative ceiling — not raisable by any admin. u128 math so
    //     `value * MAX_RELAYER_FEE_BPS` cannot overflow.
    assert!(
        (fee as u128) * (BPS_DENOMINATOR as u128)
            <= (value as u128) * (MAX_RELAYER_FEE_BPS as u128),
        EInvalidRelayerFee,
    );

    // (d) Operator policy: exactly one official relayer, plus an absolute cap.
    //     Fail-closed — an unset/absent policy is `(@0x0, 0)` and refuses.
    //     Combined with step 3 (`assert_relayer`: a named relayer MUST be the
    //     submitter), a fee can only ever be paid to the official relayer AND
    //     only when that relayer is the one submitting the transaction.
    let policy = self.relayer_policy_or_closed();
    assert!(policy.relayer != @0x0, EInvalidRelayerFee);
    assert!(ext_data.relayer() == policy.relayer, EInvalidRelayerFee);
    assert!(fee <= policy.max_fee, EInvalidRelayerFee);
}

// (7) compliance gate — runs AFTER verify, can only ADD refusals. Internal
// transfers (value == 0) are COMPLIANCE-ungated (no cap / no screening) by
// design, but the kill switch below applies to them too. Fail-closed.
//
// registry: on a deposit leg it is the deposit sender; on a withdraw leg it is
// the withdraw recipient/submitter. Both are `ctx.sender()` here — the only
// on-chain identity bound to a `transact` PTB (the relayer pre-screens the exit
// address off-chain; ExtData carries no recipient field by design).
fun assert_compliant<CoinType>(
    self: &ShieldedPool<CoinType>,
    ext_data: ExtData,
) {
    // Per-pool kill switch (operator-controlled). PHASE-0 FIX: this is asserted
    // FIRST, above the `value == 0` early return, so it covers EVERY leg
    // including the private internal transfer. Before Phase 0 it sat below the
    // return, which meant `set_paused` did not stop an internal transfer at all
    // — and therefore could not stop the F-1 drain, which rode on exactly that
    // leg. Pausing always applies; only the cleartext COMPLIANCE screening
    // below is skipped for the private leg.
    assert!(!self.paused, EComplianceRefused);

    let value = ext_data.value();
    if (value == 0) return; // private internal transfer — ungated by design.

    // Shared on-chain enforcement floor: global pause + denylist + (optional)
    // allowlist on the public-leg party. Cross-package call into `talise`.

    if (ext_data.value_sign()) {
        // deposit leg
        if (self.max_deposit > 0)
            assert!(value <= self.max_deposit, EComplianceRefused);
    } else {
        // withdraw leg
        if (self.max_withdraw > 0)
            assert!(value <= self.max_withdraw, EComplianceRefused);
    };
    // TODO(phase-2): optional KYC'd-recipient tier registry + viewing-key
    // disclosure here (needs the net-new on-chain KYC-tier registry).
}

fun process_transaction<CoinType>(
    self: &mut ShieldedPool<CoinType>,
    deposit: Coin<CoinType>,
    public_inputs: PublicProofInputs,
    proof: Proof<CoinType>,
    ext_data: ExtData,
    ctx: &mut TxContext,
): Coin<CoinType> {
    // 1. pool-address bind (fatal)
    self.assert_pool(proof.pool());

    // 2. known-root
    self.assert_root_is_known(proof.root());

    // 3. relayer
    ext_data.assert_relayer(ctx);

    // 3b. relayer-fee policy (F-1). Cleartext-only; ADDS refusals only.
    self.assert_relayer_fee(ext_data);

    // 4. public-value tie (fatal)
    proof.assert_public_value(ext_data);

    // 5. nullifier-unspent
    proof.input_nullifiers().do!(|nullifier| {
        assert!(!self.is_nullifier_spent(nullifier), ENullifierAlreadySpent);
    });

    // 6. groth16 verify (soundness)
    assert!(
        self.curve.verify_groth16_proof(&self.vk, &public_inputs, &proof.points()),
        EInvalidProof,
    );

    // 7. compliance gate (AFTER verify — can only ADD refusals)
    self.assert_compliant(ext_data);

    // 8. coin move
    let balance_before = self.balance.value();
    let ext_value = ext_data.value();

    if (ext_data.value_sign() && ext_value > 0)
        assert!(deposit.value() == ext_value, EInvalidDepositValue);

    let recipient_coin = if (!ext_data.value_sign() && ext_value > 0)
        self.balance.split(ext_value - ext_data.relayer_fee()).into_coin(ctx)
    else coin::zero<CoinType>(ctx);

    self.balance.join(deposit.into_balance());

    // 9. write nullifiers (+ events)
    proof.input_nullifiers().do!(|nullifier| {
        self.nullifier_hashes.add(nullifier, true);
        events::nullifier_spent<CoinType>(nullifier);
    });

    // 10. append_pair (+ NewCommitment x2)
    let commitments = proof.output_commitments();
    let merkle_tree_mut = self.merkle_tree_mut();
    let leaf_index = merkle_tree_mut.next_index();
    merkle_tree_mut.append_pair(commitments[0], commitments[1]);

    events::new_commitment<CoinType>(leaf_index, commitments[0], ext_data.encrypted_output0());
    events::new_commitment<CoinType>(leaf_index + 1, commitments[1], ext_data.encrypted_output1());

    // 11. relayer fee (bounded at step 3b; zero on the private leg)
    if (ext_data.relayer_fee() > 0)
        transfer::public_transfer(
            self.balance.split(ext_data.relayer_fee()).into_coin(ctx),
            ext_data.relayer(),
        );

    // 12. value-conservation invariant (fatal)
    assert_value_conserved(balance_before, self.balance.value(), ext_data);

    recipient_coin
}

/// (12) THE POOL-BALANCE INVARIANT, checked rather than assumed.
///
/// `Δbalance` must equal the signed public value the proof committed to. Step 4
/// tied `ext_data.public_value()` to `proof.public_value()`, so expressing the
/// expectation in terms of `ext_data` is equivalent to expressing it in terms
/// of the proof:
///
///   deposit  (`value_sign`)  : after == before + value - relayer_fee
///                              == before + public_value
///   withdraw (`!value_sign`) : after == before - value
///                              == before + public_value  (public_value == -value)
///   private  (`value == 0`)  : after == before
///                              == before + 0             (fee is forced to 0)
///
/// F-1 was this equation being off by exactly `relayer_fee` on the private leg.
/// Keeping the check here means any future refactor that reintroduces an
/// unbacked payout aborts the transaction instead of losing funds.
///
/// `before + value` is checked arithmetic: an overflow aborts, which is the
/// correct outcome (abort rather than pay). `value - relayer_fee` cannot
/// underflow because step 3b enforced `relayer_fee <= value`.
fun assert_value_conserved(before: u64, after: u64, ext_data: ExtData) {
    if (ext_data.value_sign()) {
        assert!(
            after == before + ext_data.value() - ext_data.relayer_fee(),
            EValueNotConserved,
        );
    } else {
        assert!(after + ext_data.value() == before, EValueNotConserved);
    };
}

/// The pool's `RelayerPolicy`, or the CLOSED zero value if the dynamic field is
/// absent. Absence means the pool was minted by a pre-Phase-0 package; reading
/// it as `(@0x0, 0)` makes such a pool refuse every fee, which is the
/// fail-closed answer.
fun relayer_policy_or_closed<CoinType>(self: &ShieldedPool<CoinType>): RelayerPolicy {
    let key = RelayerPolicyKey();
    if (df::exists_with_type<RelayerPolicyKey, RelayerPolicy>(&self.id, key))
        *df::borrow<RelayerPolicyKey, RelayerPolicy>(&self.id, key)
    else RelayerPolicy { relayer: @0x0, max_fee: 0 }
}

fun merkle_tree<CoinType>(self: &ShieldedPool<CoinType>): &MerkleTree {
    dof::borrow(&self.id, MerkleTreeKey())
}

fun merkle_tree_mut<CoinType>(self: &mut ShieldedPool<CoinType>): &mut MerkleTree {
    dof::borrow_mut(&mut self.id, MerkleTreeKey())
}

// === Aliases ===

use fun assert_public_value as Proof.assert_public_value;

// === Test-only ===

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

/// Mint a `PoolAdminCap` bound to an ARBITRARY address, so tests can prove that
/// a cap for another pool cannot configure this one.
#[test_only]
public fun test_admin_cap(pool: address, ctx: &mut TxContext): PoolAdminCap {
    PoolAdminCap { id: object::new(ctx), pool }
}

#[test_only]
public fun test_burn_admin_cap(cap: PoolAdminCap) {
    let PoolAdminCap { id, .. } = cap;
    id.delete();
}
