/// Atomic Talise sends. The entry takes a Coin<T>, a recipient, and a memo;
/// it transfers the coin and mints a PaymentReceipt in the same call so the
/// outbound payment is inseparable from its on-chain proof.
module talise::send;

use std::string::String;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use talise::receipt;

const E_ZERO_AMOUNT: u64 = 1;
const E_MEMO_TOO_LONG: u64 = 2;

const MAX_MEMO_BYTES: u64 = 80;

/// Send a coin of any type. The PTB constructs `coin` (via splitCoin from gas,
/// or by withdrawing from a yield position) and hands it to this function.
/// `asset` is the human-readable symbol stamped into the receipt ("SUI", "USDC").
public fun send<T>(
    coin: Coin<T>,
    recipient: address,
    asset: String,
    memo: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let amount = coin::value(&coin);
    assert!(amount > 0, E_ZERO_AMOUNT);
    assert!(memo.length() <= MAX_MEMO_BYTES, E_MEMO_TOO_LONG);

    let from = ctx.sender();
    let ts_ms = clock.timestamp_ms();

    let r = receipt::mint(from, recipient, amount, asset, memo, ts_ms, ctx);
    transfer::public_transfer(r, from);
    transfer::public_transfer(coin, recipient);
}
