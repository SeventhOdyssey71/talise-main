/// F-1 REGRESSION GUARD — the `relayer_fee` pool drain. THIS FILE MUST STAY.
///
/// ── WHAT THIS WAS ──────────────────────────────────────────────────────────
/// This started life (research pass, 2026-07) as a PROOF OF CONCEPT that
/// PASSED: it drained the entire pool balance. `process_transaction` step 11
/// paid `ext_data.relayer_fee()` out of the pool with no cap and no check that
/// the named relayer was the official one, and on the private leg
/// (`ext_data.value() == 0`) that fee sat OUTSIDE the SNARK's value-conservation
/// equation — `public_value` is `0 mod r` there, so a valid proof of a trivial
/// all-zero transfer authorised an arbitrary payout. Worse, step 7's compliance
/// gate returned EARLY on `value == 0` and the `paused` assertion sat BELOW that
/// return, so `set_paused` could not stop it either. `transact` is `public` on a
/// shared object and the proving key is a public browser asset, so ANY user
/// could do this, repeatedly, for the whole balance.
///
/// ── WHAT IT IS NOW ─────────────────────────────────────────────────────────
/// The same exploit, driven by the same REAL Groth16 proofs against the same
/// package VK, asserted to ABORT (`EInvalidRelayerFee`, 811). If
/// `f1_fee_drain_now_aborts` ever stops being an EXPECTED FAILURE, the drain is
/// BACK — treat that as a live incident, not a flaky test.
///
/// Alongside it: the pause fix, the fee caps, the official-relayer restriction,
/// and the pool-balance conservation invariant, all exercised with real proofs.
///
/// ── THE FIXTURES ───────────────────────────────────────────────────────────
/// Regenerate with (proving key is gitignored — point `--keys-dir` at it):
///   cargo run --release --bin relayer_fee_fixture_proofs -- \
///     --pool <addr from fixture_binding_is_stable> \
///     --root <genesis root from the same test> \
///     --amount 1000000 --withdraw 400000 --keys-dir <dir>
/// `test_scenario` object ids are deterministic, so `POC_POOL` is stable. These
/// fixtures are bound to the CURRENT VK in `constants.move`; when the ceremony
/// replaces that VK they must be regenerated. There is deliberately NO
/// "skip if stale" flag — a stale security regression guard must fail loudly.
#[test_only]
module talise_privacy::poc_relayer_fee_drain_tests;

use std::unit_test::assert_eq;
use sui::{coin::{Self, Coin}, sui::SUI, test_scenario as ts};
use talise_privacy::{
    ext_data,
    proof::{Self, Proof},
    shielded_pool::{Self, Registry, ShieldedPool, PoolAdminCap}
};

const ADMIN: address = @0xA;
const ATTACKER: address = @0xBAD;
/// The pool's ONE official relayer, once `set_relayer_policy` names it.
const RELAYER: address = @0xFEE1;

/// The deterministic `test_scenario` pool address the fixtures are bound to.
/// `fixture_binding_is_stable` below asserts it, so drift fails loudly.
const POC_POOL: address =
    @0xdba72804cc9504a82bbaa13ed4a83a0e2c6219d7e45125cf57fd10cbab957a97;

// ── Fixtures from `relayer_fee_fixture_proofs` (verified vs constants.move VK) ─

const DEPOSIT_AMOUNT: u64 = 1000000;
const WITHDRAW_AMOUNT: u64 = 400000;

/// `MAX_RELAYER_FEE_BPS` (500) of `WITHDRAW_AMOUNT` — the largest fee the
/// IMMUTABLE on-chain ceiling permits on this withdraw. 400000 * 5% == 20000.
const FEE_AT_BPS_CEILING: u64 = 20000;

