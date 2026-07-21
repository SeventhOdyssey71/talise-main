import { useEffect } from "react";
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

const MINT = "#CAFFB8";
const INK = "#0A140C";

/**
 * AgentMascot — the mint "lego-brick" Copilot mascot, drawn with SVG. A rounded
 * squircle head with a specular highlight + rim light, two ink eyes and an
 * upturned smile. Approximates the ios AgentMascot.swift (which draws it in
 * SwiftUI). `animated` adds a gentle vertical bob.
 */
export function AgentMascot({ size = 34, animated = false, tint = MINT }: { size?: number; animated?: boolean; tint?: string }) {
  const w = size * 0.84;
  const h = size * 0.8;
  const r = size * 0.4;
  const stroke = Math.max(0.5, size * 0.02);

  const bob = useSharedValue(0);
  useEffect(() => {
    if (!animated) return;
    bob.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [animated, bob]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -bob.value * size * 0.03 }] }));

  const cx = w / 2;
  const cy = h / 2 + size * 0.02;
  const eyeW = size * 0.12;
  const eyeH = size * 0.16;
  const eyeGap = size * 0.17;
  const eyeR = size * 0.06;

  const sw = size * 0.26;
  const sh = size * 0.12;
  const sy = cy + eyeH / 2 + size * 0.05;
  const smile = `M ${cx - sw / 2} ${sy} Q ${cx} ${sy + sh} ${cx + sw / 2} ${sy}`;

  return (
    <Animated.View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Svg width={w} height={h + size * 0.06}>
        <Defs>
          <RadialGradient id="mascotSpec" cx="32%" cy="26%" r="60%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="mascotVol" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.2" />
          </LinearGradient>
          <LinearGradient id="mascotRim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0.04" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} rx={r} ry={r} fill={tint} />
        <Rect x={0} y={0} width={w} height={h} rx={r} ry={r} fill="url(#mascotSpec)" />
        <Rect x={0} y={0} width={w} height={h} rx={r} ry={r} fill="url(#mascotVol)" />
        <Rect x={stroke / 2} y={stroke / 2} width={w - stroke} height={h - stroke} rx={r} ry={r} fill="none" stroke="url(#mascotRim)" strokeWidth={stroke} />
        <Rect x={cx - eyeGap / 2 - eyeW} y={cy - eyeH / 2} width={eyeW} height={eyeH} rx={eyeR} ry={eyeR} fill={INK} />
        <Rect x={cx + eyeGap / 2} y={cy - eyeH / 2} width={eyeW} height={eyeH} rx={eyeR} ry={eyeR} fill={INK} />
        <Path d={smile} stroke={INK} strokeWidth={size * 0.05} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}
