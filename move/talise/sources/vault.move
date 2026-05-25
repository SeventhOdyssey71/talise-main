/// Per-user TaliseVault.
///
/// A `TaliseVault` is a shared object that holds the user's balances as
/// `Balance<T>` rather than `Coin<T>` objects. It is the destination
/// that a user's `@talise` SuiNS subname resolves to, so any incoming
/// coin lands inside the vault rather than as a free-floating Coin<T>
/// in the user's plain wallet. That's the architectural pivot that
/// makes Path-C auto-swap work: balances inside a shared object can be
/// touched by a worker-signed PTB, gated by an `AutoSwapCap<T>`.
///
/// Custody invariants (after v2 audit pass):
///   • Only `vault.owner` can withdraw. Period.
///   • Only `vault.owner` can mint an `AutoSwapCap<T>` against this
///     vault (asserted in `enable_auto_swap`).
///   • `auto_swap_extract` returns a `SwapTicket` hot potato in
///     addition to the source balance. `auto_swap_deposit` is the
///     only function that consumes it — the PTB cannot type-check
///     unless the extracted balance is deposited back atomically.
///   • The ticket carries the source vault id; deposit asserts the
///     swap output lands in the same vault, so funds can't be
///     siphoned to another vault inside the same PTB.
module talise::vault;

use sui::bag::{Self, Bag};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use std::type_name;
use std::string::String;

use talise::auto_swap::{Self, AutoSwapRegistry, AutoSwapCap};

// ───────────────────────────────────────────────────────────────────
// Errors

const E_NOT_OWNER: u64 = 200;
const E_INSUFFICIENT_BALANCE: u64 = 201;
const E_ZERO_AMOUNT: u64 = 202;
const E_TYPE_NOT_HELD: u64 = 203;
const E_WRONG_VAULT: u64 = 204;

// ───────────────────────────────────────────────────────────────────
// Objects

/// One vault per user. Shared. The user's @talise subname target is
/// set to this object's address.
public struct TaliseVault has key {
    id: UID,
    /// The only address that can withdraw or mint auto-swap caps.
    owner: address,
    /// Map of type-name (vector<u8>) -> Balance<T>. We use a Bag because
    /// we need heterogeneous Balance<T> in one object; sui::table can't
    /// hold mixed-type values.
    balances: Bag,
    /// Monotonic counters for telemetry / activity feed.
    deposits_total: u64,
    auto_swaps_total: u64,
}

/// Hot-potato. Returned by `auto_swap_extract` and consumed by
/// `auto_swap_deposit`. No `drop`, no `store`, no `copy`, no `key` —
/// the only thing the runtime can do with this is hand it to deposit
/// before the transaction ends. Forces the worker to actually deposit
/// the swap output rather than walking away with the source balance.
public struct SwapTicket {
    /// The vault the ticket was issued against. Deposit asserts the
    /// vault it's depositing into is the same one.
    vault_id: ID,
    /// Source-type name captured at extract time, threaded through to
    /// the deposit event so the indexer can show "Auto-swapped 0.5
    /// SUI → 1.20 USDsui" without an extra RPC.
    from_type: vector<u8>,
    /// Source amount that was extracted (in source-coin decimals).
    from_amount: u64,
}

// ───────────────────────────────────────────────────────────────────
// Events

public struct VaultCreated has copy, drop {
    vault_id: ID,
    owner: address,
}

public struct VaultDeposit has copy, drop {
    vault_id: ID,
    coin_type: vector<u8>,
    amount: u64,
    from: address,
}

public struct VaultWithdraw has copy, drop {
    vault_id: ID,
    coin_type: vector<u8>,
    amount: u64,
    to: address,
}

public struct VaultAutoSwap has copy, drop {
    vault_id: ID,
    from_type: vector<u8>,
    to_type: vector<u8>,
    from_amount: u64,
    to_amount: u64,
    ts_ms: u64,
}

// ───────────────────────────────────────────────────────────────────
// Vault lifecycle

/// Create a new vault for the calling user. One call per user, post-
/// onboarding. Shared so anyone can `deposit_*`, but only the owner
/// can withdraw or mint auto-swap caps.
public entry fun create(ctx: &mut TxContext) {
    let vault = TaliseVault {
        id: object::new(ctx),
        owner: ctx.sender(),
        balances: bag::new(ctx),
        deposits_total: 0,
        auto_swaps_total: 0,
    };
    event::emit(VaultCreated {
        vault_id: object::id(&vault),
        owner: ctx.sender(),
    });
    transfer::share_object(vault);
}