// ── Leg A: an HONEST deposit of DEPOSIT_AMOUNT, all of it in note0 ───────────
const DEP_PROOF: vector<u8> = x"b837978b7430b22539f499ea9459fe57d210bfe42943ef88993a563e6c1d958269e4042c90f54adad699a221b47613649faff9d06f1fb62bf929c5398dada62fc47b54a1e82490dfb0b26e0cecbd01bca77b54317f56edd8201f18be87dcba803b6683dae163435f24e4b7342c5831b3087eb476ca2f8ec902c0e92972e5822e";
const DEP_ROOT: u256 = 4023688209857926016730691838838984168964497755397275208674494663143007853450;
const DEP_PUBLIC_VALUE: u256 = 1000000;
const DEP_NULL0: u256 = 17333156520141846666866222644343393586050232437369337286631722720240763843420;
const DEP_NULL1: u256 = 16485057900875179165755373714490330689465389741907310266956198679602218163263;
const DEP_COMM0: u256 = 4931868244974834555213277870368249367510634115830134673302860460840155760963;
const DEP_COMM1: u256 = 6051188745319224365727086906589163236544937178905935176468864920167478968608;

// ── Leg B: the F-1 leg — a trivial all-zero-value internal transfer ──────────
// `public_value == 0`, so the SNARK authorises a pool delta of ZERO. Any
// `relayer_fee` on this leg is value created from nothing. Provable by anyone:
// zero-amount inputs skip the Merkle-membership constraint, so no notes needed.
const ATK_PROOF: vector<u8> = x"85dc0cbbfbce20e45fde3d085195c4a0bb3a846dac55ed4237cf0251f1b72a1424b02013657066d57a08d951fb56346024bcae5ea78bf128b4080240279fec29cd63a488466c9dbf6f0afa9b30b0444b3282936f1555eda06aa5cb10647659a7615346a75fff6d04d77d2cffe742fdbffc6716b3d75c4d31a4623ab5e8164ea5";
const ATK_ROOT: u256 = 4023688209857926016730691838838984168964497755397275208674494663143007853450;
/// `ext_data::public_value()` for (value = 0, value_sign = false): the field
/// negative of zero, i.e. the modulus itself, which reduces to 0 mod r.
const ATK_PUBLIC_VALUE: u256 =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
const ATK_NULL0: u256 = 20821790297668030135408275346178275296818290535405771159930335571779456439586;
const ATK_NULL1: u256 = 10741286322832046772003497485395737261726988384479246102562283275285138305380;
const ATK_COMM0: u256 = 2854263029997281889119417103830244896136144656023923255993459294894600744611;
const ATK_COMM1: u256 = 14741635106899376827034333409455580939267357117374676974749603268897629634138;

// ── Leg C: a LEGITIMATE partial withdraw of WITHDRAW_AMOUNT ──────────────────
// Spends leg A's note0 against the POST-DEPOSIT root. NOTE: this one proof is
// valid for EVERY fee value used below, because `ext_data.public_value()` on a
// withdraw is `-value` and never mentions the fee. That is precisely why the fee
// has to be bounded ON-CHAIN — see UPGRADE-PHASE0.md.
const WD_PROOF: vector<u8> = x"8da179ce780be868f5aa5508f5ff5b82d1da51e70c736e92889f6e66adf67d0b443907b1237f9665f8c17a010117183c5bbee89dc5c87c37bcc06ac286b99b2057e3792ae246b49fe4ca1e427b27bac718ac9239b7800d9c0740ca245199091f26936ea1811c0afd74d293554b76a96b75112f957954c0ab17e6e2e51fcad893";
const WD_ROOT: u256 = 18812180791431230073961831570373267978444997219597306621357639903270158805498;
const WD_PUBLIC_VALUE: u256 =
    21888242871839275222246405745257275088548364400416034343698204186575808095617;
const WD_NULL0: u256 = 3490250251433399308791131761988205285506431285267542297343228149373390724429;
const WD_NULL1: u256 = 2334884959869661728578203998316073249521292430500075945065676615237293529265;
const WD_COMM0: u256 = 21583599424896813004730679787985604826386759709039750681933671181925590089288;
const WD_COMM1: u256 = 14494527730112213614956175627352288352870814627200145048075722852817243067824;

// === Helpers ===

/// Create + share the pool with the EXACT object-creation sequence the fixtures
/// were generated against, so `POC_POOL` (and therefore every proof) matches.
fun setup_pool(s: &mut ts::Scenario) {
    ts::next_tx(s, ADMIN);
    shielded_pool::test_init(ts::ctx(s));

    ts::next_tx(s, ADMIN);
    let mut reg = ts::take_shared<Registry>(s);
    let (pool, cap) = shielded_pool::new<SUI>(&mut reg, ts::ctx(s));
    assert_eq!(object::id_address(&pool), POC_POOL);
    shielded_pool::share(pool);
    transfer::public_transfer(cap, ADMIN);
    ts::return_shared(reg);
}

