import { Platform } from "react-native";

/**
 * Font families. iOS = SF Pro (system) + SF Mono. On Android the system font
 * (Roboto) and a monospace family stand in until/unless we bundle DMSans (the
 * iOS app bundles DMSans-Variable but currently renders with the system face).
 */
export const family = {
  sans: Platform.select({ ios: "System", default: "sans-serif" }) as string,
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as string,
} as const;
