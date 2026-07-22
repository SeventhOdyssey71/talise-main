import { Stack } from "expo-router";

import { colors } from "@/design/tokens";

/** Auth/onboarding/lock stack — headerless, dark. Full onboarding lands in Phase 3. */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "fade",
        gestureEnabled: false,
      }}
    />
  );
}
