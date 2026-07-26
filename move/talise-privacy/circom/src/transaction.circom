pragma circom 2.1.9;

// Talise shielded-pool transaction circuit — CIRCOM PORT of the arkworks
// `TransactionCircuit` (circuit/src/circuit/mod.rs). 2-in / 2-out.
//
// WHY A PORT: the arkworks circuit has no `.r1cs`, so no Groth16 Phase-2 MPC
// tool can run a trust-removing ceremony on it (CEREMONY.md §2). circom does.
// Its Poseidon is circomlib-compatible — verified byte-identical to the deployed
// `@mysten/sui` poseidonHash across arity 1/2/3/4 — so this circuit produces the
// SAME commitments and nullifiers as the live scheme. Only the VK changes.
//
// PUBLIC SIGNAL ORDER is load-bearing: circom emits public signals as
// [outputs, then public inputs in declaration order]. This template has NO
// outputs, and declares the eight public inputs in exactly the order the Move
// verifier consumes them:
//   [vortex, root, publicAmount, inputNullifier[0], inputNullifier[1],
//    outputCommitment[0], outputCommitment[1], hashedAccountSecret]
//
// Scheme (identical to the arkworks circuit):
//   pubkey     = Poseidon1(privkey)
//   commitment = Poseidon4(amount, pubkey, blinding, vortex)
//   signature  = Poseidon3(privkey, commitment, pathIndex)
//   nullifier  = Poseidon3(commitment, pathIndex, signature)
//   merkle     = pair-based: at each level the path stores the ordered
//                (left,right) children; the tracked child must be one of them,
//                enforced via isLeft = (cur == left) + mux, matching PathVar.

include "poseidon.circom";
include "comparators.circom";
include "bitify.circom";
include "mux1.circom";

// Reproduce the on-chain / PathVar merkle root from a leaf and a pair-path.
// `pathLeft[i]`, `pathRight[i]` are the two children stored at level i. This
// mirrors merkle_tree.rs::PathVar::check_membership: isLeft = (cur == left);
// left'  = isLeft ? cur : pathLeft; right' = isLeft ? pathRight : cur.
template MerkleRootFromPath(levels) {
    signal input leaf;
    signal input pathLeft[levels];
    signal input pathRight[levels];
    signal output root;

    signal cur[levels + 1];
    cur[0] <== leaf;

    component isLeft[levels];
    component selL[levels];
    component selR[levels];
    component h[levels];

    for (var i = 0; i < levels; i++) {
        isLeft[i] = IsEqual();
        isLeft[i].in[0] <== cur[i];
        isLeft[i].in[1] <== pathLeft[i];

        // left' = isLeft ? cur[i] : pathLeft[i]
        selL[i] = Mux1();
        selL[i].c[0] <== pathLeft[i];
        selL[i].c[1] <== cur[i];
        selL[i].s <== isLeft[i].out;

        // right' = isLeft ? pathRight[i] : cur[i]
        selR[i] = Mux1();
        selR[i].c[0] <== cur[i];
        selR[i].c[1] <== pathRight[i];
        selR[i].s <== isLeft[i].out;

        h[i] = Poseidon(2);
        h[i].inputs[0] <== selL[i].out;
        h[i].inputs[1] <== selR[i].out;
        cur[i + 1] <== h[i].out;
    }

    root <== cur[levels];
}

