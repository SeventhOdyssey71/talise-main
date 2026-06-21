// One-shot: split the relayer's USDsui coin into an EXACT $10 deposit coin +
// remainder, both owned by the relayer. Signed with SHIELD_RELAYER_SK.
// Prints DEPOSIT_COIN_ID ($10) + the remainder coin id (ZERO_COIN_SOURCE_ID).
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
const { sui } = await import("../lib/sui.ts");

const COIN_TYPE =
  "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI";
const SRC = "0xdaa807c480422a586c4034a1d53fcb9e21982666eeb20688da98faac23ee014c";
const AMOUNT = 10_000_000n;

const sk = process.env.SHIELD_RELAYER_SK;
if (!sk) throw new Error("SHIELD_RELAYER_SK missing");
const kp = Ed25519Keypair.fromSecretKey(sk);
const addr = kp.toSuiAddress();
console.log("relayer", addr);

const RPC = "https://fullnode.mainnet.sui.io:443";
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
// Pin owned-object refs via JSON-RPC (grpc resolution is flaky from here).
function jsonRpcResolutionPlugin() {
  return async (td, _o, next) => {
    const ids = new Set();
    for (const inp of td.inputs)
      if (inp.$kind === "UnresolvedObject" && inp.UnresolvedObject?.objectId)
        ids.add(inp.UnresolvedObject.objectId);
    if (ids.size) {
      const objs = await rpc("sui_multiGetObjects", [[...ids], { showOwner: true }]);
      const by = new Map();
      for (const o of objs)
        if (o?.data) by.set(o.data.objectId, { version: String(o.data.version), digest: o.data.digest });
      for (const inp of td.inputs) {
        if (inp.$kind !== "UnresolvedObject") continue;
        const info = by.get(inp.UnresolvedObject.objectId);
        if (!info) throw new Error(`object not found: ${inp.UnresolvedObject.objectId}`);
        const id = inp.UnresolvedObject.objectId;
        delete inp.UnresolvedObject;
        inp.$kind = "Object";
        inp.Object = { $kind: "ImmOrOwnedObject", ImmOrOwnedObject: { objectId: id, version: info.version, digest: info.digest } };
      }
    }
    await next();
  };
}
const client = sui();
const tx = new Transaction();
tx.setSender(addr);
tx.setGasBudget(10_000_000n);
const [ten] = tx.splitCoins(tx.object(SRC), [tx.pure.u64(AMOUNT)]);
tx.transferObjects([ten], addr); // keep $10 coin owned by relayer (becomes DEPOSIT_COIN_ID)
tx.addBuildPlugin(jsonRpcResolutionPlugin());

const res = await client.signAndExecuteTransaction({
  signer: kp,
  transaction: tx,
  options: { showEffects: true, showObjectChanges: true },
});
console.log("split digest:", res.digest, res.effects?.status?.status);
await client.waitForTransaction({ digest: res.digest });

// Enumerate relayer USDsui coins post-split (via JSON-RPC).
const coinsRes = await rpc("suix_getCoins", [addr, COIN_TYPE]);
console.log("\nrelayer USDsui coins after split:");
let ten10, rem;
for (const c of coinsRes.data) {
  const v = BigInt(c.balance);
  const tag = v === AMOUNT ? "  <- DEPOSIT_COIN_ID ($10 exact)" : "  <- ZERO_COIN_SOURCE_ID (remainder)";
  console.log(" ", c.coinObjectId, Number(v) / 1e6, "USDsui", tag);
  if (v === AMOUNT) ten10 = c.coinObjectId;
  else rem = c.coinObjectId;
}
console.log("\nDEPOSIT_COIN_ID=" + ten10);
console.log("ZERO_COIN_SOURCE_ID=" + rem);
