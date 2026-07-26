# Trusted setup for the Talise shielded pool

The shielded pool's verifying key currently comes from a **single-party** setup:
`circuit/src/bin/keygen.rs` sampled the Groth16 trapdoor (α, β, τ, δ) with
`OsRng` and dropped it inside one process. Nobody outside can forge proofs, but
soundness rests on trusting that whoever ran that one command did not keep the
trapdoor. Anyone holding it can mint value out of the pool from nothing.

Fixing that needs a multi-party ceremony. Groth16 over BN254 is not negotiable —
`sui::groth16` is Sui's only on-chain SNARK verifier and it supports exactly
bn254 and bls12381, so a per-circuit trusted setup is unavoidable. This document
is the runbook, plus the two findings that determine whether the runbook can be
executed at all.

Everything below was measured or executed, not assumed. The commands that
produced each number are named so you can re-run them.

---

## 1. The format bridge: arkworks ⇄ snarkjs. **RESOLVED — it round-trips.**

**The risk.** Ceremony tooling (Perpetual Powers of Tau, `snarkjs zkey
contribute`) emits a verifying key as **snarkjs JSON**: affine coordinates as
base-10 decimal strings. Sui's verifier eats **arkworks-compressed bytes**:
`x` only, little-endian, with the top two bits of the last byte carrying
arkworks' `SWFlags`. If a key cannot cross that boundary byte-exactly, every
artefact a ceremony produces is unusable on Sui and the ceremony design has to
change.

**The answer: it crosses losslessly.** Four independent checks, all green:

| # | check | evidence |
|---|---|---|
| 1 | The shipped 520-byte VK survives `arkworks → snarkjs JSON → arkworks` with **zero byte difference**. So does the second single-party VK the Move suite carries, and so does a freshly generated one. | `cd circuit && cargo test --release --test snarkjs_vk_roundtrip` — 4 tests pass |
| 2 | A corrupted JSON is **rejected**, not silently coerced: off-curve point, coordinate ≥ the field modulus, `nPublic`/`IC` mismatch, and swapped Fq2 limbs all fail. Byte equality would be worthless without this. | same test file |
| 3 | **Real snarkjs** (`snarkjs@0.7.6 groth16 verify`) accepts an **arkworks** proof against the exported `verification_key.json` → `OK!`. Three deliberate corruptions are rejected. Our encoder and decoder are not just agreeing with each other. | `ceremony/verify_roundtrip.sh` |
| 4 | **Sui's native verifier** accepts the bytes that came back out of the snarkjs representation and verifies a real proof. | `sui move test ceremony_roundtrip` |

The mapping details that had to be right, and are:

* Fq2 is `[c0, c1]` in snarkjs JSON — `ffjavascript/src/wasm_field2.js::fromObject`
  writes `a[0]` into the low limb, matching arkworks' `QuadExtField { c0, c1 }`.
  (The *reversed* ordering people remember lives in snarkjs' Solidity template,
  not in the JSON.) Check 3's negative control confirms swapping them breaks
  verification.
* Because the JSON carries `y` explicitly, arkworks re-derives the compression
  flag from the exact `y` it is handed, so the flag bit is reproduced.
* `IC` is `gamma_abc_g1`, same order, length `nPublic + 1` = 9.
* `vk_alphabeta_12` is emitted for tooling compatibility but is not read by
  `snarkjs/src/groth16_verify.js`.

The conversion lives in `circuit/src/snarkjs.rs`, with
`circuit/src/bin/ceremony_vk_import.rs` as the ceremony-facing CLI.

### And a real ceremony's key was pushed all the way to Sui

To prove the *pipeline*, not just the format, a complete Phase-2 ceremony was run
end to end against the genuine published Phase-1 transcript:

```
powersOfTau28_hez_final_15.ptau      (55 contributions, BLAKE2b verified,
                                      full chain re-verified: "Powers of Tau Ok!")
  → snarkjs groth16 setup
  → 3 independent `zkey contribute` rounds
  → `zkey beacon` with drand quicknet round 30749720
       randomness 051b2f1c368e48d5b4dc4ca40af5038ba87bfbee636b8de5f3fda1b5616a325d
  → `zkey verify`  →  "ZKey Ok!"   (descent + every contribution + the beacon)
  → `zkey export verificationkey`
  → cargo run --bin ceremony_vk_import
  → Sui `groth16::verify_groth16_proof`  →  true
```