// ───────────────────────────────────────────────────────────────────
// Auto-swap enablement — vault-aware so we can assert ownership

/// Mint an `AutoSwapCap<T>` bound to this vault. The vault-owner check
/// happens here, with `&TaliseVault` in scope, which closes the audit-
/// flagged hole where a user could mint a cap targeting someone else's
/// vault id.
public entry fun enable_auto_swap<T>(
    vault: &TaliseVault,
    max_per_swap: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == vault.owner, E_NOT_OWNER);

    let cap = auto_swap::mint_cap<T>(
        object::id(vault),
        vault.owner,
        max_per_swap,
        expires_at_ms,
        ctx,
    );

    transfer::public_transfer(cap, vault.owner);
}

// ───────────────────────────────────────────────────────────────────
// Deposits — anyone can call

/// Deposit a `Coin<T>` into the vault. Anyone can call this — the
/// vault is "your destination address." We accept Coin (not Balance)
/// so the SDK can call `coin::split` upstream.
public entry fun deposit<T>(
    vault: &mut TaliseVault,
    coin: Coin<T>,
    ctx: &TxContext,
) {
    let amount = coin::value(&coin);
    assert!(amount > 0, E_ZERO_AMOUNT);
    let balance = coin::into_balance(coin);
    deposit_balance(vault, balance, ctx.sender());
}

/// Lower-level helper used by both `deposit` and the swap entry to
/// re-deposit the swap output. Not entry — internal/composable only.
public(package) fun deposit_balance<T>(
    vault: &mut TaliseVault,
    balance: Balance<T>,
    from: address,
) {
    let amount = balance::value(&balance);
    if (amount == 0) {
        balance::destroy_zero(balance);
        return
    };
    let key = type_name::with_defining_ids<T>().into_string().into_bytes();
    if (vault.balances.contains(key)) {
        let held: &mut Balance<T> = vault.balances.borrow_mut(key);
        balance::join(held, balance);
    } else {
        vault.balances.add(key, balance);
    };
    vault.deposits_total = vault.deposits_total + 1;
    event::emit(VaultDeposit {
        vault_id: object::id(vault),
        coin_type: key,
        amount,
        from,
    });
}

// ───────────────────────────────────────────────────────────────────
// Withdrawals — owner only

/// Withdraw a specific amount of `T` to the caller. Caller must be
/// `vault.owner`. Returns a `Coin<T>` for downstream PTB composition.
public fun withdraw<T>(
    vault: &mut TaliseVault,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(ctx.sender() == vault.owner, E_NOT_OWNER);
    assert!(amount > 0, E_ZERO_AMOUNT);
    let key = type_name::with_defining_ids<T>().into_string().into_bytes();
    assert!(vault.balances.contains(key), E_TYPE_NOT_HELD);

    let held: &mut Balance<T> = vault.balances.borrow_mut(key);
    assert!(balance::value(held) >= amount, E_INSUFFICIENT_BALANCE);
    let out = balance::split(held, amount);

    if (balance::value(held) == 0) {
        let empty: Balance<T> = vault.balances.remove(key);
        balance::destroy_zero(empty);
    };

    event::emit(VaultWithdraw {
        vault_id: object::id(vault),
        coin_type: key,
        amount,
        to: ctx.sender(),
    });

    coin::from_balance(out, ctx)
}

/// Convenience: withdraw + transfer in one entry call.
public entry fun withdraw_and_send<T>(
    vault: &mut TaliseVault,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let coin = withdraw<T>(vault, amount, ctx);
    transfer::public_transfer(coin, recipient);
}

// ───────────────────────────────────────────────────────────────────
// Auto-swap: worker-signed source-balance extraction (with hot potato)

