import { Image, type ImageStyle, type StyleProp } from "react-native";

import { flags } from "./flags";
import { hugeIcons } from "./hugeicons";
import { bankSvgs, bankPngs } from "./banks";
import { images } from "./images";

/**
 * Asset components mirroring how the iOS app references its catalog. Flags,
 * bank logos and HugeIcons are looked up by string-constructed name exactly as
 * the Swift `Image("flag-\(code)")` / `"bank-\(code)"` / `"hi.xxx"` do.
 */

/** Country flag by ISO code (or full "flag-xx" key). Original-color vector. */
export function Flag({ code, size = 20 }: { code: string; size?: number }) {
  const key = code.startsWith("flag-") ? code : `flag-${code.toLowerCase()}`;
  const Svg = flags[key];
  return Svg ? <Svg width={size} height={size} /> : null;
}

/** Template HugeIcon — tinted via `color` (currentColor), like the iOS HugeIcon view. */
export function HugeIcon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const key = name.startsWith("hi.") ? name : `hi.${name}`;
  const Svg = hugeIcons[key];
  return Svg ? <Svg width={size} height={size} color={color} /> : null;
}

/** Bank logo by NIP code — SVG brand mark or fintech PNG (BankBranding.assetName). */
export function BankLogo({ code, size = 32 }: { code: string; size?: number }) {
  const key = code.startsWith("bank-") ? code : `bank-${code}`;
  const Svg = bankSvgs[key];
  if (Svg) return <Svg width={size} height={size} />;
  const src = bankPngs[key];
  return src ? <Image source={src} style={{ width: size, height: size, resizeMode: "contain" }} /> : null;
}

/** Raster brand image by iOS asset name (TaliseLogo, SuiCoinMark, VisaLogo, …). */
export function Img({ name, style }: { name: string; style?: StyleProp<ImageStyle> }) {
  const src = images[name];
  return src ? <Image source={src} style={style} /> : null;
}

export { flags, hugeIcons, bankSvgs, bankPngs, images };
