#!/usr/bin/env node
/**
 * Probe: build the EXACT gasless PTB that `sponsor-prepare/route.ts`
 * builds in its USDsui try-block, using the real `sui()` proxy client.
 *
 * If the route's catch is silently falling through, this probe surfaces
 * the underlying exception. Runs against mainnet using the admin
 * tester's resolved Sui address.
 *
 * Usage:
 *   node scripts/probe-gasless-build.mjs [sender] [recipient] [amount-usdsui]
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SENDER =
  process.argv[2] ??
  // eromonsele.talise.sui — admin tester.
  "0x156a95a023b61177558de1de36409acf7f72417f9ca21a3a1e903e3b52283743";
const RECIPIENT =
  process.argv[3] ??
  // Throwaway recipient — gasless build doesn't care, validators
  // accept any address.
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const AMOUNT_USDSUI = process.argv[4] ?? "0.01";

const testFile = join(
  process.cwd(),
  "__tests__",
  "sui",
  "_probe-gasless.test.ts"
);

const src = `
import { it } from "vitest";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { sui } from "../../lib/sui";
import { USDSUI_TYPE } from "../../lib/usdsui";

it("probe gasless build", async () => {
  const SENDER = ${JSON.stringify(SENDER)};
  const RECIPIENT = ${JSON.stringify(RECIPIENT)};
  const amountNum = Number(${JSON.stringify(AMOUNT_USDSUI)});
  const onchain = BigInt(Math.round(amountNum * 1e6));

  const client = sui();
  const tx = new Transaction();
  tx.setSender(SENDER);
  const coin = tx.add(
    coinWithBalance({
      type: USDSUI_TYPE,
      balance: onchain,
      useGasCoin: false,
    })
  );
  tx.moveCall({
    target: "0x2::coin::send_funds",
    typeArguments: [USDSUI_TYPE],
    arguments: [coin, tx.pure.address(RECIPIENT)],
  });
  tx.setGasPrice(0n);

  try {
    const bytes = await tx.build({ client });
    console.log("__PROBE_OK__", bytes.length);
  } catch (err) {
    console.log("__PROBE_ERR_MSG__", (err && err.message) || String(err));
    console.log("__PROBE_ERR_STACK__");
    console.log((err && err.stack) || "(no stack)");
    throw err;
  }
}, 60_000);
`;

writeFileSync(testFile, src, "utf8");

const res = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.integration.config.ts", testFile],
  { stdio: "inherit", cwd: process.cwd() }
);

try {
  spawnSync("rm", ["-f", testFile]);
} catch {
  /* leave it; not load-bearing */
}

process.exit(res.status ?? 0);