/// Worker calls this to extract a `Balance<Source>` for swapping.
/// Returns the balance AND a `SwapTicket` hot potato that MUST be
/// consumed by `auto_swap_deposit` later in the same PTB. The ticket
/// has no abilities, so the PTB will not type-check if the worker
/// tries to walk away with the source balance.
///
/// Validates inside `auto_swap::validate_for_swap`: sender == admin,
/// cap not paused, cap not expired, amount ≤ cap.max_per_swap. The
/// `Source` type parameter must match the cap's phantom — the type
/// system catches "use a USDC cap to drain SUI."
public fun auto_swap_extract<Source>(
    vault: &mut TaliseVault,
    registry: &mut AutoSwapRegistry,
    cap: &AutoSwapCap<Source>,
    amount: u64,
    clock: &Clock,
    ctx: &TxContext,
): (Balance<Source>, SwapTicket) {
    assert!(auto_swap::cap_vault(cap) == object::id(vault), E_WRONG_VAULT);
    assert!(amount > 0, E_ZERO_AMOUNT);

    auto_swap::validate_for_swap<Source>(
        registry,
        cap,
        amount,
        clock.timestamp_ms(),
        ctx,
    );

    let key = type_name::with_defining_ids<Source>().into_string().into_bytes();
    assert!(vault.balances.contains(key), E_TYPE_NOT_HELD);
    let held: &mut Balance<Source> = vault.balances.borrow_mut(key);
    assert!(balance::value(held) >= amount, E_INSUFFICIENT_BALANCE);
    let extracted = balance::split(held, amount);

    if (balance::value(held) == 0) {
        let empty: Balance<Source> = vault.balances.remove(key);
        balance::destroy_zero(empty);
    };

    let ticket = SwapTicket {
        vault_id: object::id(vault),
        from_type: key,
        from_amount: amount,
    };

    (extracted, ticket)
}

/// Deposit the swap output back into the vault and consume the ticket.
/// Asserts the ticket was issued against THIS vault — funds cannot
/// flow to a different vault inside the same PTB.
///
/// `Dest` is unconstrained at the type level here; the off-chain SDK
/// builds the PTB with `Dest = USDsui`. v2 should add a registry-level
/// allowlist of destination types and assert it (see AUTOSWAP.md).
public fun auto_swap_deposit<Dest>(
    vault: &mut TaliseVault,
    output: Balance<Dest>,
    ticket: SwapTicket,
    clock: &Clock,
) {
    // Destructure the ticket — this is the consumer that satisfies the
    // hot-potato discipline. After this line, the ticket is gone.
    let SwapTicket { vault_id, from_type, from_amount } = ticket;
    assert!(vault_id == object::id(vault), E_WRONG_VAULT);

    let to_amount = balance::value(&output);
    if (to_amount > 0) {
        let key = type_name::with_defining_ids<Dest>().into_string().into_bytes();
        if (vault.balances.contains(key)) {
            let held: &mut Balance<Dest> = vault.balances.borrow_mut(key);
            balance::join(held, output);
        } else {
            vault.balances.add(key, output);
        };
    } else {
        balance::destroy_zero(output);
    };

    vault.auto_swaps_total = vault.auto_swaps_total + 1;

    event::emit(VaultAutoSwap {
        vault_id: object::id(vault),
        from_type,
        to_type: type_name::with_defining_ids<Dest>().into_string().into_bytes(),
        from_amount,
        to_amount,
        ts_ms: clock.timestamp_ms(),
    });
}

// ───────────────────────────────────────────────────────────────────
// Read accessors

public fun owner(vault: &TaliseVault): address { vault.owner }

public fun deposits_total(vault: &TaliseVault): u64 { vault.deposits_total }

public fun auto_swaps_total(vault: &TaliseVault): u64 { vault.auto_swaps_total }

/// Returns the current balance of type `T`. Returns 0 if the vault
/// holds none of `T`. Used by the off-chain worker to decide whether
/// to schedule an auto-swap.
public fun balance_of<T>(vault: &TaliseVault): u64 {
    let key = type_name::with_defining_ids<T>().into_string().into_bytes();
    if (vault.balances.contains(key)) {
        let held: &Balance<T> = vault.balances.borrow(key);
        balance::value(held)
    } else {
        0
    }
}

/// String form of the held coin type — useful for indexers / SDK that
/// don't speak Move's type system.
public fun type_string<T>(): String {
    type_name::with_defining_ids<T>().into_string().to_string()
}

// ───────────────────────────────────────────────────────────────────
// Test-only shims

#[test_only]
public fun test_deposit_balance<T>(
    vault: &mut TaliseVault,
    balance: Balance<T>,
    from: address,
) {
    deposit_balance(vault, balance, from)
}
