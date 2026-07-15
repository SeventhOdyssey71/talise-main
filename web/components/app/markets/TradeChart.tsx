"use client";

/**
 * TradeChart — TradingView lightweight-charts candlesticks for the perps
 * terminal. Candles are proxied from Binance spot via /api/markets/candles
 * (WaterX drives the on-chain perp state; price history mirrors the deep spot
 * market of the same asset). Chart instance persists across symbol/interval
 * changes; data is refreshed on change and polled live.
 */

import { useCallback, useEffect, useRef } from "react";

type Candle = { time: number; open: number; high: number; low: number; close: number };

export function TradeChart({ symbol, interval }: { symbol: string; interval: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  const symRef = useRef(symbol);
  const intRef = useRef(interval);
  symRef.current = symbol;
  intRef.current = interval;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/markets/candles?symbol=${symRef.current}&interval=${intRef.current}`);
      const j = (await r.json()) as { candles?: Candle[]; unavailable?: boolean };
      if (!seriesRef.current) return;
      seriesRef.current.setData(j.candles ?? []);
      if (j.candles?.length) chartRef.current?.timeScale().fitContent();
    } catch {
      /* transient */
    }
  }, []);

  // Create the chart once.
  useEffect(() => {
    let disposed = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const { createChart, CandlestickSeries, ColorType, CrosshairMode } = await import("lightweight-charts");
      if (disposed || !elRef.current) return;
      const chart = createChart(elRef.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#3a5230",
          fontFamily: "var(--font-sans-v2), system-ui, sans-serif",
        },
        grid: {
          vertLines: { color: "rgba(21,48,12,0.06)" },
          horzLines: { color: "rgba(21,48,12,0.06)" },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "rgba(21,48,12,0.12)" },
        timeScale: { borderColor: "rgba(21,48,12,0.12)", timeVisible: true, secondsVisible: false },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#2f9e44",
        downColor: "#e0574f",
        borderVisible: false,
        wickUpColor: "#2f9e44",
        wickDownColor: "#e0574f",
      });
      chartRef.current = chart;
      seriesRef.current = series;
      await load();
      poll = setInterval(load, 5000);
    })();
    return () => {
      disposed = true;
      if (poll) clearInterval(poll);
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [load]);

  // Reload on symbol / interval change.
  useEffect(() => {
    void load();
  }, [symbol, interval, load]);

  return <div ref={elRef} className="h-full w-full" />;
}
