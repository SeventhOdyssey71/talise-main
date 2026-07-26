import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";
const input = JSON.parse(readFileSync("build/input_valid.json"));
const wasm = "build/transaction_js/transaction.wasm";
const zkey = "build/tx_final.zkey";
const now = () => Number(process.hrtime.bigint()) / 1e6;
// warm
await snarkjs.wtns.calculate(input, wasm, "build/wb.wtns");
const N = 5;
let wt = [], pt = [];
for (let i = 0; i < N; i++) {
  let t = now(); await snarkjs.wtns.calculate(input, wasm, "build/wb.wtns"); wt.push(now() - t);
  t = now(); await snarkjs.groth16.prove(zkey, "build/wb.wtns"); pt.push(now() - t);
}
const med = a => a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
console.log(`witness (wasm):   median ${med(wt).toFixed(0)} ms  (${wt.map(x=>x.toFixed(0)).join(", ")})`);
console.log(`groth16 prove:    median ${med(pt).toFixed(0)} ms  (${pt.map(x=>x.toFixed(0)).join(", ")})`);
console.log(`total snarkjs:    ~${(med(wt)+med(pt)).toFixed(0)} ms`);
process.exit(0);
