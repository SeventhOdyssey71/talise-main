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
      <Stack.Screen name="deposit" options={{ presentation: "modal" }} />
      <Stack.Screen name="withdraw" options={{ presentation: "modal" }} />
      <Stack.Screen name="receive" options={{ presentation: "modal" }} />
      <Stack.Screen name="history" options={{ presentation: "modal" }} />
      <Stack.Screen name="token-bucket" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="receipt" options={{ presentation: "modal" }} />
      <Stack.Screen name="scan" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="confirm-pay" options={{ presentation: "modal" }} />
      <Stack.Screen name="send" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="send-abroad" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="perps" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="earn-manage" options={{ presentation: "modal" }} />
      <Stack.Screen name="new-goal" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="goal-action" options={{ presentation: "modal" }} />
      <Stack.Screen name="change-pin" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="verify-identity" options={{ presentation: "modal" }} />
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
