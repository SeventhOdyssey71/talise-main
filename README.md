<div align="center">

# Talise

**Money that moves like a message.**

A gasless US dollar account on Sui. Sign in with Google, hold dollars, and send them to a name like `vanessa@talise.sui`. No seed phrase, no gas, settles in under a second, and a send can be private with the amount hidden on chain. Live on mainnet.

[Website](https://talise.io) · [iOS (TestFlight)](https://testflight.apple.com/join/BFNEPYtM) · [X](https://x.com/taliseio)

</div>

---

## This repository

This is the **primary working repository** for Talise, where the product was built. It is a monorepo:

```
web/       Web app and API (Next.js, TypeScript)
ios/       iOS app (Swift, SwiftUI)
android/   Android app (Kotlin, Jetpack Compose)
move/      Sui Move packages (payments, privacy, savings, yield)
infra/     Gas-sponsorship service (the gasless transaction sponsor)
cli/       Talise command-line client (@talise/cli)
scripts/   Repo tooling and one-off operational scripts
docs/      Design, strategy, pitch, and security documentation
marketing/ Marketing site assets and Remotion motion pieces
```

## What Talise does

- **Send by name.** Pay `name@talise.sui` instead of a 0x address, gasless, settling in under a second.
- **Private sends.** A Groth16 shielded pool hides the amount on chain and unlinks sender from recipient. Live on mainnet.
- **More than a send.** Claimable payment links, streaming, an on-chain savings vault, and idle balance put to work through on-chain lending.
- **In and out.** Cash to and from a bank through licensed ramp partners.

## Built on Sui

zkLogin for keyless self-custody, sponsored gas so the user pays nothing to transact, sub-second finality, and a Move-based shielded pool for privacy.

## Focused repositories

The codebase is also organized into focused repositories under the [talise-public](https://github.com/talise-public) organization:

- [talise-frontend](https://github.com/talise-public/talise-frontend), web app and API
- [talise-mobile](https://github.com/talise-public/talise-mobile), iOS app
- [talise-cli](https://github.com/talise-public/talise-cli), wallet in your terminal (payments, agent-to-agent, MCP)
- [talise-contracts](https://github.com/talise-public/talise-contracts), Sui Move packages
- [talise-infra](https://github.com/talise-public/talise-infra), gas-sponsorship service
- [talise-docs](https://github.com/talise-public/talise-docs), overview, architecture, and pitch

## Security

No secrets are committed. Configuration is environment-driven, bank details are encrypted at rest, and money-path endpoints are gated by app attestation and rate limiting.

## License

Proprietary. Copyright (c) 2026 Talise. All rights reserved. The source is publicly viewable for evaluation and reference only; no use, copy, modification, distribution, or fork-for-use is permitted without written permission. See [LICENSE](./LICENSE). Third-party components (for example the flag icons, SuiGrpcKit, and the gas-sponsorship service) retain their own licenses.
