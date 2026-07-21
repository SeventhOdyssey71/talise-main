import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import { colors } from "@/design/tokens";

/**
 * SF Symbol → cross-platform icon. The iOS app uses ~74 SF Symbols (iOS-only);
 * this maps each to the closest Ionicons / MaterialCommunityIcons glyph so
 * screens can reference the SAME symbol name they use on iOS and render an
 * equivalent on Android. `ion` = Ionicons, `mci` = MaterialCommunityIcons.
 */
type Entry = { lib: "ion"; name: keyof typeof Ionicons.glyphMap } | { lib: "mci"; name: keyof typeof MaterialCommunityIcons.glyphMap };

const MAP: Record<string, Entry> = {
  "apple.logo": { lib: "ion", name: "logo-apple" },
  "arrow.down": { lib: "ion", name: "arrow-down" },
  "arrow.left.arrow.right": { lib: "ion", name: "swap-horizontal" },
  "arrow.right": { lib: "ion", name: "arrow-forward" },
  "arrow.triangle.2.circlepath": { lib: "ion", name: "sync" },
  "arrow.turn.down.right": { lib: "ion", name: "return-down-forward" },
  "arrow.up.right": { lib: "mci", name: "arrow-top-right" },
  "arrow.up.right.square": { lib: "ion", name: "open-outline" },
  "arrow.down.left": { lib: "mci", name: "arrow-bottom-left" },
  circle: { lib: "ion", name: "ellipse-outline" },
  "bolt.slash.fill": { lib: "mci", name: "flash-off" },
  keyboard: { lib: "ion", name: "keypad" },
  viewfinder: { lib: "mci", name: "crop-free" },
  "clock.fill": { lib: "ion", name: "time" },
  bell: { lib: "ion", name: "notifications-outline" },
  "bell.fill": { lib: "ion", name: "notifications" },
  bag: { lib: "ion", name: "bag-outline" },
  "bolt.fill": { lib: "ion", name: "flash" },
  "building.columns": { lib: "mci", name: "bank-outline" },
  "building.columns.fill": { lib: "mci", name: "bank" },
  "camera.fill": { lib: "ion", name: "camera" },
  "camera.metering.none": { lib: "mci", name: "camera-off" },
  "chart.line.uptrend.xyaxis": { lib: "ion", name: "trending-up" },
  checkmark: { lib: "ion", name: "checkmark" },
  "checkmark.circle": { lib: "ion", name: "checkmark-circle-outline" },
  "checkmark.circle.fill": { lib: "ion", name: "checkmark-circle" },
  "checkmark.seal.fill": { lib: "mci", name: "check-decagram" },
  "checkmark.shield": { lib: "ion", name: "shield-checkmark-outline" },
  "checkmark.shield.fill": { lib: "ion", name: "shield-checkmark" },
  "chevron.down": { lib: "ion", name: "chevron-down" },
  "chevron.left": { lib: "ion", name: "chevron-back" },
  "chevron.right": { lib: "ion", name: "chevron-forward" },
  "chevron.right.2": { lib: "mci", name: "chevron-double-right" },
  "chevron.up.chevron.down": { lib: "mci", name: "unfold-more-horizontal" },
  "circle.hexagongrid": { lib: "mci", name: "hexagon-multiple-outline" },
  "circle.hexagongrid.fill": { lib: "mci", name: "hexagon-multiple" },
  clock: { lib: "ion", name: "time-outline" },
  "clock.arrow.2.circlepath": { lib: "mci", name: "history" },
  "creditcard.fill": { lib: "ion", name: "card" },
  "delete.left": { lib: "ion", name: "backspace-outline" },
  "doc.on.doc": { lib: "ion", name: "copy-outline" },
  "doc.plaintext": { lib: "ion", name: "document-text-outline" },
  "doc.text": { lib: "ion", name: "document-text-outline" },
  "doc.text.below.ecg": { lib: "mci", name: "file-chart-outline" },
  "dollarsign.circle.fill": { lib: "ion", name: "cash" },
  "dot.radiowaves.left.and.right": { lib: "ion", name: "radio-outline" },
  exclamationmark: { lib: "mci", name: "exclamation" },
  "exclamationmark.circle": { lib: "ion", name: "alert-circle-outline" },
  "exclamationmark.circle.fill": { lib: "ion", name: "alert-circle" },
  "exclamationmark.triangle": { lib: "ion", name: "warning-outline" },
  "exclamationmark.triangle.fill": { lib: "ion", name: "warning" },
  eye: { lib: "ion", name: "eye-outline" },
  faceid: { lib: "mci", name: "face-recognition" },
  "flag.fill": { lib: "ion", name: "flag" },
  "info.circle": { lib: "ion", name: "information-circle-outline" },
  "leaf.fill": { lib: "ion", name: "leaf" },
  link: { lib: "ion", name: "link-outline" },
  "lock.fill": { lib: "ion", name: "lock-closed" },
  "lock.shield.fill": { lib: "mci", name: "shield-lock" },
  magnifyingglass: { lib: "ion", name: "search" },
  paperplane: { lib: "ion", name: "paper-plane-outline" },
  "paperplane.fill": { lib: "ion", name: "paper-plane" },
  pencil: { lib: "ion", name: "pencil" },
  "person.3": { lib: "ion", name: "people-outline" },
  "person.3.fill": { lib: "ion", name: "people" },
  "person.crop.circle.badge.xmark": { lib: "mci", name: "account-remove-outline" },
  "person.crop.circle.fill": { lib: "ion", name: "person-circle" },
  photo: { lib: "ion", name: "image-outline" },
  plus: { lib: "ion", name: "add" },
  "plus.circle": { lib: "ion", name: "add-circle-outline" },
  qrcode: { lib: "ion", name: "qr-code" },
  "qrcode.viewfinder": { lib: "ion", name: "scan" },
  "rectangle.portrait.and.arrow.right": { lib: "ion", name: "log-out-outline" },
  scope: { lib: "ion", name: "locate" },
  sparkles: { lib: "ion", name: "sparkles" },
  "square.and.arrow.up": { lib: "ion", name: "share-outline" },
  "square.and.pencil": { lib: "ion", name: "create-outline" },
  trash: { lib: "ion", name: "trash-outline" },
  tray: { lib: "ion", name: "file-tray-outline" },
  "tray.and.arrow.up.fill": { lib: "mci", name: "tray-arrow-up" },
  "video.slash": { lib: "ion", name: "videocam-off-outline" },
  xmark: { lib: "ion", name: "close" },
  "xmark.circle.fill": { lib: "ion", name: "close-circle" },
  // tab bar
  "house.fill": { lib: "ion", name: "home" },
  "gift.fill": { lib: "ion", name: "gift" },
};

export type SFSymbol = keyof typeof MAP;

export function Icon({
  name,
  size = 18,
  color = colors.fg,
}: {
  name: SFSymbol | string;
  size?: number;
  color?: string;
}) {
  const entry = MAP[name] ?? ({ lib: "ion", name: "ellipse-outline" } as Entry);
  if (entry.lib === "mci") {
    return <MaterialCommunityIcons name={entry.name} size={size} color={color} />;
  }
  return <Ionicons name={entry.name} size={size} color={color} />;
}
