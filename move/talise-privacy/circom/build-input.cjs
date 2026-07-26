const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");
(async () => {
  const P = await buildPoseidon(); const F = P.F;
  const h = (arr) => BigInt(F.toString(P(arr)));
  const LEVELS = 26;
  const vortex = 5n; // arbitrary pool field for this smoke test
  // Two zero-value dummy inputs (amount 0 → merkle skipped)
  const mk = (pk, blind, idx) => {
    const pub = h([pk]);
    const commit = h([0n, pub, blind, vortex]);
    const sig = h([pk, commit, idx]);
    const nul = h([commit, idx, sig]);
    return { pk, blind, idx, pub, commit, sig, nul };
  };
  const in0 = mk(111n, 222n, 0n), in1 = mk(333n, 444n, 1n);
  // Two zero-value outputs
  const out0pk = h([555n]), out1pk = h([666n]);
  const outc0 = h([0n, out0pk, 777n, vortex]), outc1 = h([0n, out1pk, 888n, vortex]);
  const zeros = Array(LEVELS).fill("0");
  const input = {
    vortex: vortex.toString(), root: "0", publicAmount: "0",
    inputNullifier: [in0.nul.toString(), in1.nul.toString()],
    outputCommitment: [outc0.toString(), outc1.toString()],
    hashedAccountSecret: "0",
    accountSecret: "0",
    inPrivateKey: [in0.pk.toString(), in1.pk.toString()],
    inAmount: ["0","0"], inBlinding: [in0.blind.toString(), in1.blind.toString()],
    inPathIndex: ["0","1"],
    inPathLeft: [zeros, zeros], inPathRight: [zeros, zeros],
    outPubkey: [out0pk.toString(), out1pk.toString()],
    outAmount: ["0","0"], outBlinding: ["777","888"],
  };
  fs.writeFileSync("build/input_valid.json", JSON.stringify(input));
  // Forged: wrong nullifier[0]
  const bad = JSON.parse(JSON.stringify(input));
  bad.inputNullifier[0] = (in0.nul + 1n).toString();
  fs.writeFileSync("build/input_forged.json", JSON.stringify(bad));
  console.log("valid + forged inputs written. null0 =", in0.nul.toString().slice(0,20)+"...");
})();