`tests/ceremony_roundtrip_tests.move::a_real_ceremony_derived_vk_verifies_a_snarkjs_proof_on_chain`
pins that result. The circuit used was snarkjs' own `Multiplier(1000)` test
circuit, **not** Talise's — for the reason in §2. So this proves the format and
the pipeline, not the Talise parameters.

### One thing this uncovered

`tests/groth16_verify_tests.move` verified a real proof against a VK from a
*different* keygen run than the one in `constants.move`. The key the pool
actually binds had never been shown to accept a real proof. It has now —
`ceremony_roundtrip_tests::package_vk_verifies_a_real_proof_on_chain` — using a
proof made with `web/public/shield/proving_key.bin`, whose embedded VK the
harness checks is byte-identical to `constants::verifying_key!()`.

---

## 2. The actual blocker: there is no `.r1cs`, and no arkworks-native Phase 2

The format bridge was the suspected landmine. It is fine. The real obstruction is
one level up and it stops the runbook in §3 from being executable today.

**Every Groth16 Phase-2 MPC tool consumes a circom-compiled binary `.r1cs`.**
Talise's circuit is an arkworks `ConstraintSynthesizer` written in Rust
(`circuit/src/circuit/mod.rs`). There is no `.r1cs`, and no exporter to that
format exists in any crate — `ark-circom` has `r1cs_reader.rs` and no writer.

The survey, so nobody re-does it:

| tool | consumes | curves | verdict |
|---|---|---|---|
| `iden3/snarkjs` | circom binary `.r1cs` | BN254, BLS12-381 | reference impl, maintained |
| `kobigurk/phase2-bn254` | bellman `Circuit<Bn256>` or legacy circom JSON | BN254 | maintained-ish; `bellman_ce`, not arkworks. Reachable from snarkjs via `zkey export bellman` |
| `celo-org/snark-setup` | serialized `Matrices<E>`, or a **zexe** `ConstraintSynthesizer` | BLS12-377/381, BW6-761 — **no BN254** | closest to what we'd want, wrong curve set, unmaintained pre-arkworks deps, unaudited |
| `AleoNet/aleo-setup` | snarkVM R1CS | BLS12-377, BW6-761 | wrong curve, wrong framework |
| `Consensys/gnark` `bn254/mpcsetup` | gnark-native R1CS | **BN254**, actively maintained | only maintained non-circom BN254 Phase 2 — but it is Go |
| ZoKrates `mpc` | ZoKrates' own circuit binary | BN254 | wrong frontend |
| arkworks-rs org | — | — | **no setup/MPC/ceremony repo exists at all** |

So: **no maintained tool runs a Groth16 Phase-2 MPC on an arkworks BN254
constraint system.** Three ways forward.

### Route A — port the circuit to circom *(recommended)*

Rewrite `TransactionCircuit` in circom, then snarkjs Phase 2 works exactly as
§3 describes.

* In our favour: the circuit is a vendored Vortex/Tornado-Nova design that
  *originated* in circom, and its Poseidon is already circomlib-compatible
  (`circuit/src/poseidon_opt/`). The on-chain empty-subtree constants and the
  `poseidon_root_tests` parity gate give an independent check that a circom
  Poseidon matches Sui's native `poseidon_bn254`.
* Prover options after the ceremony:
  * **keep the Rust/WASM prover** — load the final `.zkey` with
    `ark-circom`'s `read_zkey` (crates.io `ark-circom` 0.6.0, BN254-only) and
    prove with `Groth16::<Bn254, CircomReduction>`. **`CircomReduction` is
    mandatory**: circom prepares the powers of tau in Lagrange basis, so `H` is
    computed differently, and the default `LibsnarkReduction` yields the wrong
    `C` element and proofs that do not verify. Note also that `read_zkey` needs
    arkworks 0.6; this crate is pinned to 0.5.
  * or move to snarkjs/rapidsnark and drop the arkworks prover entirely. Given
    §5, this deserves a look on its own merits.
* Cost: a circuit rewrite plus a witness generator, and the whole test pyramid
  re-run. Highest effort, lowest cryptographic risk, and it lands on the path
  the entire BN254 ecosystem uses.

### Route B — write an arkworks-R1CS → circom-`.r1cs` exporter

