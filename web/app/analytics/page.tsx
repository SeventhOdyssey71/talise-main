import { getPublicAnalytics } from "@/lib/analytics";
import { ensureAnalyticsSchema, getSnapshots } from "@/lib/analytics/store";
import type { AnalyticsSnapshot } from "@/lib/analytics/types";

// Public, aggregate-only network metrics + an append-only checkpoint timeline.
// Anyone can see this (no auth). The admin network dashboard (per-user, live
// feed) stays at /dashboard-analytics.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Talise, live network metrics",
  description:
    "Live, on-chain Talise metrics with a public checkpoint history. Every figure is a real count from Sui mainnet.",
};

const C = {
  canvas: "#ecefe8",
  panel: "#f5f7f2",
  white: "#ffffff",
  ink: "#121a0f",
  muted: "#55634e",
  dim: "#8a9784",
  line: "rgba(18,26,15,0.14)",
  forest: "#2f6a1f",
};
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const nfmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
function stamp(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const day = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${day} · ${time} UTC`;
}

function Metric({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        padding: "18px 20px",
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 34,
          letterSpacing: "-0.02em",
          color: C.forest,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.dim,
          marginTop: 10,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default async function AnalyticsPage() {
  await ensureAnalyticsSchema().catch(() => {});
  const [data, checkpoints] = await Promise.all([
    getPublicAnalytics().catch(() => null),
    getSnapshots(90).catch((): AnalyticsSnapshot[] => []),
  ]);

  const settled = data?.settled ?? { volumeUsd: 0, txCount: 0, activeAccounts: 0 };
  const community = data?.community ?? { accounts: 0, waitlist: 0 };
  const privacy = data?.privacy ?? { notes: 0, spent: 0 };
  const corridors = data?.corridors ?? [];

  const th: React.CSSProperties = {
    textAlign: "left",
    fontFamily: MONO,
    fontSize: 10.5,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.dim,
    fontWeight: 500,
    padding: "12px 14px",
    borderBottom: `1px solid ${C.line}`,
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 13,
    color: C.ink,
    padding: "12px 14px",
    borderBottom: `1px solid ${C.line}`,
    whiteSpace: "nowrap",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: C.canvas,
        color: C.ink,
        fontFamily: SANS,
        padding: "56px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: C.forest,
          }}
        >
          Talise · live network metrics
        </div>
        <h1
          style={{
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: "14px 0 0",
            maxWidth: 640,
          }}
        >
          The numbers, on-chain.
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.5,
            color: C.muted,
            margin: "14px 0 0",
            maxWidth: 640,
          }}
        >
          Every figure is a live count from Sui mainnet, aggregate-only, no
          personal data. A new checkpoint is saved each time the on-chain index
          refreshes and the numbers move, so this timeline is a public,
          append-only record of how the network grows.
        </p>

        {/* current metrics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginTop: 34,
          }}
        >
          <Metric value={nfmt(community.accounts)} label="Accounts created" />
          <Metric value={nfmt(settled.txCount)} label="On-chain transactions" />
          <Metric value={usd(settled.volumeUsd)} label="Volume on-chain" />
          <Metric value={nfmt(settled.activeAccounts)} label="Active accounts" />
          <Metric value={nfmt(privacy.spent)} label="Private sends" />
          <Metric value={nfmt(community.waitlist)} label="Waitlist" />
        </div>

        {corridors.length > 0 && (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 12,
              color: C.muted,
              marginTop: 16,
            }}
          >
            Corridors:{" "}
            {corridors
              .slice(0, 6)
              .map((c) => `${c.from}→${c.to} (${c.count})`)
              .join("  ·  ")}
          </div>
        )}

        {/* checkpoint timeline */}
        <div style={{ marginTop: 44 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Checkpoints
            </h2>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.dim }}>
              {checkpoints.length} recorded · newest first
            </span>
          </div>

          {checkpoints.length === 0 ? (
            <div
              style={{
                background: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: 10,
                padding: "22px 20px",
                fontFamily: MONO,
                fontSize: 13,
                color: C.muted,
              }}
            >
              No checkpoints yet. The first one is written the next time the
              on-chain index completes a full pass.
            </div>
          ) : (
            <div
              style={{
                background: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: 10,
                overflowX: "auto",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 640,
                }}
              >
                <thead>
                  <tr>
                    <th style={th}>Checkpoint</th>
                    <th style={{ ...th, textAlign: "right" }}>Accounts</th>
                    <th style={{ ...th, textAlign: "right" }}>Txs</th>
                    <th style={{ ...th, textAlign: "right" }}>Volume</th>
                    <th style={{ ...th, textAlign: "right" }}>Active</th>
                    <th style={{ ...th, textAlign: "right" }}>Private</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpoints.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>{stamp(s.createdAt)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {nfmt(s.accounts)}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {nfmt(s.txCount)}
                      </td>
                      <td
                        style={{ ...td, textAlign: "right", color: C.forest }}
                      >
                        {usd(s.volumeUsd)}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {nfmt(s.activeAccounts)}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {nfmt(s.privateSpent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.08em",
            color: C.dim,
            marginTop: 34,
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span>talise.io · live on Sui mainnet</span>
          <a
            href="/api/analytics/checkpoints"
            style={{ color: C.forest, textDecoration: "none" }}
          >
            JSON · /api/analytics/checkpoints
          </a>
        </div>
      </div>
    </main>
  );
}