fun dep_proof(): Proof<SUI> {
    proof::new<SUI>(
        POC_POOL,
        DEP_PROOF,
        DEP_ROOT,
        DEP_PUBLIC_VALUE,
        DEP_NULL0,
        DEP_NULL1,
        DEP_COMM0,
        DEP_COMM1,
    )
}

fun atk_proof(): Proof<SUI> {
    proof::new<SUI>(
        POC_POOL,
        ATK_PROOF,
        ATK_ROOT,
        ATK_PUBLIC_VALUE,
        ATK_NULL0,
        ATK_NULL1,
        ATK_COMM0,
        ATK_COMM1,
    )
}

fun wd_proof(): Proof<SUI> {
    proof::new<SUI>(
        POC_POOL,
        WD_PROOF,
        WD_ROOT,
        WD_PUBLIC_VALUE,
        WD_NULL0,
        WD_NULL1,
        WD_COMM0,
        WD_COMM1,
    )
}

/// Leg A: an honest depositor funds the pool with DEPOSIT_AMOUNT (fee 0).
fun fund_pool(s: &mut ts::Scenario) {
    ts::next_tx(s, ADMIN);
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(s);
    let e = ext_data::new(DEPOSIT_AMOUNT, true, @0x0, 0, vector[], vector[]);
    let c = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(s));
    let out = shielded_pool::transact(&mut pool, c, dep_proof(), e, ts::ctx(s));
    assert_eq!(out.value(), 0); // the deposit leg returns a zero coin
    coin::burn_for_testing(out);
    assert_eq!(pool.balance_value(), DEPOSIT_AMOUNT); // Δ == +public_value
    // The post-deposit on-chain root MUST be the one leg C's proof targets —
    // i.e. Move's `append_pair` and the Rust tree agree (Poseidon parity).
    assert_eq!(shielded_pool::root(&pool), WD_ROOT);
    ts::return_shared(pool);
}

/// Name RELAYER as the pool's official relayer with an absolute cap of `max_fee`.
fun set_policy(s: &mut ts::Scenario, max_fee: u64) {
    ts::next_tx(s, ADMIN);
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(s);
    let cap = ts::take_from_sender<PoolAdminCap>(s);
    shielded_pool::set_relayer_policy(&mut pool, &cap, RELAYER, max_fee);
    let (r, m) = shielded_pool::relayer_policy(&pool);
    assert_eq!(r, RELAYER);
    assert_eq!(m, max_fee);
    ts::return_to_sender(s, cap);
    ts::return_shared(pool);
}

/// Submit leg C (the withdraw) as `sender`, naming `relayer` and paying `fee`.
/// Returns the pool balance afterwards; burns the recipient coin.
fun submit_withdraw(
    s: &mut ts::Scenario,
    sender: address,
    relayer: address,
    fee: u64,
): u64 {
    ts::next_tx(s, sender);
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(s);
    let e = ext_data::new(WITHDRAW_AMOUNT, false, relayer, fee, vector[], vector[]);
    let c = coin::zero<SUI>(ts::ctx(s));
    let out = shielded_pool::transact(&mut pool, c, wd_proof(), e, ts::ctx(s));
    assert_eq!(out.value(), WITHDRAW_AMOUNT - fee);
    coin::burn_for_testing(out);
    let balance = pool.balance_value();
    ts::return_shared(pool);
    balance
}

fun pause(s: &mut ts::Scenario) {
    ts::next_tx(s, ADMIN);
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(s);
    let cap = ts::take_from_sender<PoolAdminCap>(s);
    shielded_pool::set_paused(&mut pool, &cap, true);
    assert_eq!(shielded_pool::is_paused(&pool), true);
    ts::return_to_sender(s, cap);
    ts::return_shared(pool);
}

// === Fixture binding ===

