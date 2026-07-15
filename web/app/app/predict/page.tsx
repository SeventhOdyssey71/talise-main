"use client";

/**
 * PREDICT — WaterX prediction markets in the standard Talise app UI (light,
 * inside the app shell). Binary YES/NO markets that settle in USDsui and share
 * the same waterx_account as perps. Gated behind FEATURE_PERPS.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { signSponsorReadyBytes, friendlyError } from "@/components/app/cheques/signBytes";

type Market = { key: string; marketId: string; title?: string; imageUrl?: string; yesPct: number; noPct: number; yesPrice: number; noPrice: number; volumeUsd: number; resolved: boolean; outcome: string | null };
type Position = { positionId: string; marketId: string; marketKey: string; selection: string; shares: number; cost: number; payout: number; resolved: boolean; outcome: string | null; won: boolean };

const INK = "#15300c", YES = "#2f9e44", NO = "#e0574f", MINT = "#CAFFB8";
const mono = "'Google Sans Variable', var(--font-sans-v2), system-ui, sans-serif";
const short = (s?: string) => (s && s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || "");
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const CARD = "rounded-2xl border border-[#15300c]/10 bg-[#f7fcf2]";
const LABEL = "tabular-nums text-[10.5px] uppercase tracking-[0.14em] text-[#7a8a72]";

export default function PredictPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [account, setAccount] = useState<{ accountId: string | null; availableUsd?: number }>({ accountId: null });
  const [positions, setPositions] = useState<Position[]>([]);
  const [pick, setPick] = useState<{ market: Market; side: "YES" | "NO" } | null>(null);
  const [betUsd, setBetUsd] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const flash = (ok: boolean, msg: string) => { setToast({ ok, msg }); window.clearTimeout((flash as unknown as { _t?: number })._t); (flash as unknown as { _t?: number })._t = window.setTimeout(() => setToast(null), 5000); };

  const loadMarkets = useCallback(async () => { try { const r = await fetch("/api/predict/markets"); if (r.status === 503) { setDisabled(true); return; } const j = await r.json(); setMarkets(j.markets ?? []); } catch { /* */ } }, []);
  const loadAccount = useCallback(async () => { try { const r = await fetch("/api/markets/account"); if (r.ok) setAccount(await r.json()); } catch { /* */ } }, []);
  const loadPositions = useCallback(async () => { try { const r = await fetch("/api/predict/positions"); if (r.ok) { const j = await r.json(); setPositions(j.positions ?? []); } } catch { /* */ } }, []);

  useEffect(() => { loadMarkets(); loadAccount(); loadPositions(); const m = window.setInterval(loadMarkets, 8000); const p = window.setInterval(loadPositions, 10000); return () => { window.clearInterval(m); window.clearInterval(p); }; }, [loadMarkets, loadAccount, loadPositions]);

  const available = account.availableUsd ?? 0;
  const price = pick ? (pick.side === "YES" ? pick.market.yesPrice : pick.market.noPrice) : 0;
  const estShares = price > 0 ? betUsd / price : 0;

  const runAction = async (url: string, body: unknown): Promise<{ digest?: string; mode?: string; bytes?: string }> => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status, code: j.code });
    if (j.mode === "sponsored" && j.bytes) { const { digest } = await signSponsorReadyBytes(j.bytes, { via: "predict" }); return { ...j, digest }; }
    return j;
  };
  const doBet = async () => {
    if (!pick) return;
    if (!account.accountId) return flash(false, "Create a trading account in Markets first");
    setBusy("bet");
    try { const j = await runAction("/api/predict/order", { marketId: pick.market.marketId, selection: pick.side, betUsd, price }); flash(true, `Bet $${betUsd} on ${pick.side}${j.digest ? " · " + short(j.digest) : ""}`); await Promise.all([loadAccount(), loadPositions()]); }
    catch (e) { flash(false, friendlyError(e, (e as Error).message)); } finally { setBusy(null); }
  };
  const doClaim = async (p: Position) => { setBusy("claim:" + p.positionId); try { const j = await runAction("/api/predict/claim", { positionIds: [p.positionId] }); flash(true, `Claimed $${p.payout.toFixed(2)}${j.digest ? " · " + short(j.digest) : ""}`); await Promise.all([loadAccount(), loadPositions()]); } catch (e) { flash(false, friendlyError(e, (e as Error).message)); } finally { setBusy(null); } };

  const open = useMemo(() => positions.filter((p) => !p.resolved), [positions]);
  const claimable = useMemo(() => positions.filter((p) => p.resolved && p.won && p.payout > 0), [positions]);

  if (disabled) return <div className={`${CARD} p-6`}><div className="text-[18px] font-semibold text-[#15300c]">Prediction is off</div><p className="mt-1 text-[14px] text-[#3a5230]">Set <code>FEATURE_PERPS=true</code> and restart the dev server.</p></div>;

  return (
    <div className="space-y-5 text-[#15300c]" style={{ fontFamily: "'Google Sans Variable', var(--font-sans-v2), system-ui, sans-serif" }}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-[800] uppercase tracking-[-0.02em]" style={{ fontFamily: "var(--font-display-v2)" }}>Predict</h1>
          <p className="mt-0.5 text-[13px] text-[#3a5230]">Bet YES/NO with your USDsui, gasless. <span className="text-[#2f6d1f]">{markets.length} live markets on WaterX.</span></p>
        </div>
        <div className={`${CARD} px-4 py-2`}><div className={LABEL}>Available</div><div className="tabular-nums text-[18px] font-bold" style={{ color: available > 0 ? "#2f6d1f" : INK }}>${available.toFixed(2)}</div></div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* markets */}
        <div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {markets.map((m) => {
              const sel = pick?.market.key === m.key;
              return (
                <div key={m.key} className={`${CARD} p-4`} style={sel ? { borderColor: INK, boxShadow: "4px 4px 0 #15300c" } : {}}>
                  <div className="flex items-start gap-2.5">
                    {m.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={m.imageUrl} alt="" width={34} height={34} className="flex-none rounded-lg object-cover" style={{ width: 34, height: 34 }} />
                      : <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg bg-[#CAFFB8] text-[13px] font-bold text-[#15300c]">?</span>}
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[14.5px] font-semibold leading-snug">{m.title ?? `Market #${m.key}`}</div>
                      <div className="tabular-nums text-[11px] text-[#7a8a72]">${fmtK(m.volumeUsd)} vol · #{m.key}</div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-[#15300c]/8">
                    <span style={{ width: `${m.yesPct}%`, background: YES }} />
                    <span style={{ width: `${m.noPct}%`, background: NO }} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => setPick({ market: m, side: "YES" })} className="rounded-xl border py-2.5 text-[14px] font-semibold" style={{ borderColor: YES, background: sel && pick?.side === "YES" ? YES : "rgba(47,158,68,0.08)", color: sel && pick?.side === "YES" ? "#fff" : YES }}>YES · {m.yesPct}%</button>
                    <button onClick={() => setPick({ market: m, side: "NO" })} className="rounded-xl border py-2.5 text-[14px] font-semibold" style={{ borderColor: NO, background: sel && pick?.side === "NO" ? NO : "rgba(224,87,79,0.08)", color: sel && pick?.side === "NO" ? "#fff" : NO }}>NO · {m.noPct}%</button>
                  </div>
                </div>
              );
            })}
            {!markets.length && <div className="text-[#7a8a72]">Loading live markets…</div>}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[#7a8a72]">Cards show market IDs — WaterX keeps question text off-chain, so add their metadata endpoint to show &ldquo;Will BTC hit $100k?&rdquo; instead. Odds, bets, and payouts are all on-chain and live.</p>
        </div>

        {/* bet slip + positions */}
        <div className="space-y-4">
          <div className={`${CARD} p-4`}>
            <div className="mb-2 text-[15px] font-semibold">Bet slip</div>
            {!pick ? (
              <div className="py-6 text-center text-[13px] text-[#7a8a72]">Pick YES or NO on a market to bet.</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-[#eef6e7] px-3 py-2.5">
                  <span className="line-clamp-2 text-[13.5px] font-semibold">{pick.market.title ?? `Market #${pick.market.key}`}</span>
                  <span className="flex-none font-bold" style={{ color: pick.side === "YES" ? YES : NO }}>{pick.side} · {(price * 100).toFixed(0)}%</span>
                </div>
                <label className="mt-3 block"><span className={LABEL}>Bet amount (USDsui)</span>
                  <div className="mt-1 flex items-center rounded-xl border border-[#15300c]/15 bg-white px-2"><span className="text-[#7a8a72]">$</span><input type="number" min={0} step={0.5} value={betUsd} onChange={(e) => setBetUsd(Math.max(0, Number(e.target.value)))} className="w-full bg-transparent px-1 py-2.5 tabular-nums text-[18px] outline-none" /></div>
                </label>
                <div className="mt-3 space-y-1 text-[12.5px] text-[#3a5230]">
                  <div className="flex justify-between"><span>Est. shares</span><span className="tabular-nums text-[#15300c]">{estShares.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Wins pay</span><span className="tabular-nums" style={{ color: YES }}>${estShares.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>If wrong</span><span className="tabular-nums" style={{ color: NO }}>-${betUsd.toFixed(2)}</span></div>
                </div>
                <button onClick={doBet} disabled={!!busy || betUsd <= 0} className="mt-3 w-full rounded-xl py-3 text-[15px] font-bold text-white disabled:opacity-50" style={{ background: pick.side === "YES" ? YES : NO }}>{busy === "bet" ? "…" : `Buy ${pick.side} · $${betUsd}`}</button>
                {!account.accountId && <p className="mt-2 text-[11px] text-[#7a8a72]">Create a trading account in Markets first (shared with prediction).</p>}
              </>
            )}
          </div>

          {claimable.length > 0 && (
            <div className={`${CARD} p-4`}>
              <div className="mb-2 text-[14px] font-semibold" style={{ color: YES }}>Claimable</div>
              {claimable.map((p) => (
                <div key={p.positionId} className="mb-2 flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "rgba(47,158,68,0.08)", border: `1px solid ${YES}` }}>
                  <span className="text-[13px]">#{p.marketKey} · {p.selection} won</span>
                  <button onClick={() => doClaim(p)} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: YES }}>{busy === "claim:" + p.positionId ? "…" : `Claim $${p.payout.toFixed(2)}`}</button>
                </div>
              ))}
            </div>
          )}

          <div className={`${CARD} p-4`}>
            <div className="mb-2 text-[14px] font-semibold">My bets{open.length ? ` (${open.length})` : ""}</div>
            {open.length === 0 ? <div className="text-[12.5px] text-[#7a8a72]">No open bets yet.</div> : open.map((p) => (
              <div key={p.positionId} className="mb-2 rounded-xl bg-[#eef6e7] px-3 py-2.5 text-[12.5px]">
                <div className="flex items-center justify-between"><span className="font-semibold">#{p.marketKey}</span><span className="font-bold" style={{ color: p.selection === "YES" ? YES : NO }}>{p.selection}</span></div>
                <div className="mt-1 flex justify-between tabular-nums text-[#3a5230]"><span>{p.shares.toFixed(2)} shares</span><span>cost ${p.cost.toFixed(2)}</span><span style={{ color: YES }}>→ ${p.shares.toFixed(2)}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {toast && <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-4 py-2.5 text-[13px] font-medium text-white lg:bottom-6" style={{ background: toast.ok ? "#3d7a29" : NO, boxShadow: "0 10px 30px -8px rgba(21,48,12,0.4)" }}>{toast.msg}</div>}
    </div>
  );
}
