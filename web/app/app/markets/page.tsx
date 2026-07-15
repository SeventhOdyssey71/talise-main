"use client";

/**
 * MARKETS — WaterX perps, in the standard Talise app UI (light, inside the app
 * shell). Live market data + the account → deposit → trade loop on the web
 * zkLogin + Onara sponsored rail. Gated behind FEATURE_PERPS.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TradeChart } from "@/components/app/markets/TradeChart";
import { AssetIcon } from "@/components/app/markets/AssetIcon";
import { PnLCard, type PnLCardData } from "@/components/app/markets/PnLCard";
import { signSponsorReadyBytes, friendlyError } from "@/components/app/cheques/signBytes";
import { assetMeta, CATEGORIES, type AssetCategory } from "@/lib/waterx-assets";

type Trade = { ts: number; type: string; ticker?: string; side?: string; sizeTokens?: number; priceUsd?: number; collateralUsd?: number; pnlUsd?: number; feeUsd?: number; digest?: string };

type Market = {
  symbol: string; name: string; sym: string; category: AssetCategory; marketId: string; paused: boolean; refPriceUsd: number; maxLeverage: number;
  longOiTokens: number; shortOiTokens: number; maxLongSize: number; maxShortSize: number;
  availLongSize: number; availShortSize: number; minCollUsd: number;
  maintenanceMarginPct: number; fundingRatePct: number; fundingIntervalHrs: number; tradingFeeBps: number;
};
type Quote = { spot?: number; change24h?: number; volume24h?: number };
type Position = { ticker: string; positionId: string; isLong: boolean; sizeTokens: number; collateralUsd: number; entryPriceUsd: number; markPriceUsd: number; liqPriceUsd: number; leverage: number; pnlUsd: number; hasTpSl: boolean };
type Account = { accountId: string | null; address?: string; availableUsd?: number; positions?: Position[] };

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const INK = "#15300c", LONG = "#2f9e44", SHORT = "#e0574f", MINT = "#CAFFB8";
const mono = "'Google Sans Variable', var(--font-sans-v2), system-ui, sans-serif";

const fmtP = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(3) : n.toFixed(4));
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(2)}K` : n.toFixed(2));
const short = (s?: string) => (s && s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s || "");

const CARD = "rounded-2xl border border-[#15300c]/10 bg-[#f7fcf2]";
const LABEL = "tabular-nums text-[10.5px] uppercase tracking-[0.14em] text-[#7a8a72]";
const INPUT = "w-full rounded-xl border border-[#15300c]/15 bg-white px-3 py-2.5 text-[15px] text-[#15300c] outline-none focus:border-[#15300c]/40";

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [sel, setSel] = useState("SUIUSD");
  const [interval, setInterval_] = useState("15m");
  const [quote, setQuote] = useState<Quote>({});
  const [account, setAccount] = useState<Account>({ accountId: null });
  const [isLong, setIsLong] = useState(true);
  const [leverage, setLeverage] = useState(10);
  const [sizeTokens, setSizeTokens] = useState(0);
  const [depositUsd, setDepositUsd] = useState(5);
  const [withdrawUsd, setWithdrawUsd] = useState(5);
  const [tpSlOn, setTpSlOn] = useState(false);
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<AssetCategory | "all">("all");
  const pickerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [posHeight, setPosHeight] = useState(176);
  const [posTab, setPosTab] = useState<"positions" | "history">("positions");
  const [history, setHistory] = useState<Trade[]>([]);
  const [pnlCard, setPnlCard] = useState<PnLCardData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false); // mobile order sheet
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = posHeight;
    const move = (ev: MouseEvent) => setPosHeight(Math.max(64, Math.min(560, startH - (ev.clientY - startY))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.userSelect = ""; };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const flash = (ok: boolean, msg: string) => { setToast({ ok, msg }); window.clearTimeout((flash as unknown as { _t?: number })._t); (flash as unknown as { _t?: number })._t = window.setTimeout(() => setToast(null), 5000); };

  const market = useMemo(() => markets.find((m) => m.symbol === sel), [markets, sel]);
  const price = quote.spot ?? market?.refPriceUsd ?? 0;
  const selMeta = assetMeta(sel);
  const filtered = useMemo(
    () => markets.filter((m) => (catFilter === "all" || m.category === catFilter) && (!search || m.name.toLowerCase().includes(search.toLowerCase()) || m.sym.toLowerCase().includes(search.toLowerCase()))),
    [markets, catFilter, search],
  );

  const loadMarkets = useCallback(async () => {
    try { const r = await fetch("/api/markets"); if (r.status === 503) { setDisabled(true); return; } const j = await r.json(); setMarkets(j.markets ?? []); } catch { /* */ }
  }, []);
  const loadQuote = useCallback(async (s: string) => { try { setQuote(await (await fetch(`/api/markets/quote?symbol=${s}`)).json()); } catch { /* */ } }, []);
  const loadAccount = useCallback(async () => { try { const r = await fetch("/api/markets/account"); if (r.ok) setAccount(await r.json()); } catch { /* */ } }, []);
  const loadHistory = useCallback(async () => { try { const r = await fetch("/api/markets/history"); if (r.ok) { const j = await r.json(); setHistory(j.trades ?? []); } } catch { /* */ } }, []);
  const record = useCallback((t: Omit<Trade, "ts">) => { fetch("/api/markets/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) }).then(() => loadHistory()).catch(() => {}); }, [loadHistory]);

  useEffect(() => { loadMarkets(); loadAccount(); loadHistory(); const m = window.setInterval(loadMarkets, 8000); const a = window.setInterval(loadAccount, 6000); return () => { window.clearInterval(m); window.clearInterval(a); }; }, [loadMarkets, loadAccount, loadHistory]);
  useEffect(() => { loadQuote(sel); const id = window.setInterval(() => loadQuote(sel), 3000); return () => window.clearInterval(id); }, [sel, loadQuote]);
  useEffect(() => { setLeverage((lv) => Math.min(lv, Math.max(1, Math.floor(market?.maxLeverage ?? 25))) || 10); }, [market?.maxLeverage]);

  const notionalUsd = sizeTokens * price;
  const marginUsd = leverage > 0 ? notionalUsd / leverage : 0;
  const mm = (market?.maintenanceMarginPct ?? 0) / 100;
  const liqPrice = sizeTokens > 0 && price > 0 ? (isLong ? price * (1 - 1 / leverage + mm) : price * (1 + 1 / leverage - mm)) : 0;
  const totalFeeUsd = notionalUsd * ((market?.tradingFeeBps ?? 0) / 1e4);
  const maxSize = isLong ? market?.availLongSize ?? 0 : market?.availShortSize ?? 0;
  const availableUsd = account.availableUsd ?? 0;
  const livePositions = (account.positions ?? []).map((p) => {
    const mark = p.ticker === sel ? (quote.spot ?? p.markPriceUsd) : p.markPriceUsd;
    const pnl = p.sizeTokens * (mark - p.entryPriceUsd) * (p.isLong ? 1 : -1);
    return { ...p, mark, pnl, pnlPct: p.collateralUsd > 0 ? (pnl / p.collateralUsd) * 100 : 0 };
  });
  const totalPnl = livePositions.reduce((s, p) => s + p.pnl, 0);

  const runAction = async (url: string, body: unknown): Promise<{ digest?: string; accountId?: string; mode?: string; bytes?: string; feeUsd?: number }> => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status, code: j.code });
    if (j.mode === "sponsored" && j.bytes) { const { digest } = await signSponsorReadyBytes(j.bytes, { via: "markets" }); return { ...j, digest }; }
    return j;
  };
  const doCreate = async () => { setBusy("create"); try { const j = await runAction("/api/markets/account", { op: "create", alias: "Talise" }); let id = j.accountId ?? null; if (!id && j.digest) id = (await runAction("/api/markets/account", { op: "link", digest: j.digest })).accountId ?? null; if (id) { setAccount((a) => ({ ...a, accountId: id })); flash(true, "Trading account ready"); } } catch (e) { flash(false, friendlyError(e, (e as Error).message)); } finally { setBusy(null); } };
  const doDeposit = async () => { if (!account.accountId) return doCreate(); setBusy("deposit"); try { const j = await runAction("/api/markets/account", { op: "deposit", accountId: account.accountId, amountUsd: depositUsd }); flash(true, `Deposited $${depositUsd} USDsui${j.digest ? " · " + short(j.digest) : ""}`); await loadAccount(); } catch (e) { flash(false, friendlyError(e, (e as Error).message)); } finally { setBusy(null); } };
  const doWithdraw = async () => { if (!account.accountId) return; setBusy("withdraw"); try { const j = await runAction("/api/markets/account", { op: "withdraw", accountId: account.accountId, amountUsd: withdrawUsd }); flash(true, `Withdrawing $${withdrawUsd}${j.digest ? " · " + short(j.digest) : ""}`); await loadAccount(); } catch (e) { flash(false, friendlyError(e, (e as Error).message)); } finally { setBusy(null); } };
  const doOrder = async () => {
    if (!account.accountId) return doCreate();
    if (sizeTokens <= 0) return flash(false, "Enter a position size");
    setBusy("order");
    try {
      const acceptablePriceUsd = isLong ? price * 1.01 : price * 0.99;
      const tp = tpSlOn && Number(tpPrice) > 0 ? Number(tpPrice) : undefined;
      const sl = tpSlOn && Number(slPrice) > 0 ? Number(slPrice) : undefined;
      const j = await runAction("/api/markets/order/prepare", { ticker: sel, accountId: account.accountId, isLong, sizeTokens, collateralUsd: Math.max(marginUsd, market?.minCollUsd ?? 0), acceptablePriceUsd, tpPriceUsd: tp, slPriceUsd: sl });
      flash(true, `${isLong ? "Long" : "Short"} ${selMeta.sym} placed${tp || sl ? " with TP/SL" : ""}${j.digest ? " · " + short(j.digest) : ""}`);
      record({ type: "open", ticker: sel, side: isLong ? "long" : "short", sizeTokens, priceUsd: price, collateralUsd: Math.max(marginUsd, market?.minCollUsd ?? 0), digest: j.digest });
      await loadAccount();
    } catch (e) { flash(false, friendlyError(e, (e as Error).message)); } finally { setBusy(null); }
  };
  const doClose = async (p: Position & { mark: number; pnl: number; pnlPct: number }) => {
    setBusy("close:" + p.positionId);
    try {
      const j = await runAction("/api/markets/close", { ticker: p.ticker, accountId: account.accountId, positionId: p.positionId, isLong: p.isLong });
      const fee = j.feeUsd ? ` · 2% fee $${j.feeUsd.toFixed(2)}` : "";
      flash(true, `Closed ${assetMeta(p.ticker).sym}${fee}${j.digest ? " · " + short(j.digest) : ""}`);
      record({ type: "close", ticker: p.ticker, side: p.isLong ? "long" : "short", sizeTokens: p.sizeTokens, priceUsd: p.mark, pnlUsd: p.pnl, feeUsd: j.feeUsd, digest: j.digest });
      setPnlCard({ ticker: p.ticker, isLong: p.isLong, leverage: p.leverage, entryPriceUsd: p.entryPriceUsd, markPriceUsd: p.mark, pnlUsd: p.pnl, pnlPct: p.pnlPct });
      await loadAccount();
    } catch (e) { flash(false, friendlyError(e, (e as Error).message)); } finally { setBusy(null); }
  };

  const acceptablePriceUsd = isLong ? price * (1 + 0.01) : price * (1 - 0.01);

  if (disabled) {
    return <div className={`${CARD} p-6 text-[#15300c]`}><div className="text-[18px] font-semibold">Markets are off</div><p className="mt-1 text-[14px] text-[#3a5230]">Set <code>FEATURE_PERPS=true</code> and restart the dev server.</p></div>;
  }

  const chg = quote.change24h ?? 0;

  return (
    <div className="flex flex-col gap-3 text-[#15300c] lg:h-[calc(100vh-9rem)]" style={{ fontFamily: "'Google Sans Variable', var(--font-sans-v2), system-ui, sans-serif" }}>
      {/* stats bar */}
      <div className={`${CARD} flex flex-none flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5`}>
        {/* market picker */}
        <div className="relative" ref={pickerRef}>
          <button onClick={() => setPickerOpen((v) => !v)} className="flex items-center gap-2.5 rounded-xl border border-[#15300c]/15 bg-white px-3 py-2 text-left">
            <AssetIcon ticker={sel} size={26} />
            <div>
              <div className="text-[15px] font-semibold leading-tight">{selMeta.sym} <span className="text-[#7a8a72]">/ USD</span></div>
              <div className="text-[11px] leading-tight text-[#7a8a72]">{selMeta.name}</div>
            </div>
            <span className="ml-1 text-[11px] text-[#7a8a72]">▾</span>
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-1 w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-[#15300c]/10 bg-[#f7fcf2] shadow-[0_18px_50px_-16px_rgba(21,48,12,0.5)]">
                <div className="p-2.5">
                  <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search markets…" className="w-full rounded-lg border border-[#15300c]/12 bg-white px-3 py-2 text-[14px] outline-none" />
                  <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                    {CATEGORIES.map((cx) => (
                      <button key={cx.key} onClick={() => setCatFilter(cx.key)} className="whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-medium" style={{ background: catFilter === cx.key ? "#3d7a29" : "transparent", color: catFilter === cx.key ? "#fff" : "#3a5230" }}>{cx.label}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr] px-3 pb-1 text-[10px] uppercase tracking-[0.12em] text-[#9bb08f]">
                  <span>Market</span><span className="text-right">Price</span><span className="text-right">OI</span><span className="text-right">Funding</span>
                </div>
                <div className="max-h-[360px] overflow-y-auto pb-1.5">
                  {filtered.map((m) => (
                    <button key={m.symbol} onClick={() => { setSel(m.symbol); setPickerOpen(false); setSearch(""); }} className="grid w-full grid-cols-[1.6fr_1fr_1fr_0.9fr] items-center px-3 py-2 text-left hover:bg-[#CAFFB8]/40" style={{ background: m.symbol === sel ? "#CAFFB8" : "transparent" }}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <AssetIcon ticker={m.symbol} size={26} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold leading-tight">{m.sym} <span className="text-[11px] font-normal text-[#7a8a72]">{m.name}</span></span>
                          <span className="block text-[10px] uppercase tracking-wide text-[#9bb08f]">{m.maxLeverage}x max</span>
                        </span>
                      </span>
                      <span className="tabular-nums text-right text-[13.5px] font-medium">${fmtP(m.refPriceUsd)}</span>
                      <span className="tabular-nums text-right text-[12.5px] text-[#3a5230]">{fmtK(m.longOiTokens + m.shortOiTokens)}</span>
                      <span className="tabular-nums text-right text-[12.5px]" style={{ color: m.fundingRatePct >= 0 ? LONG : SHORT }}>{m.fundingRatePct >= 0 ? "+" : ""}{m.fundingRatePct.toFixed(3)}%</span>
                    </button>
                  ))}
                  {!filtered.length && <div className="px-4 py-6 text-center text-[13px] text-[#7a8a72]">No markets match.</div>}
                </div>
              </div>
            </>
          )}
        </div>
        <Stat label="Price"><span style={{ color: chg >= 0 ? LONG : SHORT }}>${fmtP(price)}</span></Stat>
        <Stat label="24h"><span style={{ color: chg >= 0 ? LONG : SHORT }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span></Stat>
        <Stat label="Open interest">{market ? `${fmtK(market.longOiTokens + market.shortOiTokens)} ${selMeta.sym}` : "—"}</Stat>
        <Stat label="Funding/1h">{market ? `${market.fundingRatePct >= 0 ? "+" : ""}${market.fundingRatePct.toFixed(4)}%` : "—"}</Stat>
        <Stat label="Max lev">{market ? `${market.maxLeverage}x` : "—"}</Stat>
        <Stat label="Market"><span style={{ color: market && !market.paused ? LONG : SHORT }}>● {market && !market.paused ? "Open" : "Paused"}</span></Stat>
        <div className="ml-auto text-right"><div className={LABEL}>Available</div><div className="tabular-nums text-[16px] font-bold leading-tight" style={{ color: availableUsd > 0 ? "#2f6d1f" : INK }}>${availableUsd.toFixed(2)}</div></div>
      </div>

      {/* trading row — fills the viewport (chart + positions | order ticket) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* chart + positions column */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className={`${CARD} flex min-h-0 flex-1 flex-col p-3`} style={{ minHeight: 280 }}>
            <div className="mb-1 flex items-center gap-1 px-1">
              {INTERVALS.map((iv) => (
                <button key={iv} onClick={() => setInterval_(iv)} className="rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors" style={{ color: iv === interval ? INK : "#7a8a72", background: iv === interval ? MINT : "transparent" }}>{iv}</button>
              ))}
              <span className="ml-auto text-[11px] text-[#7a8a72]">{selMeta.sym} spot</span>
            </div>
            <div className="min-h-0 flex-1"><TradeChart symbol={sel} interval={interval} /></div>
          </div>
          {/* positions strip — drag the handle to resize */}
          <div className={`${CARD} relative flex flex-none flex-col`} style={{ height: posHeight }}>
            <div onMouseDown={startResize} title="Drag to resize" className="group absolute inset-x-0 -top-3 z-10 flex h-3 cursor-ns-resize items-center justify-center">
              <span className="h-1 w-10 rounded-full bg-[#15300c]/15 transition-colors group-hover:bg-[#15300c]/35" />
            </div>
            <div className="flex items-center gap-4 border-b border-[#15300c]/10 px-4 py-2">
              {(["positions", "history"] as const).map((t) => (
                <button key={t} onClick={() => setPosTab(t)} className="text-[14px]" style={{ color: posTab === t ? INK : "#7a8a72", fontWeight: posTab === t ? 600 : 500, borderBottom: posTab === t ? `2px solid ${MINT}` : "none", paddingBottom: 6, marginBottom: -9 }}>
                  {t === "positions" ? `Positions${livePositions.length ? ` (${livePositions.length})` : ""}` : "Trade history"}
                </button>
              ))}
              {posTab === "positions" && livePositions.length > 0 && <span className="ml-auto text-[12.5px] text-[#3a5230]">Unrealized PnL <b className="tabular-nums" style={{ color: totalPnl >= 0 ? LONG : SHORT }}>{totalPnl >= 0 ? "+" : "-"}${Math.abs(totalPnl).toFixed(2)}</b></span>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {posTab === "positions" ? (
                livePositions.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[13px] text-[#7a8a72]">No open positions. Place your first trade.</div>
                ) : (
                  <table className="w-full text-[13px]" style={{ fontFamily: mono }}>
                    <thead><tr className="text-left text-[10px] uppercase tracking-[0.12em] text-[#7a8a72]">
                      <th className="px-4 py-1.5 font-medium">Market</th><th className="py-1.5 font-medium">Size</th><th className="py-1.5 font-medium">Entry</th><th className="py-1.5 font-medium">Mark</th><th className="py-1.5 font-medium">Liq.</th><th className="py-1.5 font-medium">PnL</th><th className="py-1.5"></th>
                    </tr></thead>
                    <tbody>
                      {livePositions.map((p) => (
                        <tr key={p.ticker + p.positionId} className="border-t border-[#15300c]/8">
                          <td className="px-4 py-1.5" style={{ fontFamily: "var(--font-sans-v2)" }}><span className="flex items-center gap-1.5"><AssetIcon ticker={p.ticker} size={18} /><span className="font-semibold">{assetMeta(p.ticker).sym}</span> <span className="text-[10.5px]" style={{ color: p.isLong ? LONG : SHORT }}>{p.isLong ? "L" : "S"} {p.leverage ? `${p.leverage.toFixed(0)}x` : ""}</span>{p.hasTpSl && <span className="ml-1 text-[9px] text-[#2f6d1f]">TP/SL</span>}</span></td>
                          <td className="py-1.5">{p.sizeTokens.toFixed(2)}</td>
                          <td className="py-1.5">${fmtP(p.entryPriceUsd)}</td>
                          <td className="py-1.5">${fmtP(p.mark)}</td>
                          <td className="py-1.5">${fmtP(p.liqPriceUsd)}</td>
                          <td className="py-1.5" style={{ color: p.pnl >= 0 ? LONG : SHORT }}>{p.pnl >= 0 ? "+" : "-"}${Math.abs(p.pnl).toFixed(2)} <span className="text-[10.5px] text-[#7a8a72]">({p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(0)}%)</span></td>
                          <td className="py-1.5 pr-4"><span className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setPnlCard({ ticker: p.ticker, isLong: p.isLong, leverage: p.leverage, entryPriceUsd: p.entryPriceUsd, markPriceUsd: p.mark, pnlUsd: p.pnl, pnlPct: p.pnlPct })} title="Share PnL" className="rounded-lg border border-[#15300c]/20 px-2 py-0.5 text-[11px] font-semibold text-[#2f6d1f]">Share</button>
                            <button onClick={() => doClose(p)} disabled={!!busy} className="rounded-lg border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: SHORT, color: SHORT }}>{busy === "close:" + p.positionId ? "…" : "Close"}</button>
                          </span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : history.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[13px] text-[#7a8a72]">No trades yet.</div>
              ) : (
                <table className="w-full text-[13px]" style={{ fontFamily: mono }}>
                  <thead><tr className="text-left text-[10px] uppercase tracking-[0.12em] text-[#7a8a72]">
                    <th className="px-4 py-1.5 font-medium">Time</th><th className="py-1.5 font-medium">Action</th><th className="py-1.5 font-medium">Market</th><th className="py-1.5 font-medium">Size</th><th className="py-1.5 font-medium">Price</th><th className="py-1.5 font-medium">PnL</th><th className="py-1.5"></th>
                  </tr></thead>
                  <tbody>
                    {history.map((t, i) => (
                      <tr key={i} className="border-t border-[#15300c]/8">
                        <td className="px-4 py-1.5 text-[#7a8a72]">{new Date(t.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="py-1.5 capitalize" style={{ color: t.type === "open" ? INK : t.type === "close" ? "#3a5230" : "#7a8a72", fontFamily: "var(--font-sans-v2)" }}>
                          {t.type}{t.side ? <span className="ml-1 text-[10.5px]" style={{ color: t.side === "long" ? LONG : SHORT }}>{t.side}</span> : null}
                        </td>
                        <td className="py-1.5" style={{ fontFamily: "var(--font-sans-v2)" }}>{t.ticker ? <span className="flex items-center gap-1.5"><AssetIcon ticker={t.ticker} size={16} />{assetMeta(t.ticker).sym}</span> : "—"}</td>
                        <td className="py-1.5">{t.sizeTokens != null ? t.sizeTokens.toFixed(2) : t.collateralUsd != null ? `$${t.collateralUsd.toFixed(2)}` : "—"}</td>
                        <td className="py-1.5">{t.priceUsd != null ? `$${fmtP(t.priceUsd)}` : "—"}</td>
                        <td className="py-1.5" style={{ color: t.pnlUsd == null ? "#7a8a72" : t.pnlUsd >= 0 ? LONG : SHORT }}>{t.pnlUsd == null ? "—" : `${t.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(t.pnlUsd).toFixed(2)}`}</td>
                        <td className="py-1.5 pr-4 text-right">{t.digest ? <a href={`https://suiscan.xyz/mainnet/tx/${t.digest}`} target="_blank" rel="noreferrer" className="text-[11px] text-[#2f6d1f] underline">tx ↗</a> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* order ticket — inline column on desktop, bottom sheet on mobile */}
        {sheetOpen && <div className="fixed inset-0 z-[55] bg-black/30 lg:hidden" onClick={() => setSheetOpen(false)} />}
        <div className={`${CARD} p-4 fixed inset-x-0 bottom-0 z-[60] max-h-[85vh] overflow-y-auto rounded-b-none transition-transform duration-300 ${sheetOpen ? "translate-y-0" : "translate-y-full"} lg:static lg:z-auto lg:max-h-none lg:w-[338px] lg:flex-none lg:translate-y-0 lg:rounded-2xl lg:overflow-y-auto`}>
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <span className="flex items-center gap-2 text-[15px] font-semibold"><AssetIcon ticker={sel} size={22} />{selMeta.sym}/USD</span>
            <button onClick={() => setSheetOpen(false)} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#15300c]/8 text-[#15300c]">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#eef6e7] p-1">
            <button onClick={() => setIsLong(true)} className="rounded-lg py-2 text-[14px] font-semibold" style={{ background: isLong ? LONG : "transparent", color: isLong ? "#fff" : "#3a5230" }}>Long</button>
            <button onClick={() => setIsLong(false)} className="rounded-lg py-2 text-[14px] font-semibold" style={{ background: !isLong ? SHORT : "transparent", color: !isLong ? "#fff" : "#3a5230" }}>Short</button>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between"><span className="text-[12px] text-[#3a5230]">Leverage <span className="text-[#7a8a72]">(max {market?.maxLeverage ?? 25}x)</span></span><span className="tabular-nums text-[14px] font-bold text-[#2f6d1f]">{leverage}x</span></div>
            <input type="range" min={1} max={Math.max(1, Math.floor(market?.maxLeverage ?? 25))} step={1} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="mt-2 w-full accent-[#3d7a29]" />
          </div>
          <label className="mt-3 block"><span className={LABEL}>Size ({selMeta.sym})</span>
            <input type="number" min={0} step={0.001} value={sizeTokens || ""} onChange={(e) => setSizeTokens(Math.max(0, Number(e.target.value)))} placeholder="0.00" className={`${INPUT} mt-1 tabular-nums`} /></label>
          <input type="range" min={0} max={Math.max(0.001, maxSize)} step={maxSize / 100 || 0.001} value={Math.min(sizeTokens, maxSize)} onChange={(e) => setSizeTokens(Number(e.target.value))} className="mt-2 w-full accent-[#3d7a29]" />
          <div className="mt-2 flex items-center justify-between text-[13px]"><span className="text-[#3a5230]">Margin</span><span className="tabular-nums font-semibold">{marginUsd ? `$${marginUsd.toFixed(2)}` : "$0.00"}</span></div>

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-[#3a5230]">
            <input type="checkbox" checked={tpSlOn} className="accent-[#3d7a29]" onChange={(e) => { setTpSlOn(e.target.checked); if (e.target.checked && price > 0) { setTpPrice((price * (isLong ? 1.1 : 0.9)).toFixed(4)); setSlPrice((price * (isLong ? 0.95 : 1.05)).toFixed(4)); } }} />
            Take Profit / Stop Loss
          </label>
          {tpSlOn && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label><span className={LABEL}>TP price</span><input type="number" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} className={`${INPUT} mt-1 tabular-nums`} style={{ color: LONG }} /></label>
              <label><span className={LABEL}>SL price</span><input type="number" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} className={`${INPUT} mt-1 tabular-nums`} style={{ color: SHORT }} /></label>
            </div>
          )}

          <button onClick={account.accountId ? doOrder : doCreate} disabled={!!busy} className="mt-4 w-full rounded-xl py-3 text-[15px] font-bold text-white disabled:opacity-50" style={{ background: !account.accountId ? "#3d7a29" : isLong ? LONG : SHORT }}>
            {busy === "order" || busy === "create" ? "…" : !account.accountId ? "Create trading account" : `${isLong ? "Long" : "Short"} ${selMeta.sym} · ${leverage}x`}
          </button>

          <div className="mt-4 space-y-1.5 border-t border-[#15300c]/10 pt-3 text-[12.5px]">
            <Row k="Notional" v={`$${fmtP(notionalUsd)}`} />
            <Row k="Accept price" v={`$${fmtP(acceptablePriceUsd)}`} />
            <Row k="Max size" v={<span style={{ color: isLong ? LONG : SHORT }}>{fmtK(maxSize)} {selMeta.sym}</span>} />
            <Row k="Est. liq. price" v={liqPrice ? `$${fmtP(liqPrice)}` : "—"} />
            <Row k="Trading fee" v={`$${totalFeeUsd.toFixed(4)}`} />
          </div>

          {/* deposit / withdraw */}
          <div className="mt-4 rounded-xl bg-[#eef6e7] p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-semibold">Account</span><span className="tabular-nums text-[13px] font-bold text-[#2f6d1f]">${availableUsd.toFixed(2)}</span></div>
            <div className="flex gap-2">
              <div className="flex flex-1 items-center rounded-lg border border-[#15300c]/15 bg-white px-2"><span className="text-[#7a8a72]">$</span><input type="number" min={0} value={depositUsd} onChange={(e) => setDepositUsd(Number(e.target.value))} className="w-full bg-transparent px-1 py-2 tabular-nums text-[14px] outline-none" /></div>
              <button onClick={doDeposit} disabled={!!busy} className="rounded-lg px-3 text-[13px] font-semibold text-[#0d2409]" style={{ background: MINT }}>{busy === "deposit" ? "…" : "Deposit"}</button>
            </div>
            <div className="mt-2 flex gap-2">
              <div className="flex flex-1 items-center rounded-lg border border-[#15300c]/15 bg-white px-2"><span className="text-[#7a8a72]">$</span><input type="number" min={0} value={withdrawUsd} onChange={(e) => setWithdrawUsd(Number(e.target.value))} className="w-full bg-transparent px-1 py-2 tabular-nums text-[14px] outline-none" /></div>
              <button onClick={doWithdraw} disabled={!!busy || !account.accountId} className="rounded-lg border border-[#15300c]/20 bg-white px-3 text-[13px] font-semibold disabled:opacity-40">{busy === "withdraw" ? "…" : "Withdraw"}</button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11.5px] text-[#7a8a72]"><span>{account.accountId ? short(account.accountId) : "no account"}</span><span>collateral USDsui</span></div>
          </div>
        </div>
      </div>

      {/* mobile: quick Long/Short → opens the order sheet */}
      {!sheetOpen && (
        <div className="fixed inset-x-0 bottom-[88px] z-20 flex gap-2 px-4 lg:hidden">
          <button onClick={() => { setIsLong(true); setSheetOpen(true); }} className="flex-1 rounded-2xl py-3.5 text-[15px] font-bold text-white shadow-[0_10px_24px_-8px_rgba(21,48,12,0.5)]" style={{ background: LONG }}>Long {selMeta.sym}</button>
          <button onClick={() => { setIsLong(false); setSheetOpen(true); }} className="flex-1 rounded-2xl py-3.5 text-[15px] font-bold text-white shadow-[0_10px_24px_-8px_rgba(21,48,12,0.5)]" style={{ background: SHORT }}>Short {selMeta.sym}</button>
        </div>
      )}

      {pnlCard && <PnLCard data={pnlCard} onClose={() => setPnlCard(null)} />}
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-4 py-2.5 text-[13px] font-medium text-white lg:bottom-6" style={{ background: toast.ok ? "#3d7a29" : SHORT, boxShadow: "0 10px 30px -8px rgba(21,48,12,0.4)" }}>{toast.msg}</div>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="tabular-nums text-[10px] uppercase tracking-[0.12em] text-[#7a8a72]">{label}</div><div className="mt-0.5 tabular-nums text-[14px] font-semibold text-[#15300c]">{children}</div></div>;
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-[#7a8a72]">{k}</span><span className="tabular-nums text-[#15300c]">{v}</span></div>;
}
