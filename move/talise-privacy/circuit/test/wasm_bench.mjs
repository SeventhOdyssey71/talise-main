// WASM proving benchmark for the Talise privacy circuit.
//
// The product question: can a user on a mid-range Android in Lagos generate a
// shielded-transaction proof in the browser without the app feeling broken?
// Native arkworks proves in ~150 ms. WASM in a Web Worker on a $150 phone is the
// number that actually matters, and it was never measured.
//
// This harness measures what CAN be measured honestly on a dev machine:
//
//   * cold path  — everything a first proof pays: read the 3.87 MB proving key,
//                  hex-encode it (the wasm export takes a hex STRING), then
//                  prove. This is the number the user feels.
//   * warm path  — repeat proves with the key already in memory as hex. NOTE
//                  this is still not cheap: `wasm::prove` re-decodes the hex and
//                  re-deserializes the proving key on EVERY call.
//   * hex cost   — the JS-side cost of turning 3.87 MB of bytes into a
//                  7.74 MB hex string, paid once per key load.
//   * verify     — in-wasm self-check before submitting to chain.
//   * peak RSS   — how much memory a proof needs, which is what actually kills
//                  low-end Android browsers (tab gets OOM-killed, not slow).
//
// It CANNOT measure a real mid-range Android from here. It reports the measured
// numbers plus an explicit, labelled extrapolation, and `CEREMONY.md` §5 states
// the caveat rather than dressing the estimate up as a measurement.
//
// Run:
//   wasm-pack build . --target nodejs --out-dir pkg/nodejs --release
//   node test/wasm_bench.mjs [--iters N] [--pk <path>]
//
// Exits non-zero if any proof fails to verify.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { cpus, totalmem } from "node:os";
import {
  prove,
  verify,
  build_deposit_input,
  bench_load_pk_compressed,
  bench_load_pk_compressed_unchecked,
  bench_load_pk_uncompressed,
  bench_recompress_pk_uncompressed,
  bench_cache_pk,
  bench_prove_deposit_cached,
} from "../pkg/nodejs/talise_privacy_circuit.js";

const here = dirname(fileURLToPath(import.meta.url));
const circuitDir = join(here, "..");
const repoRoot = resolve(circuitDir, "..", "..", "..");

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const ITERS = Number(argOf("--iters", "10"));
const PK_PATH = argOf("--pk", join(repoRoot, "web", "public", "shield", "proving_key.bin"));
const VK_PATH = join(circuitDir, "keys", "vk_sui.hex");

const ms = (n) => `${n.toFixed(0)} ms`;
function stats(label, xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const p = (q) => s[Math.min(n - 1, Math.floor(q * n))];
  console.log(
    `  ${label.padEnd(34)} n=${String(n).padEnd(3)} ` +
      `min ${s[0].toFixed(0).padStart(6)}  median ${p(0.5).toFixed(0).padStart(6)}  ` +
      `mean ${mean.toFixed(0).padStart(6)}  p95 ${p(0.95).toFixed(0).padStart(6)}  ` +
      `max ${s[n - 1].toFixed(0).padStart(6)}   (ms)`,
  );
  return { min: s[0], median: p(0.5), mean, p95: p(0.95), max: s[n - 1] };
}

