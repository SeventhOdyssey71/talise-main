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

      {/* Phase 7 — money tools */}
      <Stack.Screen name="cheques" options={{ presentation: "modal" }} />
      <Stack.Screen name="cheque-write" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="cheque-mine" options={{ presentation: "modal" }} />
      <Stack.Screen name="cheque-claim" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="work" options={{ presentation: "modal" }} />
      <Stack.Screen name="streams" options={{ presentation: "modal" }} />
      <Stack.Screen name="stream-new" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="invoices" options={{ presentation: "modal" }} />
      <Stack.Screen name="invoice-new" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="invoice-pay" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="contracts" options={{ presentation: "modal" }} />
      <Stack.Screen name="contract-new" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="requests" options={{ presentation: "modal" }} />
      <Stack.Screen name="request-new" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="rules" options={{ presentation: "modal" }} />
      <Stack.Screen name="rule-new" options={{ presentation: "fullScreenModal" }} />

      {/* Phase 8 — payroll, pockets, bank, handle */}
      <Stack.Screen name="payroll" options={{ presentation: "modal" }} />
      <Stack.Screen name="team-edit" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="pay-team" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="team-stream" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="pockets" options={{ presentation: "modal" }} />
      <Stack.Screen name="bank-accounts" options={{ presentation: "modal" }} />
      <Stack.Screen name="bank-add" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="claim-handle" options={{ presentation: "modal" }} />
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
