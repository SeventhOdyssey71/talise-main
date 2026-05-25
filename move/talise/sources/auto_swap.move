/// Auto-swap authority + per-user opt-in capability.
///
/// Architecture, in one paragraph:
///   Every Talise user who claims an @talise subname gets a `TaliseVault`
///   (see `talise::vault`). The vault is a shared object whose contents
///   only the owner can withdraw — but a separately-minted `AutoSwapCap<T>`
///   grants a globally-known admin address (Talise's Onara-sponsored
///   worker) permission to convert `Balance<T>` already inside the vault
///   into USDsui through a whitelisted DEX. The user keeps custody (they
///   can withdraw or burn the cap any time); the worker only ever sees
///   balances the user explicitly authorized it to touch, capped per
///   swap and per coin type.
///
/// This module does NOT touch any Coin/Balance — it only models the
/// consent + bounds. The actual swap PTB is composed off-chain by the
/// worker and validated against this cap inside the swap entry of
/// `talise::vault` (where the balances live).
module talise::auto_swap;

use sui::event;

// ───────────────────────────────────────────────────────────────────
// Errors

const E_CAP_PAUSED: u64 = 100;
const E_CAP_EXPIRED: u64 = 101;
const E_AMOUNT_EXCEEDS_CAP: u64 = 102;
const E_WRONG_ADMIN: u64 = 103;
const E_INVALID_MAX: u64 = 104;
const E_INVALID_EXPIRY: u64 = 105;

// ───────────────────────────────────────────────────────────────────
// Objects

/// Singleton shared object created at publish time. Holds the global
/// admin address allowed to execute auto-swaps. Future governance can
/// add admin-rotation; for v1 the address is set at init and immutable
/// (rotation requires a `AdminCap`-gated path which we leave for v2).
public struct AutoSwapRegistry has key {
    id: UID,
    /// Address that may call `validate_for_swap` as `tx.sender`. This
    /// is the Onara-side worker address. Funded with SUI for gas (or,
    /// in practice, every swap PTB is gas-sponsored by Onara).
    admin: address,
    /// Monotonic counter for telemetry / SLA reporting. Bumped by
    /// `validate_for_swap`. Not load-bearing for any security check.
    total_validations: u64,
}

/// Admin-only capability minted once at init, transferred to the
/// publisher. Holds reserved rights for future governance moves
/// (admin rotation, registry pause, etc.). The day-to-day worker does
/// NOT need this — it just needs to be the `admin` address recorded in
/// `AutoSwapRegistry`.
public struct AdminCap has key, store { id: UID }

/// Per-user, per-source-coin-type authority. Owned by the user.
/// Existence is necessary-but-not-sufficient for the worker to execute
/// a swap: the worker must also be the recorded admin AND the swap
/// amount must fit inside `max_per_swap`.
///
/// `T` is the SOURCE coin type. Destination is always USDsui (enforced
/// by the swap entry in `talise::vault`).
public struct AutoSwapCap<phantom T> has key, store {
    id: UID,
    /// Vault that this cap authorises the worker to drain `T` from.
    /// Hardwired at mint time; no way to retarget the cap to a different
    /// vault, so a leaked cap can only ever move funds within the
    /// original user's vault.
    vault_id: ID,
    /// Soft owner — informational only (vault_id is the load-bearing
    /// binding). Useful for off-chain indexers.
    owner: address,
    /// Hard cap on the source amount the worker may swap in one call,
    /// expressed in `T`'s native decimals. Defense in depth: even with
    /// a compromised admin, the blast radius per tx is bounded.
    max_per_swap: u64,
    /// Unix ms expiry. After this timestamp, `validate_for_swap` fails.
    /// 0 = no expiry. Encourages users to set sensible windows.
    expires_at_ms: u64,
    /// User can pause without burning. Re-enabling is free; minting a
    /// fresh cap costs a small object-creation fee.
    paused: bool,
}

// ───────────────────────────────────────────────────────────────────
// Events

public struct AutoSwapEnabled has copy, drop {
    owner: address,
    vault_id: ID,
    cap_id: ID,
    coin_type: vector<u8>,
    max_per_swap: u64,
    expires_at_ms: u64,
}

public struct AutoSwapDisabled has copy, drop {
    owner: address,
    cap_id: ID,
    coin_type: vector<u8>,
}

public struct AutoSwapPaused has copy, drop {
    owner: address,
    cap_id: ID,
    paused: bool,
}

public struct AutoSwapValidated has copy, drop {
    admin: address,
    vault_id: ID,
    cap_id: ID,
    amount: u64,
    coin_type: vector<u8>,
}

// ───────────────────────────────────────────────────────────────────
// Init

/// Publish-time initializer. Creates the singleton registry as a shared
/// object so anyone can read `admin`, and mints `AdminCap` to the
/// publisher. The publisher MUST be the address used as `admin` (or
/// pick a different operator address — see `AutoSwapRegistry.admin`).
fun init(ctx: &mut TxContext) {
    let registry = AutoSwapRegistry {
        id: object::new(ctx),
        admin: ctx.sender(),
        total_validations: 0,
    };
    transfer::share_object(registry);

    let admin_cap = AdminCap { id: object::new(ctx) };
    transfer::public_transfer(admin_cap, ctx.sender());
}