function main() {
  const fail = (m) => {
    console.error(`FAIL: ${m}`);
    process.exit(1);
  };

  console.log("=== TALISE PRIVACY — WASM PROVING BENCHMARK ===");
  const cpu = cpus()[0];
  console.log(`host      : ${process.platform}/${process.arch}  ${cpu.model}  ` +
    `${cpus().length} logical cores  ${(totalmem() / 2 ** 30).toFixed(0)} GiB RAM`);
  console.log(`node      : ${process.version}`);
  const wasmSize = readFileSync(join(circuitDir, "pkg", "nodejs", "talise_privacy_circuit_bg.wasm")).length;
  console.log(`wasm      : ${(wasmSize / 2 ** 20).toFixed(2)} MB`);

  // ---- COLD PATH: what the very first proof of a session costs ------------
  const tColdStart = performance.now();
  const pkBytes = readFileSync(PK_PATH);
  const tRead = performance.now();
  const provingKeyHex = pkBytes.toString("hex");
  const tHex = performance.now();

  const verifyingKeyHex = readFileSync(VK_PATH, "utf8").trim();
  console.log(
    `proving key: ${pkBytes.length} bytes (${(pkBytes.length / 2 ** 20).toFixed(2)} MB binary, ` +
      `${(provingKeyHex.length / 2 ** 20).toFixed(2)} MB as hex)\n`,
  );

  const inputJson = build_deposit_input("0x1", "0", 1000n, 600n, 400n);
  const tFirstStart = performance.now();
  const firstProofJson = prove(inputJson, provingKeyHex);
  const tFirstEnd = performance.now();

  if (!verify(firstProofJson, verifyingKeyHex)) fail("first proof did not verify");

  console.log("COLD PATH (first proof of a session, key already on disk/cache):");
  console.log(`  read 3.87 MB proving key from disk   ${ms(tRead - tColdStart)}`);
  console.log(`  hex-encode it for the wasm boundary  ${ms(tHex - tRead)}`);
  console.log(`  wasm prove() (incl. re-deserialize)  ${ms(tFirstEnd - tFirstStart)}`);
  console.log(`  ------------------------------------------------`);
  console.log(`  TOTAL cold, excluding network        ${ms(tFirstEnd - tColdStart)}`);
  console.log(
    `  (a first-EVER session also downloads ${(pkBytes.length / 2 ** 20).toFixed(2)} MB of proving key\n` +
      `   + ${(wasmSize / 2 ** 20).toFixed(2)} MB of wasm; see CEREMONY.md §5 for what that costs on 3G)\n`,
  );

  // ---- WARM PATH ---------------------------------------------------------
  const proveTimes = [];
  const verifyTimes = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    const pj = prove(inputJson, provingKeyHex);
    const t1 = performance.now();
    proveTimes.push(t1 - t0);

    const v0 = performance.now();
    const ok = verify(pj, verifyingKeyHex);
    const v1 = performance.now();
    verifyTimes.push(v1 - v0);
    if (!ok) fail(`proof ${i} did not verify`);
  }

  console.log(`WARM PATH (${ITERS} iterations, proving key hex held in memory):`);
  const proveStat = stats("wasm prove()", proveTimes);
  stats("wasm verify()", verifyTimes);

  // Cost of the hex round trip alone, for apportioning.
  const hexTimes = [];
  for (let i = 0; i < Math.min(ITERS, 5); i++) {
    const t0 = performance.now();
    const h = pkBytes.toString("hex");
    hexTimes.push(performance.now() - t0);
    if (h.length !== pkBytes.length * 2) fail("hex length wrong");
  }
  stats("Buffer.toString('hex') (JS side)", hexTimes);

  const rss = process.memoryUsage().rss;
  console.log(`\n  peak RSS after ${ITERS} proofs: ${(rss / 2 ** 20).toFixed(0)} MiB`);

  // ---- WHERE THE TIME ACTUALLY GOES --------------------------------------
  // `prove()` re-does the proving-key load on every call. Split it out.
  const stageIters = Math.max(3, Math.min(ITERS, 5));
  console.log(`\nSTAGE BREAKDOWN INSIDE WASM (${stageIters} iterations each):`);

  const t0 = performance.now();
  const nPoints = bench_load_pk_compressed(provingKeyHex);
  const oneCompressedLoad = performance.now() - t0;
  console.log(`  proving key holds ${nPoints} curve points`);

  const loadCompressed = [oneCompressedLoad];
  for (let i = 1; i < stageIters; i++) {
    const t = performance.now();
    bench_load_pk_compressed(provingKeyHex);
    loadCompressed.push(performance.now() - t);
  }
  const loadStat = stats("A. load PK compressed+validated", loadCompressed);

  const loadUnchecked = [];
  for (let i = 0; i < stageIters; i++) {
    const t = performance.now();
    bench_load_pk_compressed_unchecked(provingKeyHex);
    loadUnchecked.push(performance.now() - t);
  }
  stats("B. load PK compressed, no validate", loadUnchecked);

  // The same key served UNCOMPRESSED: 2x the bytes, but no per-point square root.
  const uncompressedHex = bench_recompress_pk_uncompressed(provingKeyHex);
  const loadUncompressed = [];
  for (let i = 0; i < stageIters; i++) {
    const t = performance.now();
    bench_load_pk_uncompressed(uncompressedHex);
    loadUncompressed.push(performance.now() - t);
  }
  const uncStat = stats("C. load PK UNCOMPRESSED, no validate", loadUncompressed);
  console.log(
    `     (uncompressed key is ${(uncompressedHex.length / 2 / 2 ** 20).toFixed(2)} MB binary ` +
      `vs ${(pkBytes.length / 2 ** 20).toFixed(2)} MB compressed)`,
  );

  // Prove against an already-deserialized key: stages 3+4 only.
  bench_cache_pk(provingKeyHex);
  const cachedProve = [];
  for (let i = 0; i < stageIters; i++) {
    const t = performance.now();
    const pj = bench_prove_deposit_cached(1000n, 600n, 400n);
    cachedProve.push(performance.now() - t);
    if (!verify(pj, verifyingKeyHex)) fail(`cached-key proof ${i} did not verify`);
  }
  const cachedStat = stats("D. prove with key already loaded", cachedProve);

  console.log("\nWHAT THAT MEANS:");
  const pct = (100 * loadStat.median) / proveStat.median;
  console.log(
    `  Of the ${(proveStat.median / 1000).toFixed(2)} s median prove(), ` +
      `${(loadStat.median / 1000).toFixed(2)} s (${pct.toFixed(0)}%) is loading the proving key,\n` +
      `  which the current wasm API repeats on EVERY proof.`,
  );
  console.log(
    `  Two independent fixes, both measured above:\n` +
      `    (i)  keep the deserialized key in the worker  -> ${(cachedStat.median / 1000).toFixed(2)} s per proof ` +
      `(${(proveStat.median / cachedStat.median).toFixed(1)}x faster), first proof still pays ${(loadStat.median / 1000).toFixed(2)} s;\n` +
      `    (ii) ship the key UNCOMPRESSED (2x bytes)     -> key load drops to ${uncStat.median.toFixed(0)} ms ` +
      `(${(loadStat.median / uncStat.median).toFixed(0)}x faster).\n` +
      `  Doing both: ~${(cachedStat.median / 1000).toFixed(2)} s steady-state and ~${((cachedStat.median + uncStat.median) / 1000).toFixed(2)} s for the first proof.`,
  );

  // ---- EXTRAPOLATION (clearly labelled as such) ---------------------------
  // Multipliers are single-core-performance ratios between an Apple M-series
  // laptop core and typical Android SoC cores, taken as ROUGH published
  // Geekbench-6 single-core ratios. They are an order-of-magnitude guide, NOT a
  // measurement, and WASM adds its own (already included) overhead.
  const tiers = [
    ["high-end Android (SD 8 Gen 2/3 class)", 2.0],
    ["mid-range Android (SD 6/7-series, Helio G99 class)", 4.5],
    ["low-end Android (SD 4-series, Helio G3x class)", 8.0],
  ];
  console.log("\nEXTRAPOLATION TO PHONES — ESTIMATE, NOT A MEASUREMENT:");
  console.log("  (measured medians on this host scaled by rough single-core ratios)");
  console.log(`  ${"".padEnd(52)} ${"as shipped".padStart(12)} ${"both fixes".padStart(12)}`);
  const fixed = cachedStat.median;
  for (const [name, mult] of tiers) {
    const now = (proveStat.median * mult) / 1000;
    const then = (fixed * mult) / 1000;
    console.log(
      `  ${name.padEnd(52)} ${(`~${now.toFixed(0)} s`).padStart(12)} ${(`~${then.toFixed(1)} s`).padStart(12)}`,
    );
  }
  console.log(
    "\n  Caveats that make these OPTIMISTIC on a real phone:\n" +
      "   - mobile browsers throttle background/worker threads and thermally throttle sustained load;\n" +
      "   - this build has no wasm SIMD and no threads, so there is no parallel MSM to fall back on;\n" +
      "   - Android WebView/Chrome memory limits can kill a tab before it gets slow.",
  );

  console.log("\nALL PROOFS VERIFIED. Benchmark complete.");
}

main();
