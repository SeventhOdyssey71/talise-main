# Prover speed — measured findings and the path to sub-second

Measured on this machine (Apple M4 Pro, Node 24, release). Browser/mobile
numbers are extrapolations, labelled as such.

## The numbers

| path | witness | prove | proving key | notes |
|---|---|---|---|---|
| arkworks **native** (Rust) | ~4 ms | **~147 ms** | 3.8 MB | fast — but only reachable from Rust |
| arkworks **WASM** (what the app ships today) | ~82 ms | ~1.6 s (cached key) / **~5.6 s** (as-shipped) | 3.8 MB | 72% of the as-shipped time is *re-deserializing the key on every call* |
| **circom + snarkjs** (native Node) | **68 ms** | **599 ms** | **10.9 MB** | measured here; median of 5 |
| circom + **rapidsnark** | ~same wasm/native witness | ~100–150 ms (native class) | 10.9 MB | not built here; rapidsnark is C++/native, the same class as arkworks-native |

Proof output is ~800 B; public signals ~350 B (8 signals). WASM witness
calculator: 3.0 MB. circom zkey: **10.9 MB**.

## The finding, stated plainly

**The bottleneck was never the prove math.** A Groth16 prove over this circuit is
~150 ms natively. The app feels like 5–10 s because it runs the **arkworks WASM
prover inside a hidden WebView**, and most of that time is *loading and
re-deserializing the proving key*, not proving.

Two consequences:

1. **The circom port does not, by itself, make the browser faster.** Its zkey is
   **10.9 MB vs 3.8 MB** — nearly 3× bigger — so a naive browser key-load gets
   *worse*. The port's real payoff is the ceremony (trust) and unlocking
   rapidsnark; it is close to neutral on raw speed.
2. **"Under a second" is an architecture problem, not a circuit problem.** The
   arkworks circuit *already* proves in ~147 ms natively. The app just never
   calls a native prover — it uses WASM in a WebView.

## The path to sub-second

### Mobile (the RN app) — a native prover module. This is the real win.
- Prove **natively** (rapidsnark arm64, or `ark-circom` `read_zkey` +
  `Groth16::<Bn254, CircomReduction>`), not WASM-in-WebView. Native prove ~150 ms
  + native witness → **well under a second**, key loaded once from disk with no
  per-call deserialization tax.
- Cost: a native module in an Expo managed app (config plugin / prebuild via EAS).
  Real work, but the only path that hits the promise on a mid-range phone.
- Note: this is true for the arkworks circuit *too* — a native Rust module would
  already give ~150 ms. We pair it with circom+rapidsnark only because we're
  porting for the ceremony anyway.

### Web browser — architecture fixes on the prover, in order of leverage
1. **Cache the deserialized key in the worker** across calls. The arkworks agent
   measured this at ~3.5× (5.6 s → 1.6 s). The same applies to any prover — the
   key must not cross the wasm boundary and re-parse every prove.
2. **rapidsnark-wasm** for the prove step — faster than snarkjs-wasm.
3. **Shrink / stream the 10.9 MB zkey.** It is the dominant download + parse cost
   in-browser. Serve uncompressed for parse speed (the agent measured key load
   82 ms uncompressed vs 4070 ms compressed for the arkworks key), trade against
   download size, and cache in IndexedDB (already done for the arkworks key).

### Honest ceiling
Even fixed, an in-browser prove is unlikely to beat ~1–2 s on a mid-range phone.
The **native mobile module** is the only path that clears "finalize in under a
second." So: shielded sends should prove natively on mobile, and the web path
should target "a couple of seconds, honestly disclosed," not sub-second.

## Status
- circom + snarkjs measured and working (this doc).
- Native module + rapidsnark: NOT built — the next concrete engineering step, and
  gated on the production ceremony zkey (don't ship a prover for a key that
  doesn't exist yet). The browser key-cache fix is shippable now on the current
  arkworks prover, independent of the ceremony.