/// The two values every proof below is bound to: the deterministic
/// `test_scenario` pool address (public input [0]) and the genesis Merkle root
/// (public input [1]). If either drifts — a change to object-id derivation, or
/// to `empty_subtree_hashes` — every fixture in this file is invalid, and this
/// test says so directly instead of letting the proofs fail with a confusing
/// `EInvalidProof`.
///
/// To RE-DERIVE the values for `relayer_fee_fixture_proofs`, temporarily add
/// `std::debug::print(&object::id_address(&pool));` /
/// `std::debug::print(&shielded_pool::root(&pool));` here and run this one test.
#[test]
fun fixture_binding_is_stable() {
    let mut s = ts::begin(ADMIN);
    ts::next_tx(&mut s, ADMIN);
    shielded_pool::test_init(ts::ctx(&mut s));

    ts::next_tx(&mut s, ADMIN);
    let mut reg = ts::take_shared<Registry>(&s);
    let (pool, cap) = shielded_pool::new<SUI>(&mut reg, ts::ctx(&mut s));

    assert_eq!(object::id_address(&pool), POC_POOL);
    assert_eq!(shielded_pool::root(&pool), DEP_ROOT); // == the genesis root
    assert_eq!(DEP_ROOT, ATK_ROOT);

    shielded_pool::share(pool);
    transfer::public_transfer(cap, ADMIN);
    ts::return_shared(reg);
    ts::end(s);
}

// === F-1: the drain must ABORT ===

/// THE REGRESSION GUARD. This is the original PoC, unchanged in substance: a
/// funded pool, then ATTACKER submits a valid all-zero-value transfer naming
/// ITSELF as relayer with `relayer_fee == the entire pool balance`.
///
/// It used to PASS — the pool ended at 0 and the attacker held the funds. It
/// must now ABORT with `EInvalidRelayerFee` at step 3b, because a fee is only
/// payable on a leg whose cleartext value the proof actually commits to.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun f1_fee_drain_now_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);

    ts::next_tx(&mut s, ATTACKER);
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(&s);
    let stolen = pool.balance_value();
    assert_eq!(stolen, DEPOSIT_AMOUNT);

    let e = ext_data::new(
        0, // value == 0 → the private leg the drain rode on
        false,
        ATTACKER, // relayer == submitter == the attacker
        stolen, // relayer_fee == the ENTIRE pool balance
        vector[],
        vector[],
    );
    let c = coin::zero<SUI>(ts::ctx(&mut s));
    let out = shielded_pool::transact(&mut pool, c, atk_proof(), e, ts::ctx(&mut s));

    // Unreachable. Kept so the test compiles and so a future reader can see
    // exactly what the drain used to achieve.
    coin::burn_for_testing(out);
    ts::return_shared(pool);
    ts::end(s);
}

/// Even the OFFICIAL relayer, with a generous cap, cannot take a fee on the
/// private leg: there is no proof-committed value for it to come out of.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun official_relayer_fee_on_private_leg_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, DEPOSIT_AMOUNT);

    ts::next_tx(&mut s, RELAYER);
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(&s);
    let e = ext_data::new(0, false, RELAYER, 1, vector[], vector[]);
    let c = coin::zero<SUI>(ts::ctx(&mut s));
    let out = shielded_pool::transact(&mut pool, c, atk_proof(), e, ts::ctx(&mut s));
    coin::burn_for_testing(out);
    ts::return_shared(pool);
    ts::end(s);
}

/// The private leg is NOT broken by the fix: with `relayer_fee == 0` a real
/// zero-value internal transfer still succeeds, and the pool balance is
/// untouched (conservation on the private leg: Δ == 0 == public_value).
#[test]
fun private_transfer_with_zero_fee_still_works() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);

    ts::next_tx(&mut s, ATTACKER); // any sender: this leg is permissionless
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(&s);
    let before = pool.balance_value();
    let e = ext_data::new(0, false, @0x0, 0, vector[], vector[]);
    let c = coin::zero<SUI>(ts::ctx(&mut s));
    let out = shielded_pool::transact(&mut pool, c, atk_proof(), e, ts::ctx(&mut s));
    assert_eq!(out.value(), 0);
    coin::burn_for_testing(out);
    assert_eq!(pool.balance_value(), before); // Δbalance == 0
    assert_eq!(pool.is_nullifier_spent(ATK_NULL0), true);
    assert_eq!(pool.next_index(), 4); // leg A's pair + this pair
    ts::return_shared(pool);
    ts::end(s);
}

