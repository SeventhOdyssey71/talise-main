export const runtime = "nodejs";

/**
 * GET /api/asset-icon/BTCUSD — proxies the real WaterX market logo
 * (waterx.app/markets/<TICKER>.<ext>) so the CSP img-src stays 'self'. The
 * extension varies per market; we know it, and fall back to probing.
 */
const EXT: Record<string, string> = {
  BTCUSD: "svg", ETHUSD: "png", SOLUSD: "jpg", SUIUSD: "svg", BNBUSD: "png", XRPUSD: "png",
  DOGEUSD: "png", HYPEUSD: "jpg", ZECUSD: "png", DEEPUSD: "png", WALUSD: "png", LITUSD: "png",
  TSLAXUSD: "png", NVDAXUSD: "png", AAPLXUSD: "png", COINXUSD: "svg", MSTRXUSD: "svg",
  HOODXUSD: "svg", NFLXXUSD: "svg", GOOGLXUSD: "png", METAXUSD: "png", QQQXUSD: "png",
  SPYXUSD: "png", CRCLXUSD: "svg", EURUSD: "svg", USDJPY: "svg", XAUTUSD: "png", XAGUSD: "png",
  WTIUSD: "png", BRENTUSD: "svg",
};
const CT: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export async function GET(_req: Request, ctx: { params: Promise<{ sym: string }> }) {
  const { sym } = await ctx.params;
  const ticker = sym.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!ticker) return new Response(null, { status: 404 });
  const exts = EXT[ticker] ? [EXT[ticker]] : ["svg", "png", "jpg", "webp"];
  for (const ext of exts) {
    try {
      const r = await fetch(`https://waterx.app/markets/${ticker}.${ext}`, { cache: "no-store" });
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      return new Response(buf, {
        headers: { "content-type": CT[ext] ?? "image/png", "cache-control": "public, max-age=604800, immutable" },
      });
    } catch {
      /* try next ext */
    }
  }
  return new Response(null, { status: 404 });
}
