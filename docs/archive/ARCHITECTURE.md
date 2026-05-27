# Talise — architecture

> Historical document, preserved for context. See docs/generated/codebase/INDEX.md for current architecture.

## Move package layout

```
move/talise/
├── Move.toml
├── sources/
│   ├── account.move          # Root user account object
│   ├── policy.move           # AgentPolicy capability
│   ├── receipt.move          # PaymentReceipt NFT
│   ├── yield_router.move     # Per-asset deploy/withdraw across yield sources
│   ├── send.move             # Atomic send (USDC direct)
│   ├── auto_convert.move     # Atomic cross-asset send via DeepBook spot
│   ├── savings.move          # Savings buckets (sub-positions)
│   └── recurring.move        # Time-gated recurring payments + borrow-if-short
└── tests/
    ├── send_tests.move
    ├── auto_convert_tests.move
    ├── savings_tests.move
    ├── recurring_tests.move
    └── yield_router_tests.move
```

### Module responsibilities

| Module | Public entries | Reads | Writes |
|---|---|---|---|
| `account` | `create_account`, `link_policy` | — | `Account`, `AgentPolicyRef` |
| `policy` | `create_policy`, `revoke_policy`, `update_caps` | — | `AgentPolicy` |
| `receipt` | `mint`, `mint_with_conversion` | — | `PaymentReceipt` |
| `yield_router` | `deposit_usdc`, `withdraw_usdc`, `rebalance` | `AgentPolicy`, DeepBook Margin pool | `Account`, `SupplyShare` |
| `send` | `send_usdc` | `AgentPolicy`, `Account` | `PaymentReceipt`, transfers |
| `auto_convert` | `send_cross_asset` | `AgentPolicy`, DeepBook spot pool | `PaymentReceipt`, transfers |
| `savings` | `create_bucket`, `route_inflow`, `withdraw_from_bucket` | `AgentPolicy` | `SavingsBucket` |
| `recurring` | `create_schedule`, `tick`, `cancel` | `AgentPolicy`, `Account` | `Schedule`, `PaymentReceipt` |

### The capability gate pattern

Every entry that moves money takes `&AgentPolicy` and validates against it before executing.

```move
public entry fun send_usdc(
    account: &mut Account,
    policy: &AgentPolicy,
    amount: u64,
    recipient: address,
    memo: String,
    ctx: &mut TxContext
) {
    assert!(policy.owner == account.owner, ENotOwner);
    assert!(amount <= policy.max_single_payment_usdc, EOverCap);
    assert!(policy.daily_spent_usdc + amount <= policy.daily_spend_cap_usdc, EOverDailyCap);

    let coin = margin::withdraw_quote(&mut account.usdc_supply_share, amount, ctx);
    transfer::public_transfer(coin, recipient);
    receipt::mint(recipient, amount, memo, b"spending", ctx);
    policy.daily_spent_usdc = policy.daily_spent_usdc + amount;
}
```

## The signature PTB (demo screenshot)

Cross-asset send is the killer artifact:

```
PTB:
  account = SharedObject(account_obj_id)
  policy  = SharedObject(policy_obj_id)
  coin    = margin::withdraw_quote(&account.usdc_supply_share, 50_000000)
  sui     = deepbook::spot::swap(usdc_sui_pool, coin, min_out: 18_000000000)
  transfer::public_transfer(sui, recipient)
  receipt::mint_with_conversion(recipient, ...)
```

Five Move calls. One signature. One block. Reverts atomically on slippage.

## iOS app layout

```
ios/Talise/
├── TaliseApp.swift              # App entry, env objects, scenePhase
├── Theme/
│   ├── Colors.swift             # Cobalt + neutrals (ported from Cible)
│   ├── Typography.swift
│   └── Spacing.swift
├── Services/
│   ├── ZkLoginService.swift     # Google sign-in (ported from Cible)
│   ├── WalletService.swift      # Balance + address, mirrors zkLogin
│   ├── NetworkConfig.swift      # testnet/mainnet profiles
│   ├── TaliseAPI.swift          # On-chain reads (asset balances, yield positions)
│   ├── PTBPlanner.swift         # Intent → PTB compiler (ported from predict-cli/src/agent)
│   ├── CibleDatabase.swift      # SQLite (ported)
│   └── RetryPolicy.swift        # (ported)
├── Views/
│   ├── Home/
│   │   ├── HomeView.swift       # Total balance + asset cards + Earn/Send/Activity tabs
│   │   ├── AssetCard.swift
│   │   └── YieldStrip.swift     # The ticking "earning $0.18 today" widget
│   ├── Send/
│   │   ├── SendSheet.swift      # Recipient + amount + asset picker
│   │   ├── CrossAssetConfirmSheet.swift
│   │   └── SendReceiptView.swift
│   ├── Earn/
│   │   ├── EarnView.swift       # Strategy tier picker (Conservative/Balanced/Aggressive)
│   │   ├── AssetYieldDetail.swift
│   │   └── SavingsBucketsSection.swift
│   ├── Agent/
│   │   ├── AgentChatView.swift  # NL intent → PTB confirmation
│   │   └── AgentPolicyEditor.swift  # Caps, allowlists, revoke
│   ├── Activity/
│   │   └── ActivityView.swift   # PaymentReceipt history
│   ├── Common/
│   │   ├── ConnectWalletSheet.swift  # zkLogin Google (ported)
│   │   └── ConfirmPTBSheet.swift     # Show planned calls + sign
│   └── Onboarding/
│       └── OnboardingFlow.swift  # (ported, retheme)
└── Resources/
    ├── Info.plist
    └── Assets.xcassets
```

## Off-chain bridge (Node.js)

Ports from cible-app/bridge with two new endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /zklogin/address` | (existing) compute address from JWT |
| `POST /zklogin/sign` | (existing) zkLogin signature |
| `POST /tx/build` | (existing) BCS-encode a PTB |
| `POST /sponsor` | (existing) sponsored gas |
| `POST /agent/plan` | NEW — compile NL intent → structured plan |
| `POST /quote/cross-asset` | NEW — fetch DeepBook spot quote for SendSheet preview |

The `/agent/plan` endpoint runs the Claude API with a constrained prompt that emits JSON conforming to a Talise intent schema. The schema is reused on-device for typed parsing.

## Yield-source adapter interface (Move)

All yield sources implement the same trait-like pattern so `yield_router` can compose them:

```move
public trait YieldAdapter<phantom T> {
    fun supply(coin: Coin<T>, ctx: &mut TxContext): SupplyShare<T>;
    fun withdraw(share: &mut SupplyShare<T>, amount: u64, ctx: &mut TxContext): Coin<T>;
    fun current_apy_bps(): u16;
    fun balance(share: &SupplyShare<T>): u64;
}
```

Implementations:
- `talise::adapters::deepbook_margin` — wraps the DeepBook Margin lending pool
- `talise::adapters::deepbook_spot_lp` — wraps spot LP positions (v2)
- `talise::adapters::predict_plp` — wraps Predict's PLP token (v2, Aggressive tier)
- `talise::adapters::liquid_staking` — wraps haSUI/afSUI (v2)
- `talise::adapters::idle` — no-op for non-yielding assets like XAUM