// === The pause fix: the kill switch now covers the private leg ===

/// NEW BEHAVIOUR (Phase 0). `paused` used to be asserted BELOW the
/// `value == 0` early return, so a paused pool happily processed internal
/// transfers — the very leg F-1 rode on, which made the kill switch useless
/// against the drain. A paused pool must now refuse a zero-value transfer.
#[test, expected_failure(abort_code = shielded_pool::EComplianceRefused)]
fun paused_pool_rejects_zero_value_internal_transfer() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    pause(&mut s);

    ts::next_tx(&mut s, ATTACKER);
    let mut pool = ts::take_shared<ShieldedPool<SUI>>(&s);
    // fee 0 — so this is refused by the PAUSE, not by the fee policy.
    let e = ext_data::new(0, false, @0x0, 0, vector[], vector[]);
    let c = coin::zero<SUI>(ts::ctx(&mut s));
    let out = shielded_pool::transact(&mut pool, c, atk_proof(), e, ts::ctx(&mut s));
    coin::burn_for_testing(out);
    ts::return_shared(pool);
    ts::end(s);
}

/// The public legs were already covered by the kill switch; keep it asserted so
/// the reorder cannot silently drop them.
#[test, expected_failure(abort_code = shielded_pool::EComplianceRefused)]
fun paused_pool_rejects_withdraw() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    pause(&mut s);
    submit_withdraw(&mut s, ATTACKER, @0x0, 0);
    ts::end(s);
}

// === The fee caps, exercised with the SAME valid withdraw proof ===

/// A fee EXACTLY at the immutable bps ceiling (and exactly at the admin cap) is
/// ALLOWED, and every party gets exactly the right amount:
///   pool     : 1_000_000 → 600_000  (Δ == -WITHDRAW_AMOUNT == public_value)
///   relayer  : +20_000              (the fee, carved OUT of the withdrawn value)
///   recipient: +380_000             (value - fee, returned into the PTB)
#[test]
fun legit_fee_bearing_withdraw_still_works() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, FEE_AT_BPS_CEILING);

    let after = submit_withdraw(&mut s, RELAYER, RELAYER, FEE_AT_BPS_CEILING);
    assert_eq!(after, DEPOSIT_AMOUNT - WITHDRAW_AMOUNT);

    ts::next_tx(&mut s, RELAYER);
    let paid = ts::take_from_sender<Coin<SUI>>(&s);
    assert_eq!(paid.value(), FEE_AT_BPS_CEILING);
    ts::return_to_sender(&s, paid);
    ts::end(s);
}

/// One unit over the IMMUTABLE bps ceiling aborts, even though the operator's
/// absolute cap is wide open and the relayer is the official one. Note the proof
/// is byte-identical to the one that just succeeded — only the fee changed.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun fee_one_over_bps_ceiling_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, DEPOSIT_AMOUNT); // absolute cap deliberately generous
    submit_withdraw(&mut s, RELAYER, RELAYER, FEE_AT_BPS_CEILING + 1);
    ts::end(s);
}

/// A fee exactly at the OPERATOR's absolute cap (well under the bps ceiling) is
/// allowed.
#[test]
fun fee_exactly_at_admin_cap_is_allowed() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, 5000);
    let after = submit_withdraw(&mut s, RELAYER, RELAYER, 5000);
    assert_eq!(after, DEPOSIT_AMOUNT - WITHDRAW_AMOUNT);
    ts::end(s);
}

/// One unit over the operator's absolute cap aborts. 5001 is far below the bps
/// ceiling (20000), so this isolates the `max_fee` check.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun fee_one_over_admin_cap_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, 5000);
    submit_withdraw(&mut s, RELAYER, RELAYER, 5001);
    ts::end(s);
}

/// An UNOFFICIAL relayer cannot charge a fee, even a tiny one, even with a valid
/// proof and even though it is the legitimate submitter of its own PTB.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun fee_to_unofficial_relayer_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, FEE_AT_BPS_CEILING); // the official relayer is RELAYER
    submit_withdraw(&mut s, ATTACKER, ATTACKER, 1000);
    ts::end(s);
}