Serialize the existing constraint system into iden3's binary `.r1cs` format
([spec](https://github.com/iden3/r1csfile/blob/master/doc/r1cs_bin_format.md)),
run snarkjs Phase 2 on it, then read the `.zkey` back with `read_zkey` +
`CircomReduction`.

* Keeps the circuit, the witness builder and the WASM prover as they are.
* Two things must be exactly right: the variable ordering (circom orders
  `[1, public outputs, public inputs, private]`; arkworks orders
  `[1, instance…, witness…]`) and the QAP/H-basis convention.
* **Failure mode is loud, not silent**: get it wrong and proofs simply do not
  verify. That is a much better risk profile than a subtle soundness bug, and it
  is directly testable — prove-and-verify against the ceremony key before
  anything is deployed.
* Cost: a few hundred lines plus a careful equivalence test. Lower total effort
  than A, but it is bespoke crypto plumbing that nobody else maintains.
* Extra auditability requirement: the exported `.r1cs` must be reproducible from
  the Rust source by a third party (`cargo run --bin export_r1cs` → same bytes),
  because `snarkjs zkey verify` proves descent *from that `.r1cs`*, and a
  `.r1cs` nobody can regenerate just moves the trust problem.

### Route C — rewrite in gnark

The only maintained non-circom BN254 Phase-2. Rejected: it forces a Go prover and
does nothing for the browser, which §5 says is the real constraint.

### Recommendation

**Route A**, unless §5's conclusion pushes the prover off WASM anyway — in which
case A collapses into that work, because circom + snarkjs/rapidsnark is one
decision rather than two. Route B is the right choice only if the circuit must be
preserved byte-for-byte for reasons unrelated to the ceremony.

Either way **the VK changes, so a new pool must be minted.** The VK binds at
`shielded_pool::new()`. The current pool is empty, so this is cheap — do it
before it is not.

---

## 3. The runbook

Scripts are in `ceremony/`. They are complete and were exercised end to end
against a stand-in `.r1cs` (§1). They cannot be run for the real circuit until
§2 is resolved; `01_init.sh` says so and refuses.

### Phase 1 — do NOT run it. Use the published transcript.

The circuit is **18,166 constraints** (`cargo run --release --bin bench_prove`),
so the 2^15 = 32,768 prepared Perpetual Powers of Tau transcript for BN254 is
sufficient. Re-running Phase 1 ourselves would produce something strictly weaker
— fewer contributors, no independent history — at large cost.

| | |
|---|---|
| file | `powersOfTau28_hez_final_15.ptau` |
| URL | `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau` |
| size | `37831832` bytes |
| **BLAKE2b-512** | `982372c867d229c236091f767e703253249a9b432c1710b4f326306bfa2428a17b06240359606cfe4d580b10a5a1f63fbed499527069c18ae17060472969ae6e` |
| where that digest is published | the [snarkjs README](https://github.com/iden3/snarkjs/blob/master/README.md), table under "Prepare phase 2" |
| contributions | 54 named + 1 beacon = **55** |
| attestations | [privacy-scaling-explorations/perpetualpowersoftau](https://github.com/privacy-scaling-explorations/perpetualpowersoftau) — one directory and README per contribution, with GPG keys and IPFS CIDs |
| curve check | `q = 0x30644e72…d87cfd47`, i.e. BN254/alt_bn128 |

Both were verified here: the downloaded file's BLAKE2b-512 matches the published
digest exactly, and `snarkjs powersoftau verify` re-walked all 55 contributions →
**"Powers of Tau Ok!"** (slow — budget 10+ minutes).

```bash
ceremony/00_verify_phase1.sh          # digest + size, seconds
ceremony/00_verify_phase1.sh --full   # re-verify all 55 contributions, slow
```

Its SHA-256 is `3ef2ecc5b75d687048cf2d59195119b42fb07c5af639c5f283d84bfa69829e7f`
— computed locally, **not published by the project**. Recorded in
`ceremony/lib.sh` so future divergence is visible; the BLAKE2b digest is the
attested one.

> If the circuit ever exceeds 32,768 constraints, move to
> `powersOfTau28_hez_final_16.ptau` and update `PHASE1_*` in `ceremony/lib.sh`
> — **including the published digest**. `01_init.sh` refuses if the circuit does
> not fit.

### Phase 2 — circuit-specific, ≥ 3 independent contributors

```bash
# coordinator, once
ceremony/01_init.sh circuit.r1cs          # deterministic zero-contribution base

# each contributor, on their own machine, ONE command
ceremony/02_contribute.sh circuit.r1cs ceremony_0000.zkey "Their Name"

# coordinator: commit to the beacon BEFORE it exists
ceremony/03_finalize.sh --announce 2026-08-01T12:00:00Z
#   → publish the printed drand round number now

# coordinator: after that round has happened
ceremony/03_finalize.sh --finalize <round> circuit.r1cs ceremony_0003.zkey
ceremony/04_export_vk.sh circuit.r1cs ceremony_final.zkey
```

**What makes `02_contribute.sh` not require trusting us.** Before it touches
anything it:

1. downloads the Phase-1 transcript from the URL *snarkjs* publishes and checks
   its BLAKE2b against the digest in *snarkjs'* README — neither from Talise;
2. runs `snarkjs zkey verify circuit.r1cs ptau input.zkey`, which **re-derives
   the zero-contribution base from `(r1cs, ptau)` itself** and walks every prior
   contribution (`snarkjs/src/zkey_verify_fromr1cs.js` →
   `zkey_verify_frominit.js`). A doctored file we hand them fails here and the
   script stops;
3. installs snarkjs from the public npm registry at a pinned version using their
   own npm. We ship no binaries.

Their secret comes from their OS CSPRNG plus anything they type, is used once,
and is dropped from the shell immediately. Nothing is uploaded. The script then
verifies its own output, writes a ready-to-publish attestation containing only
hashes, and tells them to publish it themselves and sign it. Then they are done —
nothing to keep, nothing to protect.

A contributor who does not trust snarkjs' `contribute` implementation can use an
independent one: `snarkjs zkey export bellman` → contribute with
`kobigurk/phase2-bn254` → `snarkjs zkey import bellman`. The chain verifies
identically.

Three contributors is the floor, not a target. More is strictly better and costs
nothing but coordination; the contributors should be as independent as possible
(different people, organisations, machines, countries).

### Finalisation — public randomness beacon

The last contributor is the only participant who sees near-final parameters
before choosing their secret. A beacon nobody could predict at announcement time
removes that last-mover advantage and, per Bowe–Gabizon–Miers, removes the need
for a precommitment round — which is what allows an open, come-as-you-are
ceremony. **It does not weaken or replace the 1-of-N assumption.**

Default: **drand quicknet** (League of Entropy), chain hash
`52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`, unchained
BLS on G1 with 3-second rounds, so round *N* cannot be produced early. Round
timing is fixed and public: round *N* occurs at `1692803367 + (N-1)×3` unix
seconds, so the round number can be computed and published in advance. snarkjs
then applies 2^10 SHA-256 iterations to the round's randomness, and
`zkey verify` re-derives the whole beacon contribution from the published
`(hash, iterations)`.

Honest caveat: **drand is sound on the same argument but less precedented.** The
reference ceremonies used Ethereum RANDAO (PSE Perpetual Powers of Tau, 2023 —
slot 7,325,000, slot number pre-committed on-chain) or a future Bitcoin block
hash (Zcash, 2018 — block 514200, 2^42 iterations, GPG-signed and
OpenTimestamps-stamped announcement). If precedent matters more than convenience,
use a future Ethereum RANDAO value; everything downstream is identical.

**The ordering is the entire security argument.** Announce the round, wait,
then finalise. If the announcement is not independently timestamped ahead of the
round, the beacon adds nothing and the published claim must be downgraded to
"N-party ceremony, no beacon".

### Independent verification

```bash
ceremony/verify.sh circuit.r1cs ceremony_final.zkey [deployed_vk.hex]
```

Establishes, from published artefacts only: the Phase-1 transcript is the
published one; the final parameters descend from *that* transcript and *this*
circuit; every contribution is well-formed with its hash printed for matching
against the contributors' own attestations; the beacon is reproducible; and the
exported VK converts to exactly the bytes in `constants.move`.

It cannot establish that any contributor destroyed their secret. Nothing can.

`ceremony/verify_roundtrip.sh` separately reproduces §1 in all four directions.

### Publication

See `ceremony/PUBLICATION.md`. Non-negotiables: contributors publish their own
attestations (a file we host is a file we could have written); the beacon round is
published before it exists; `constants.move`'s header is rewritten in the same
commit that changes the key; a fresh pool is minted.

---

## 4. The exact security claim

> **After the ceremony, forging a proof against the shielded pool's verifying key
> is infeasible provided that AT LEAST ONE of the named Phase-2 contributors, and
> at least one of the 55 Phase-1 contributors, actually destroyed their secret
> randomness and was not compromised while contributing. If EVERY contributor in
> either phase colluded or was compromised, the parameters are forgeable and an
> attacker can mint value out of the pool from nothing.**

Read that as it is written:

* **This is not "trustless."** It is a 1-of-N trust assumption. Do not describe
  it as trustless, verifiable-therefore-safe, or "no trusted setup". The correct
  short form is: *"multi-party trusted setup; sound if any one of N contributors
  was honest."*
* **Verification does not close the gap.** `ceremony/verify.sh` proves the
  parameters have the claimed *structure* and *lineage*. Whether a human deleted
  a number is not observable, now or ever. Publishing more attestations raises
  the cost of a lie; it does not eliminate the assumption.
* **The assumption compounds across both phases.** Phase 1's 55 contributors
  cover α, β, τ; Phase 2's contributors cover δ. Both need one honest party.
* **More contributors is monotonically better** and the only lever that moves
  this. Three is the floor.
* **The beacon buys openness, not soundness.** It removes the last-mover
  advantage and the precommitment round. It does not reduce the number of honest
  parties required.
* **A ceremony is not an audit.** It says nothing about whether the circuit
  computes the right predicate, whether the Move code enforces what the circuit
  proves, or whether the pool's accounting is correct.

### It does not fix the fee-drain defect

**Explicitly: this ceremony does nothing about the separate fee-drain defect in
`sources/shielded_pool.move` that another workstream is fixing.** That is a Move
accounting bug, reachable with entirely valid proofs. A perfect ceremony makes
proofs unforgeable; it does not make the contract's arithmetic correct. Both must
land before the pool holds real money, and neither substitutes for the other.

---

## 5. WASM proving on a phone. **This is a product blocker.**

Measured, not estimated. Host: Apple M4 Pro, 14 cores, macOS, Node 24.10,
`--release` / `wasm-pack --release`. Reproduce with:

```bash
cd circuit
cargo run --release --bin bench_prove              # native stage breakdown
wasm-pack build . --target nodejs --out-dir pkg/nodejs --release
node test/wasm_bench.mjs --iters 8                 # WASM
```

Circuit: **18,166 constraints**, 9 instance + 17,633 witness variables. Proving
key: **103,335 curve points**, 3,871,600 bytes arkworks-compressed. WASM binary
1.35 MB. Peak RSS after 8 proofs: **270 MiB**.

### Where the time goes

| stage | native | WASM | ratio |
|---|---|---|---|
| hex-decode the proving key | 24 ms | (inside prove) | |
| **load the proving key** (compressed, validated) | **674 ms** | **4070 ms** | 6.0× |
| load it compressed, skipping subgroup checks | 579 ms | 1544 ms | |
| **load it UNCOMPRESSED, no validation** | **3.7 ms** | **82 ms** | |
| witness build + `is_satisfied` sanity check | 20 ms | (inside prove) | |
| **Groth16 prove** | **147 ms** | **1603 ms** | **10.9×** |
| Groth16 verify | 0.7 ms | 5 ms | |
| **total `prove()` as shipped** | ~865 ms | **5629 ms** | 6.5× |

**72% of the browser prove is loading the proving key, and the current API
repeats it on every single proof.** `wasm::prove(input_json, proving_key_hex)`
takes the key as a hex string, so it hex-decodes and re-deserializes 103,335
compressed curve points — one modular square root each to recover `y` — every
time. Only ~12% of the 674 ms native load is the subgroup check; the rest is
decompression.

Two independent fixes, both measured:

* **(i) cache the deserialized key in the worker** — 5.63 s → **1.60 s** per
  proof (3.5×). First proof still pays the load.
* **(ii) serve the key uncompressed** (7,743,152 bytes instead of 3,871,600 —
  2× the download, cached once in IndexedDB) — load drops from 4070 ms to
  **82 ms**, a 50× win in WASM.

Doing both: **~1.6 s steady-state, ~1.7 s for the first proof** on an M4 Pro.
Neither touches the circuit or the VK, and neither is done here — `web/**` is out
of scope for this pass. `circuit/src/wasm/bench.rs` carries the measurement-only
exports that produced these numbers.

### On a mid-range Android

Extrapolation, **not** a measurement — the M4 Pro median scaled by rough
single-core ratios. Real phones will be worse: mobile browsers throttle worker
and background threads, thermally throttle sustained load, this build has no
wasm SIMD and no threads so there is no parallel MSM, and 270 MiB of peak RSS is
close to where Android Chrome starts killing tabs.

| | as shipped | with both fixes |
|---|---|---|
| high-end Android (SD 8 Gen 2/3) | ~11 s | ~3 s |
| **mid-range Android (SD 6/7-series, Helio G99)** | **~17–34 s** | **~5–10 s** |
| low-end Android (SD 4-series) | ~45 s+ | ~13 s+ |

Plus a first-ever session downloads 3.7 MB of proving key and 1.35 MB of wasm
before it can start — on a congested Lagos mobile connection that is its own
multi-second wait, though it is cached thereafter.

### The verdict, plainly

**As shipped, WASM proving is not viable on a mid-range Android.** Roughly half a
minute of blocked, un-cancellable computation to send one payment, on a device
that may OOM-kill the tab first. This matters more than any of the cryptography
above: an unforgeable proof nobody can generate is not a feature.

**Even with both fixes, 5–10 s on a mid-range phone is a hard product problem
for a payments app.** Talise's own copy promises sends that finalize *in under a
second*. A shielded send cannot be presented as the same product as a normal
send, and it should not be the default path.

**The circuit cannot be shrunk enough to rescue it.** The Merkle path check is
2 inputs × 26 levels of Poseidon-2 and is **488 constraints per level**, ~70% of
the circuit (measured: height 26 → 18,166; 24 → 17,190; 20 → 15,238; 16 →
13,286). Dropping to height 20 — which cuts capacity from 67M to 1M notes — buys
only 16% fewer constraints. The lever is the prover, not the circuit.

So, in priority order:

1. **Do fixes (i) and (ii).** ~3.5× and a 50× key-load win, no cryptographic
   risk, no VK change. Do these regardless of everything else.
2. **Prove natively on mobile, not in WASM.** The 10.9× WASM penalty on the prove
   itself is the largest single factor left. The Android app is React Native —
   a Rust prover behind a native module gets close to the 147 ms native figure.
   The browser can keep WASM as a fallback.
3. **If the prover must stay in the browser, evaluate rapidsnark/snarkjs** rather
   than arkworks-in-WASM. Route A in §2 makes that a natural pairing, and it is
   the stack the rest of the ecosystem has optimised.
4. **Set the UX expectation honestly.** Shielded sends are a deliberate,
   slower operation with visible progress and the ability to leave the screen.
   Not the default. Not advertised as instant.

---

## Files

| path | what |
|---|---|
| `CEREMONY.md` | this document |
| `ceremony/lib.sh` | pinned Phase-1 digest, snarkjs version, drand chain, shared helpers |
| `ceremony/00_verify_phase1.sh` | fetch + verify the Phase-1 transcript |
| `ceremony/01_init.sh` | coordinator: deterministic zero-contribution zkey |
| `ceremony/02_contribute.sh` | **contributor: the whole job, one command** |
| `ceremony/03_finalize.sh` | coordinator: announce the beacon round, then finalise |
| `ceremony/04_export_vk.sh` | zkey → `verification_key.json` → Sui VK bytes |
| `ceremony/verify.sh` | **third party: check every claim** |
| `ceremony/verify_roundtrip.sh` | reproduce §1 in all four directions |
| `ceremony/PUBLICATION.md` | what gets published, where, and the non-negotiables |
| `circuit/src/snarkjs.rs` | the arkworks ⇄ snarkjs conversion |
| `circuit/tests/snarkjs_vk_roundtrip.rs` | byte-exactness + rejection of corrupted input |
| `circuit/src/bin/ceremony_roundtrip.rs` | emits snarkjs artefacts from a real arkworks proof |
| `circuit/src/bin/ceremony_vk_import.rs` | `verification_key.json` → Sui VK bytes |
| `circuit/src/bin/bench_prove.rs` | native proving-cost breakdown |
| `circuit/src/wasm/bench.rs` | measurement-only wasm exports |
| `circuit/test/wasm_bench.mjs` | WASM proving benchmark |
| `tests/ceremony_roundtrip_tests.move` | the on-chain half of §1 |