template Transaction(levels, nIns, nOuts, amountBits) {
    // ── Public inputs (order MUST match the Move verifier) ──
    signal input vortex;
    signal input root;
    signal input publicAmount;
    signal input inputNullifier[nIns];
    signal input outputCommitment[nOuts];
    signal input hashedAccountSecret;

    // ── Private witnesses ──
    signal input accountSecret;
    signal input inPrivateKey[nIns];
    signal input inAmount[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndex[nIns];
    signal input inPathLeft[nIns][levels];
    signal input inPathRight[nIns][levels];
    signal input outPubkey[nOuts];
    signal input outAmount[nOuts];
    signal input outBlinding[nOuts];

    // ── Account-secret check (only when hashedAccountSecret != 0) ──
    component hAcc = Poseidon(1);
    hAcc.inputs[0] <== accountSecret;
    component accIsZero = IsZero();
    accIsZero.in <== hashedAccountSecret;
    // (hAcc - hashedAccountSecret) must be 0 unless hashedAccountSecret == 0
    (hAcc.out - hashedAccountSecret) * (1 - accIsZero.out) === 0;

    // ── Inputs ──
    component inPubkey[nIns];
    component inCommit[nIns];
    component inSig[nIns];
    component inNull[nIns];
    component inRange[nIns];
    component inAmtIsZero[nIns];
    component inMerkle[nIns];

    var sumIns = 0;
    for (var i = 0; i < nIns; i++) {
        // pubkey = Poseidon1(privkey)
        inPubkey[i] = Poseidon(1);
        inPubkey[i].inputs[0] <== inPrivateKey[i];

        // commitment = Poseidon4(amount, pubkey, blinding, vortex)
        inCommit[i] = Poseidon(4);
        inCommit[i].inputs[0] <== inAmount[i];
        inCommit[i].inputs[1] <== inPubkey[i].out;
        inCommit[i].inputs[2] <== inBlinding[i];
        inCommit[i].inputs[3] <== vortex;

        // signature = Poseidon3(privkey, commitment, pathIndex)
        inSig[i] = Poseidon(3);
        inSig[i].inputs[0] <== inPrivateKey[i];
        inSig[i].inputs[1] <== inCommit[i].out;
        inSig[i].inputs[2] <== inPathIndex[i];

        // nullifier = Poseidon3(commitment, pathIndex, signature)
        inNull[i] = Poseidon(3);
        inNull[i].inputs[0] <== inCommit[i].out;
        inNull[i].inputs[1] <== inPathIndex[i];
        inNull[i].inputs[2] <== inSig[i].out;
        inNull[i].out === inputNullifier[i];

        // range: amount fits in `amountBits` bits
        inRange[i] = Num2Bits(amountBits);
        inRange[i].in <== inAmount[i];

        // Merkle membership, enforced only when amount != 0
        inAmtIsZero[i] = IsZero();
        inAmtIsZero[i].in <== inAmount[i];

        inMerkle[i] = MerkleRootFromPath(levels);
        inMerkle[i].leaf <== inCommit[i].out;
        for (var l = 0; l < levels; l++) {
            inMerkle[i].pathLeft[l] <== inPathLeft[i][l];
            inMerkle[i].pathRight[l] <== inPathRight[i][l];
        }
        // (computedRoot - root) must be 0 unless amount == 0
        (inMerkle[i].root - root) * (1 - inAmtIsZero[i].out) === 0;

        sumIns += inAmount[i];
    }

    // ── Outputs ──
    component outCommit[nOuts];
    component outRange[nOuts];
    var sumOuts = 0;
    for (var i = 0; i < nOuts; i++) {
        outCommit[i] = Poseidon(4);
        outCommit[i].inputs[0] <== outAmount[i];
        outCommit[i].inputs[1] <== outPubkey[i];
        outCommit[i].inputs[2] <== outBlinding[i];
        outCommit[i].inputs[3] <== vortex;
        outCommit[i].out === outputCommitment[i];

        outRange[i] = Num2Bits(amountBits);
        outRange[i].in <== outAmount[i];

        sumOuts += outAmount[i];
    }

    // ── No duplicate nullifiers (nIns == 2) ──
    component nullEq = IsEqual();
    nullEq.in[0] <== inputNullifier[0];
    nullEq.in[1] <== inputNullifier[1];
    nullEq.out === 0;

    // ── Conservation: Σin + publicAmount == Σout ──
    sumIns + publicAmount === sumOuts;
}

component main {
    public [
        vortex,
        root,
        publicAmount,
        inputNullifier,
        outputCommitment,
        hashedAccountSecret
    ]
} = Transaction(26, 2, 2, 248);
