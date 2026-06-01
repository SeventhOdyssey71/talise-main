import { network } from "@/lib/sui";

/**
 * Banner shown on dashboards explaining the current Sui network. Testnet
 * messaging is louder because users need to know they're using test funds,
 * not real ones.
 */
export function NetworkBanner() {
  const net = network();
  if (net === "mainnet") {
    return null;
  }
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-[#d97706]/25 bg-[#d97706]/[0.06] px-4 py-2.5 text-[12px]">
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[#92400e]">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#d97706]" />
        sui testnet
      </span>
      <span className="text-[#92400e]/85">
        Test funds only. Grab some from{" "}
        <a
          href="https://faucet.sui.io"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-[#78350f]"
        >
          faucet.sui.io
        </a>
        . Mainnet sign-in is gated by Mysten&apos;s zk-prover audience
        whitelist; we&apos;re using the open testnet prover here.
      </span>
    </div>
  );
}