/// A self-submitted withdraw (`relayer == @0x0`, no relayer at all) cannot pay a
/// fee: `@0x0` is never the official relayer.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun fee_with_no_named_relayer_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, FEE_AT_BPS_CEILING);
    submit_withdraw(&mut s, ATTACKER, @0x0, 1000);
    ts::end(s);
}

/// FAIL-CLOSED DEFAULT: a fresh pool has no relayer policy, so no fee is payable
/// at all until the operator explicitly opens one.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun fee_before_any_policy_is_set_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    // NO set_policy call.
    submit_withdraw(&mut s, RELAYER, RELAYER, 1);
    ts::end(s);
}

/// A closed policy (`max_fee == 0`) refuses fees even for the named relayer —
/// the operator's own off switch for the relayed path.
#[test, expected_failure(abort_code = shielded_pool::EInvalidRelayerFee)]
fun fee_with_zero_admin_cap_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    set_policy(&mut s, 0);
    submit_withdraw(&mut s, RELAYER, RELAYER, 1);
    ts::end(s);
}

/// A withdraw with NO fee needs no policy and no relayer, and still conserves.
#[test]
fun zero_fee_withdraw_needs_no_policy() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);
    fund_pool(&mut s);
    let after = submit_withdraw(&mut s, ATTACKER, @0x0, 0);
    assert_eq!(after, DEPOSIT_AMOUNT - WITHDRAW_AMOUNT);
    ts::end(s);
}

// === The conservation invariant, across all three legs ===

/// THE INVARIANT UNDER TEST: on every leg, the change in the pool's balance
/// equals EXACTLY the signed public value the proof committed to (step 4 ties
/// `ext_data.public_value()` to `proof.public_value()`):
///
///   deposit          : Δ == +DEPOSIT_AMOUNT   (fee 0 ⇒ public_value == +amount)
///   internal transfer: Δ ==  0                (public_value == 0 mod r)
///   withdraw + fee   : Δ == -WITHDRAW_AMOUNT  (public_value == -value; the fee
///                                              is carved out of `value`, so it
///                                              does NOT widen the outflow)
///
/// F-1 was this equation being off by exactly `relayer_fee` on the middle leg.
/// `shielded_pool` now asserts it in-line at step 12; this test asserts it from
/// the outside, with real proofs, and checks where every unit went.
#[test]
fun conservation_holds_across_deposit_transfer_and_withdraw() {
    let mut s = ts::begin(ADMIN);
    setup_pool(&mut s);

    // ── Leg 1: deposit ───────────────────────────────────────────────────────
    fund_pool(&mut s); // asserts Δ == +DEPOSIT_AMOUNT
    let mut expected = DEPOSIT_AMOUNT;

    // ── Leg 2: private internal transfer, fee 0 ──────────────────────────────
    ts::next_tx(&mut s, ATTACKER);
    {
        let mut pool = ts::take_shared<ShieldedPool<SUI>>(&s);
        let before = pool.balance_value();
        assert_eq!(before, expected);
        let e = ext_data::new(0, false, @0x0, 0, vector[], vector[]);
        let c = coin::zero<SUI>(ts::ctx(&mut s));
        let out = shielded_pool::transact(&mut pool, c, atk_proof(), e, ts::ctx(&mut s));
        coin::burn_for_testing(out);
        assert_eq!(pool.balance_value(), before); // Δ == 0
        ts::return_shared(pool);
    };

    // ── Leg 3: withdraw WITH a fee, at the bps ceiling ───────────────────────
    set_policy(&mut s, FEE_AT_BPS_CEILING);
    let after = submit_withdraw(&mut s, RELAYER, RELAYER, FEE_AT_BPS_CEILING);
    expected = expected - WITHDRAW_AMOUNT; // Δ == -value, NOT -(value + fee)
    assert_eq!(after, expected);

    // Every unit accounted for: pool 600_000 + relayer 20_000 + recipient
    // 380_000 == the 1_000_000 deposited. Nothing minted, nothing burned.
    ts::next_tx(&mut s, RELAYER);
    let paid = ts::take_from_sender<Coin<SUI>>(&s);
    assert_eq!(
        after + paid.value() + (WITHDRAW_AMOUNT - FEE_AT_BPS_CEILING),
        DEPOSIT_AMOUNT,
    );
    ts::return_to_sender(&s, paid);
    ts::end(s);
}
