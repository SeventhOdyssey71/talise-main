import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** TEMPORARY probe — discover the Noodles API shape from Vercel egress. */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  const targets = [
    { ep: "coin-info-list", auth: "x-api-key" },
    { ep: "coin-top", auth: "x-api-key" },
    { ep: "coin-info-list", auth: "authorization" },
    { ep: "coin-info-list", auth: "query" },
  ];
  const out: unknown[] = [];
  for (const t of targets) {
    const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
    let url = `https://api.noodles.fi/${t.ep}`;
    if (t.auth === "x-api-key") headers["x-api-key"] = key;
    else if (t.auth === "authorization") headers["Authorization"] = `Bearer ${key}`;
    else url += `?api_key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(9000) });
      const text = await res.text();
      const challenged = text.includes("Just a moment") || text.includes("_cf_chl");
      out.push({ ep: t.ep, auth: t.auth, status: res.status, ct: res.headers.get("content-type"), challenged, sample: challenged ? null : text.slice(0, 900) });
    } catch (e) {
      out.push({ ep: t.ep, auth: t.auth, error: String(e) });
    }
  }
  return NextResponse.json({ probe: out });
}
