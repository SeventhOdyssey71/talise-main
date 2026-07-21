import "react-native-reanimated";

import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider, useSession, type Phase } from "@/auth/session";
import { colors } from "@/design/tokens";

SplashScreen.preventAutoHideAsync();

/** Phase → the route the user belongs on. */
const ROUTE: Record<Exclude<Phase, "launching">, string> = {
  signedOut: "/(auth)/welcome",
  onboarding: "/(auth)/onboarding",
  pinSetup: "/(auth)/pin-create",
  locked: "/(auth)/pin-unlock",
  ready: "/(tabs)",
};

/** Redirect on phase change (protected-routes pattern) + drop the splash. */
function RootNav() {
  const { phase } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (phase === "launching") return;
    SplashScreen.hideAsync();
    router.replace(ROUTE[phase] as never);
  }, [phase, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "fade",
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SessionProvider>
          <RootNav />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
