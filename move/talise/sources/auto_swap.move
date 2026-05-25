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
/// Audit notes (v2, post-review):
///   • Cap minting moved to `talise::vault::enable_auto_swap`, which has
///     `&TaliseVault` in scope and asserts `vault.owner == ctx.sender()`.
///     Closes the "mint a cap pointing at someone else's vault" hole.
///   • `validate_for_swap` is now `public(package)` and derives `sender`
///     from `&TxContext` internally — callers can't spoof it.
///   • Hot-potato: `auto_swap_extract` returns a no-ability `SwapTicket`
///     alongside the extracted balance (defined in `talise::vault`).
///     `auto_swap_deposit` is the only consumer; the PTB will not
///     type-check unless deposit runs in the same tx.
///   • `disable`/`pause`/`resume`/`update_bounds` now assert
///     `ctx.sender() == cap.owner` — the cap is transferable (`store`),
///     but only the original owner can mutate its state.
module talise::auto_swap;

use sui::event;

// ───────────────────────────────────────────────────────────────────
// Errors

const E_CAP_PAUSED: u64 = 100;
const E_CAP_EXPIRED: u64 = 101;
const E_AMOUNT_EXCEEDS_CAP: u64 = 102;
const E_WRONG_ADMIN: u64 = 103;
const E_INVALID_MAX: u64 = 104;
const E_NOT_OWNER: u64 = 106;

// ───────────────────────────────────────────────────────────────────
// Objects

/// Singleton shared object created at publish time. Holds the global
/// admin address allowed to execute auto-swaps. Future governance can
/// add admin-rotation; for v1 the address is set at init and immutable
/// (rotation requires a `AdminCap`-gated path which we leave for v2).
public struct AutoSwapRegistry has key {
    id: UID,
    /// Address that may execute auto-swaps. Compared to `tx_context::sender()`
    /// inside `validate_for_swap`. This is the Onara-side worker address.
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
    /// Hardwired at mint time by `vault::enable_auto_swap`, which
    /// asserts the minter owns the vault. A leaked cap cannot be
    /// re-targeted, and the original mint cannot point at someone
    /// else's vault.
    vault_id: ID,
    /// The address that minted this cap. The cap has `store` so it can
    /// be transferred — but mutate-/burn-ops in this module check
    /// `ctx.sender() == cap.owner` so a transferred cap is "read-only"
    /// to the new holder.
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
// Cap construction — package-private, only `talise::vault` calls this
// (after it has asserted vault.owner == ctx.sender()).

/// Mint an `AutoSwapCap<T>` for `owner`, bound to `vault_id`. The
/// vault-ownership check is the caller's responsibility — that's the
/// reason this is `public(package)` and `vault::enable_auto_swap` is
/// the only call site.
public(package) fun mint_cap<T>(
    vault_id: ID,
    owner: address,
    max_per_swap: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
): AutoSwapCap<T> {
    assert!(max_per_swap > 0, E_INVALID_MAX);

    let cap = AutoSwapCap<T> {
        id: object::new(ctx),
        vault_id,
        owner,
        max_per_swap,
        expires_at_ms,
        paused: false,
    };

    event::emit(AutoSwapEnabled {
        owner,
        vault_id,
        cap_id: object::id(&cap),
        coin_type: std::type_name::with_defining_ids<T>().into_string().into_bytes(),
        max_per_swap,
        expires_at_ms,
    });

    cap
}

// ───────────────────────────────────────────────────────────────────
// User-facing entry points (the consent surface)

/// Permanently disable auto-swap for `T`. Burns the cap.
/// Caller must be `cap.owner`.
public entry fun disable<T>(cap: AutoSwapCap<T>, ctx: &TxContext) {
    assert!(ctx.sender() == cap.owner, E_NOT_OWNER);
    let AutoSwapCap { id, vault_id: _, owner, max_per_swap: _, expires_at_ms: _, paused: _ } = cap;
    event::emit(AutoSwapDisabled {
        owner,
        cap_id: id.to_inner(),
        coin_type: std::type_name::with_defining_ids<T>().into_string().into_bytes(),
    });
    id.delete();
}

/// Temporarily pause auto-swap (worker validation fails until resumed).
/// Caller must be `cap.owner`.
public entry fun pause<T>(cap: &mut AutoSwapCap<T>, ctx: &TxContext) {
    assert!(ctx.sender() == cap.owner, E_NOT_OWNER);
    cap.paused = true;
    event::emit(AutoSwapPaused {
        owner: cap.owner,
        cap_id: object::id(cap),
        paused: true,
    });
}

/// Resume after a pause. Caller must be `cap.owner`.
public entry fun resume<T>(cap: &mut AutoSwapCap<T>, ctx: &TxContext) {
    assert!(ctx.sender() == cap.owner, E_NOT_OWNER);
    cap.paused = false;
    event::emit(AutoSwapPaused {
        owner: cap.owner,
        cap_id: object::id(cap),
        paused: false,
    });
}

/// Update bounds without re-minting. Caller must be `cap.owner`.
/// Note: v1 lets the owner raise limits freely. v2 should clamp
/// to `original_max` (see AUTOSWAP.md hardening list).
public entry fun update_bounds<T>(
    cap: &mut AutoSwapCap<T>,
    max_per_swap: u64,
    expires_at_ms: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == cap.owner, E_NOT_OWNER);
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
/// `public(package)` so off-chain callers can't bump the counter
/// without going through `vault::auto_swap_extract`. Sender derived
/// from `&TxContext` — caller cannot spoof.
public(package) fun validate_for_swap<T>(
    registry: &mut AutoSwapRegistry,
    cap: &AutoSwapCap<T>,
    amount: u64,
    now_ms: u64,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
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

#[test_only]
public fun test_validate_for_swap<T>(
    registry: &mut AutoSwapRegistry,
    cap: &AutoSwapCap<T>,
    amount: u64,
    now_ms: u64,
    ctx: &TxContext,
) {
    validate_for_swap<T>(registry, cap, amount, now_ms, ctx)
}
