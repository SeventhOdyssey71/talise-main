#!/usr/bin/env node
/**
 * Probe: build the EXACT gasless PTB that `sponsor-prepare/route.ts`
 * builds in its USDsui try-block, using the real `sui()` proxy client.
 *
 * Extended (2026-05-29): also probes COMPOSITE PTB shapes that try to
 * consolidate legacy `Coin<USDSUI>` into the Address Balance accumulator
 * BEFORE the `withdrawal + send_funds` leg, and an alternative
 * `coin::send_funds<T>(Coin<T>, address)` direct gasless shape. For each
 * shape we capture both `tx.build()` outcome and (if build succeeds)
 * `simulateTransaction` so we can see whether validators accept the PTB
 * without a gas coin.
 *
 * Usage:
 *   node scripts/probe-gasless-build.mjs [sender] [recipient] [amount-usdsui]
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SENDER =
  process.argv[2] ??
  // The user holding 428,001 µ in legacy Coin objects + 3,788 µ in accumulator.
  "0xb9aad5433f0d3b76e35d9985706b3fa9e571262f2fa1f12043589ca681d2866c";
const RECIPIENT =
  process.argv[3] ??
  // Throwaway recipient — gasless build doesn't care, validators
  // accept any address.
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const AMOUNT_USDSUI = process.argv[4] ?? "0.001";

const testFile = join(
  process.cwd(),
  "__tests__",
  "sui",
  "_probe-gasless.test.ts"
);

const src = `
import { it } from "vitest";
import { Transaction } from "@mysten/sui/transactions";
import { sui } from "../../lib/sui";
import { USDSUI_TYPE } from "../../lib/usdsui";

const SENDER = ${JSON.stringify(SENDER)};
const RECIPIENT = ${JSON.stringify(RECIPIENT)};
const amountNum = Number(${JSON.stringify(AMOUNT_USDSUI)});
const onchain = BigInt(Math.round(amountNum * 1e6));

async function tryBuildAndSimulate(label: string, build: (tx: Transaction) => void | Promise<void>) {
  const client = sui();
  const tx = new Transaction();
  tx.setSender(SENDER);
  try {
    await build(tx);
    tx.setGasPrice(0n);
  } catch (e) {
    console.log(\`[\${label}] CONSTRUCT_ERR: \${(e as Error).message}\`);
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await tx.build({ client: client as never });
    console.log(\`[\${label}] BUILD_OK bytes=\${bytes.length}\`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.log(\`[\${label}] BUILD_ERR: \${msg.slice(0, 400)}\`);
    return;
  }
  // Try simulating without a gas coin — the validators only accept
  // gas-free submission for allowlisted PTB shapes.
  try {
    const svc = (client as any).transactionExecutionService;
    if (!svc || typeof svc.simulateTransaction !== "function") {
      console.log(\`[\${label}] SIMULATE_SKIP no transactionExecutionService.simulateTransaction\`);
      return;
    }
    const result = await (client as any).simulateTransaction({ transaction: bytes });
    const eff = result?.transaction?.effects ?? result?.effects;
    const status = eff?.status?.success ?? eff?.status?.Success ?? JSON.stringify(eff?.status ?? eff).slice(0, 200);
    const err = eff?.status?.error ?? eff?.error ?? null;
    console.log(\`[\${label}] SIMULATE_RESULT status=\${JSON.stringify(status)} err=\${JSON.stringify(err)?.slice(0,400) ?? 'null'}\`);
  } catch (e) {
    console.log(\`[\${label}] SIMULATE_ERR: \${((e as Error).message ?? String(e)).slice(0, 500)}\`);
  }
}

it("probe gasless build (multi-shape)", async () => {
  const client = sui();
  // 1. State snapshot
  let bal: any, coins: any;
  try {
    bal = await (client as any).getBalance({ owner: SENDER, coinType: USDSUI_TYPE });
    console.log("__BALANCE__", JSON.stringify(bal));
  } catch (e) {
    console.log("__BALANCE_ERR__", (e as Error).message);
  }
  try {
    coins = await (client as any).listCoins({ owner: SENDER, coinType: USDSUI_TYPE });
    const arr = coins?.objects ?? coins?.coins ?? coins?.data ?? [];
    console.log("__COINS__ count=" + arr.length + " ids=" + JSON.stringify(arr.map((c: any) => ({
      id: c.coinObjectId ?? c.id ?? c.objectId,
      balance: c.balance ?? c.amount,
    }))));
  } catch (e) {
    console.log("__COINS_ERR__", (e as Error).message);
  }

  // SHAPE A: current canonical gasless (balance::send_funds from withdrawal).
  await tryBuildAndSimulate("A_withdrawal_send_funds", (tx) => {
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDSUI_TYPE],
      arguments: [
        tx.withdrawal({ amount: onchain, type: USDSUI_TYPE }),
        tx.pure.address(RECIPIENT),
      ],
    });
  });

  // SHAPE B: direct \`coin::send_funds<T>(Coin<T>, address)\` — found in
  // \`0x2::coin\` module enumeration. If allowlisted gasless, this is the
  // simplest path: ship coin objects directly without accumulator round-trip.
  const coinList = (coins?.objects ?? coins?.coins ?? coins?.data ?? []) as any[];
  if (coinList.length > 0) {
    await tryBuildAndSimulate("B_coin_send_funds_direct", (tx) => {
      // Use the first coin object that has enough balance, or join all.
      const first = coinList[0];
      const firstId = first.coinObjectId ?? first.id ?? first.objectId;
      const firstBal = BigInt(first.balance ?? first.amount ?? "0");
      let source = tx.object(firstId);
      if (firstBal < onchain && coinList.length > 1) {
        const rest = coinList.slice(1).map((c) => tx.object(c.coinObjectId ?? c.id ?? c.objectId));
        tx.moveCall({
          target: "0x2::pay::join_vec",
          typeArguments: [USDSUI_TYPE],
          arguments: [source, tx.makeMoveVec({ type: \`0x2::coin::Coin<\${USDSUI_TYPE}>\`, elements: rest })],
        });
      }
      // Split off the exact amount so we don't drain the source coin.
      const [split] = tx.splitCoins(source, [tx.pure.u64(onchain)]);
      tx.moveCall({
        target: "0x2::coin::send_funds",
        typeArguments: [USDSUI_TYPE],
        arguments: [split, tx.pure.address(RECIPIENT)],
      });
    });
  } else {
    console.log("[B_coin_send_funds_direct] SKIP no legacy Coin objects to source from");
  }

  // SHAPE B2: \`pay::join_vec_and_transfer\` to self to consolidate to a
  // single Coin, then \`coin::send_funds\`. Tests whether COIN-side
  // primitives are on the allowlist.
  if (coinList.length > 0) {
    await tryBuildAndSimulate("B2_coin_send_funds_no_join", (tx) => {
      const big = coinList.find((c) => BigInt(c.balance) >= onchain) ?? coinList[0];
      const id = big.objectId;
      const [split] = tx.splitCoins(tx.object(id), [tx.pure.u64(onchain)]);
      tx.moveCall({
        target: "0x2::coin::send_funds",
        typeArguments: [USDSUI_TYPE],
        arguments: [split, tx.pure.address(RECIPIENT)],
      });
    });
  }

  // SHAPE C: composite — try \`funds_accumulator::add_impl\` to deposit into
  // the accumulator first. We expect this to fail with \"function is internal\"
  // or similar; capturing the exact build error so we know the primitive
  // isn't reachable from a PTB.
  if (coinList.length > 0) {
    await tryBuildAndSimulate("C_funds_accumulator_add_impl_prefix", (tx) => {
      const first = coinList[0];
      const firstId = first.coinObjectId ?? first.id ?? first.objectId;
      // coin -> balance, then add_impl(balance, sender)
      const [balOut] = [tx.moveCall({
        target: "0x2::coin::into_balance",
        typeArguments: [USDSUI_TYPE],
        arguments: [tx.object(firstId)],
      })];
      tx.moveCall({
        target: "0x2::funds_accumulator::add_impl",
        typeArguments: [\`0x2::balance::Balance<\${USDSUI_TYPE}>\`],
        arguments: [balOut, tx.pure.address(SENDER)],
      });
      tx.moveCall({
        target: "0x2::balance::send_funds",
        typeArguments: [USDSUI_TYPE],
        arguments: [
          tx.withdrawal({ amount: onchain, type: USDSUI_TYPE }),
          tx.pure.address(RECIPIENT),
        ],
      });
    });
  }

  // SHAPE D: simple transferObjects of a coin (no send_funds, no withdrawal).
  // Tests whether the plain transfer path is gasless-allowlisted.
  if (coinList.length > 0) {
    await tryBuildAndSimulate("D_transfer_coin_object", (tx) => {
      const big = coinList.find((c) => BigInt(c.balance) >= onchain) ?? coinList[0];
      const id = big.objectId;
      const [split] = tx.splitCoins(tx.object(id), [tx.pure.u64(onchain)]);
      tx.transferObjects([split], tx.pure.address(RECIPIENT));
    });
  }

  console.log("__PROBE_DONE__");
}, 180_000);
`;

writeFileSync(testFile, src, "utf8");

const res = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    testFile,
    "--reporter=verbose",
    "--silent=false",
  ],
  { stdio: "inherit", cwd: process.cwd() }
);

try {
  spawnSync("rm", ["-f", testFile]);
} catch {
  /* leave it; not load-bearing */
}

process.exit(res.status ?? 0);
