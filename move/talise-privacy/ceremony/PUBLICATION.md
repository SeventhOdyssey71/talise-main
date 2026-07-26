# What gets published, and where

A ceremony nobody can check is theatre. Everything below must be public,
timestamped, and reachable without asking Talise for anything. If an item cannot
be published, the ceremony has not happened.

## The manifest

One file, `ceremony/MANIFEST.md`, committed to the public repo and linked from
the app's privacy documentation. It contains:

| field | value |
|---|---|
| circuit source commit | git SHA of `move/talise-privacy` at ceremony time |
| `circuit.r1cs` | sha256 + the exact command that regenerates it from source |
| Phase-1 transcript | `powersOfTau28_hez_final_15.ptau`, size `37831832`, BLAKE2b-512 `982372c8…2969ae6e`, plus the snarkjs README URL where that digest is published |
| `ceremony_0000.zkey` | sha256 (deterministic — anyone can re-derive it) |
| each contribution | index, contributor name, sha256 of their output zkey, snarkjs contribution hash, link to their own signed attestation |
| beacon commitment | the announcement (drand chain hash, round number, iterations exp) **and a link proving it was published before that round occurred** |
| beacon value | the drand randomness, and the API URL to re-fetch it |
| `ceremony_final.zkey` | sha256 |
| `verification_key.json` | sha256 |
| `vk_sui.hex` | the 520-byte hex, its sha256, and the Sui package + pool object ID that binds it |
| verification command | the single `ceremony/verify.sh` invocation that checks all of the above |

## The artefacts

| artefact | where | why |
|---|---|---|
| `circuit.r1cs` | public repo (or a release asset if too large) | without it nobody can verify descent — `snarkjs zkey verify` needs it |
| `ceremony_0000.zkey` … `ceremony_final.zkey` | release assets / IPFS, with sha256 in the manifest | lets anyone re-walk the chain contribution by contribution |
| `verification_key.json` | public repo | the input to the Sui VK bytes |
| `vk_sui.hex` | public repo, and pasted into `sources/constants.move` | what the pool actually binds |
| per-contribution attestations | wherever the contributor chose to publish, linked from the manifest | the contributors' claims must be *theirs*, not ours. A file we host is a file we could have written |
| beacon announcement | a timestamped public post (and ideally an on-chain transaction or an OpenTimestamps stamp) made **before** the target round | the ordering is the whole security argument |

Host the large blobs somewhere content-addressed if you can (IPFS, Walrus).
Digests in the manifest make the host untrusted either way.

## Non-negotiables

1. **Contributors publish their own attestations.** Talise links to them; Talise
   does not host them as the primary copy.
2. **The beacon round is published before it exists.** Announce, wait, then
   finalise. If the announcement is not independently timestamped ahead of the
   round, the beacon adds nothing and the claim must be downgraded to "N-party
   ceremony without a beacon".
3. **`constants.move`'s header changes.** Its current text says the VK came from
   a single-party setup. That text must be replaced with the ceremony's
   provenance in the same commit that changes the key — never left stale.
4. **The old pool is not upgraded.** The VK binds at `new()`. Mint a fresh pool
   and state plainly which pool object holds ceremony-derived parameters and
   which does not.
5. **State the claim exactly as written in `CEREMONY.md` §4.** Not "trustless".
