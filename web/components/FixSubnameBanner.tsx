"use client";

import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import {
  signAndSubmit,
  hasEphemeralKey,
  triggerOauthSignIn,
} from "@/lib/zkclient";
import { ErrorBox } from "@/components/ErrorBox";

/**
 * One-tap "Fix resolution" — for users who hold one or more
 * `*.talise.sui` subname NFTs whose `targetAddress` is null. The user signs
 * a single sponsored PTB that calls SuiNS `set_target_address` on every
 * stale NFT they own, pointing them at their own Sui address.
 *
 * Only the NFT holder can sign for this. Talise can't repair these names
 * server-side — but Onara still sponsors the gas.
 */

export function FixSubnameBanner({
  stale,
  userAddress,
}: {
  stale: { nftId: string; fullName: string }[];
  userAddress: string;
}) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (stale.length === 0) return null;

  async function fix() {
    setErr(null);
    setRunning(true);
    try {
      if (!hasEphemeralKey()) {
        await triggerOauthSignIn({
          returnTo: window.location.pathname + window.location.search,
        });
        return;
      }

      // Lazy-load @mysten/suins so the dashboard doesn't ship it.
      // The underlying Sui RPC is GraphQL — `SuiGraphQLClient` implements
      // the unified `BaseClient` surface that `SuinsClient` accepts. The
      // banner only calls `SuinsTransaction.setTargetAddress`, which is a
      // pure PTB builder (no RPC) — the client is only kept around to
      // satisfy the SuinsClient constructor's type contract. The earlier
      // `JSON-RPC` client was a similar formality, just with a heavier
      // browser bundle footprint.
      const [{ SuinsClient, SuinsTransaction }, { suiGraphQLBrowser }] =
        await Promise.all([
          import("@mysten/suins"),
          import("./lib/sui-graphql-browser"),
        ]);
      const suins = new SuinsClient({
        client: suiGraphQLBrowser(),
        network: "mainnet",
      });

      await signAndSubmit(
        async (tx: Transaction) => {
          const sx = new SuinsTransaction(suins, tx);
          for (const s of stale) {
            sx.setTargetAddress({
              nft: s.nftId,
              address: userAddress,
              isSubname: true,
            });
          }
        },
        { senderAddress: userAddress }
      );

      // Reload so the banner disappears and resolution shows the new state.
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message ?? "Couldn't fix resolution.");
      setRunning(false);
    }
  }

  const list = stale.map((s) => s.fullName).join(", ");

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d97706]/25 bg-[#d97706]/[0.06] px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#92400e]">
          Resolution
        </div>
        <div className="mt-1 truncate text-[14px] text-[#92400e]" title={list}>
          {stale.length === 1 ? (
            <>
              <span className="font-mono">{stale[0].fullName}</span> doesn&apos;t
              resolve yet.
            </>
          ) : (
            <>
              <span className="font-mono">{stale.length} of your handles</span>{" "}
              don&apos;t resolve yet.
            </>
          )}{" "}
          <span className="text-[#92400e]/80">
            One tap to point them at your address.
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={fix}
        disabled={running}
        className="rounded-md bg-[#92400e] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#78350f] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? "Fixing…" : "Fix resolution"}
      </button>
      {err && (
        <div className="w-full">
          <ErrorBox message={err} />
        </div>
      )}
    </div>
  );
}
