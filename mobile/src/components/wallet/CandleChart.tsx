import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { fmtPrice, type Candle } from "@/api/markets";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

const LONG = "#79D96C";
const SHORT = "#D9614F";

/**
 * Candlestick chart — a wick line + body rect per candle, exactly how the iOS
 * Swift Charts version renders it. Y-domain padded 8%, 4 trailing price labels.
 */
export function CandleChart({ candles, width, height = 268 }: { candles: Candle[]; width: number; height?: number }) {
  if (candles.length === 0) {
    return <View style={[styles.wrap, { width, height, alignItems: "center", justifyContent: "center" }]} />;
  }
  const padRight = 46;
  const plotW = width - padRight - 24;
  const plotH = height - 24;
  const x0 = 12;
  const y0 = 12;

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const pad = (hi - lo) * 0.08 || 1;
  const dLo = lo - pad;
  const dHi = hi + pad;
  const y = (v: number) => y0 + plotH - ((v - dLo) / (dHi - dLo)) * plotH;

  const step = plotW / candles.length;
  const barW = Math.max(2, Math.min(9, step * 0.7));

  const labels = [0, 1, 2, 3].map((i) => dHi - (i / 3) * (dHi - dLo));

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height}>
        {labels.map((v, i) => {
          const yy = y0 + (i / 3) * plotH;
          return (
            <SvgText key={i} x={width - 6} y={yy + 3} fontSize={9} fontFamily={family.mono} fill={colors.fgDim} textAnchor="end">
              {fmtPrice(v)}
            </SvgText>
          );
        })}
        {candles.map((c, i) => {
          const cx = x0 + i * step + step / 2;
          const up = c.close >= c.open;
          const color = up ? LONG : SHORT;
          const top = y(Math.max(c.open, c.close));
          const bot = y(Math.min(c.open, c.close));
          return (
            <React.Fragment key={i}>
              <Line x1={cx} y1={y(c.low)} x2={cx} y2={y(c.high)} stroke={color} strokeOpacity={0.55} strokeWidth={1} />
              <Rect x={cx - barW / 2} y={top} width={barW} height={Math.max(1, bot - top)} fill={color} rx={0.5} />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden" },
});
