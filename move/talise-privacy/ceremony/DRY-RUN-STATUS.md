# Ceremony dry run — status (2026-07-26)

A full end-to-end **dry run** of the Groth16 Phase-2 ceremony was executed
against the real circom circuit (`../circom/build/transaction.r1cs`, 16,561
constraints). Every stage worked:

| step | script | result |
|---|---|---|
| Phase-1 transcript | `00_verify_phase1.sh` | `powersOfTau28_hez_final_16.ptau` (75,580,568 B) — **BLAKE2b matches the snarkjs README digest** |
| deterministic setup | `01_init.sh` | `ceremony_0000.zkey` (base, no secrets) |
| contribution #1 | `02_contribute.sh` | CSPRNG entropy, used once, destroyed; `ceremony_0001.zkey` + `attestation_0001.txt` |
| beacon finalize | `03_finalize.sh` | drand quicknet, 2^10 iters → `ceremony_final.zkey`, snarkjs **`ZKey Ok!`** |
| export VK | `04_export_vk.sh` | `verification_key.json` + **`vk_sui.hex` (520 bytes, arkworks-compressed)** — the exact format `constants::verifying_key!()` holds |
| proof against ceremony key | snarkjs | **`OK!`** — a real witness proves + verifies under the ceremony VK |

So the pipeline is proven on the actual circuit, and the ceremony-derived VK
bridges to Sui's native verifier.

## This dry run does NOT remove trust — and must not be shipped

Two deliberate shortcuts make it a mechanics demo, not a trustless ceremony:

1. **One contributor (us).** Soundness of a Phase-2 ceremony rests on *at least
   one* contributor being independent and honestly destroying their randomness.
   A ceremony we run alone gives exactly the trust profile of the current
   single-party OsRng key — trust the one contributor. It is not an improvement;
   it only looks like one.
2. **A past beacon round.** The real beacon must be a drand round announced
   *before it exists* (`03_finalize.sh --announce <future instant>`), so the last
   contributor cannot see the randomness before choosing their secret. This dry
   run used a recent past round.

**`vk_sui.hex` from this dry run must never be pasted into `constants.move`.**

## What a real run needs (the remaining work is coordination, not code)

- ≥ 2 **independent** contributors, each running `02_contribute.sh` on their own
  machine with their own entropy, each publishing + signing their attestation.
- A **future** beacon round announced ahead of time, then finalized after it lands.
- Only then: paste the real `vk_sui.hex` into `constants::verifying_key!()`,
  fresh-publish a pool bound to it, devInspect a real proof on-chain, and migrate.

The tooling is done and unblocked; the missing ingredient is real people
contributing.