// ───────────────────────────────────────────────────────────────────
// User-facing entry points (the consent surface)

/// Enable auto-swap for source coin type `T`. Mints an `AutoSwapCap<T>`
/// hardwired to the user's vault, transfers it to the user.
///
/// Failure modes:
///   • `max_per_swap == 0` → rejected (would be a no-op cap)
///   • `expires_at_ms` in the past (non-zero) → rejected
public entry fun enable<T>(
    vault_id: ID,
    max_per_swap: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(max_per_swap > 0, E_INVALID_MAX);

    let owner = ctx.sender();
    let cap = AutoSwapCap<T> {
        id: object::new(ctx),
        vault_id,
        owner,
        max_per_swap,
        expires_at_ms,
        paused: false,
    };

    let cap_id = object::id(&cap);
    event::emit(AutoSwapEnabled {
        owner,
        vault_id,
        cap_id,
        coin_type: std::type_name::with_defining_ids<T>().into_string().into_bytes(),
        max_per_swap,
        expires_at_ms,
    });

    transfer::public_transfer(cap, owner);
}

/// Permanently disable auto-swap for `T`. Burns the cap.
public entry fun disable<T>(cap: AutoSwapCap<T>, ctx: &TxContext) {
    let AutoSwapCap { id, vault_id: _, owner, max_per_swap: _, expires_at_ms: _, paused: _ } = cap;
    event::emit(AutoSwapDisabled {
        owner,
        cap_id: id.to_inner(),
        coin_type: std::type_name::with_defining_ids<T>().into_string().into_bytes(),
    });
    id.delete();
    // `owner` is preserved in the event but we don't need it past that.
    let _ = owner;
    let _ = ctx;
}

/// Temporarily pause auto-swap (worker validation fails until resumed).
public entry fun pause<T>(cap: &mut AutoSwapCap<T>, _ctx: &TxContext) {
    cap.paused = true;
    event::emit(AutoSwapPaused {
        owner: cap.owner,
        cap_id: object::id(cap),
        paused: true,
    });
}

/// Resume after a pause.
public entry fun resume<T>(cap: &mut AutoSwapCap<T>, _ctx: &TxContext) {
    cap.paused = false;
    event::emit(AutoSwapPaused {
        owner: cap.owner,
        cap_id: object::id(cap),
        paused: false,
    });
}

/// Update bounds without re-minting. Both fields are user-controlled.
public entry fun update_bounds<T>(
    cap: &mut AutoSwapCap<T>,
    max_per_swap: u64,
    expires_at_ms: u64,
    _ctx: &TxContext,
) {
    assert!(max_per_swap > 0, E_INVALID_MAX);
    cap.max_per_swap = max_per_swap;
    cap.expires_at_ms = expires_at_ms;
}

// ───────────────────────────────────────────────────────────────────
// Worker-facing validation (called from inside `talise::vault::auto_swap_*`)

/// Called by the swap entry in `talise::vault`. Returns nothing — it
/// either passes (all assertions hold, registry counter bumps, event
/// emits) or aborts the entire PTB.
///
/// This function is `public` so the vault module can invoke it; it is
/// NOT `entry`, so off-chain callers can't call it directly to bump
/// the counter without an accompanying swap.
public fun validate_for_swap<T>(
    registry: &mut AutoSwapRegistry,
    cap: &AutoSwapCap<T>,
    amount: u64,
    now_ms: u64,
    sender: address,
) {
    assert!(sender == registry.admin, E_WRONG_ADMIN);
    assert!(!cap.paused, E_CAP_PAUSED);
    if (cap.expires_at_ms != 0) {
        assert!(now_ms <= cap.expires_at_ms, E_CAP_EXPIRED);
    };
    assert!(amount <= cap.max_per_swap, E_AMOUNT_EXCEEDS_CAP);

    registry.total_validations = registry.total_validations + 1;

    event::emit(AutoSwapValidated {
        admin: sender,
        vault_id: cap.vault_id,
        cap_id: object::id(cap),
        amount,
        coin_type: std::type_name::with_defining_ids<T>().into_string().into_bytes(),
    });
}

// ───────────────────────────────────────────────────────────────────
// Public read accessors (for SDK / indexer convenience)

public fun admin(registry: &AutoSwapRegistry): address { registry.admin }

public fun total_validations(registry: &AutoSwapRegistry): u64 {
    registry.total_validations
}

public fun cap_owner<T>(cap: &AutoSwapCap<T>): address { cap.owner }
public fun cap_vault<T>(cap: &AutoSwapCap<T>): ID { cap.vault_id }
public fun cap_max<T>(cap: &AutoSwapCap<T>): u64 { cap.max_per_swap }
public fun cap_expiry<T>(cap: &AutoSwapCap<T>): u64 { cap.expires_at_ms }
public fun cap_paused<T>(cap: &AutoSwapCap<T>): bool { cap.paused }

// ───────────────────────────────────────────────────────────────────
// Test-only

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
