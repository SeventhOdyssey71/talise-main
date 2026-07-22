import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Linking, type AppStateStatus } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { setUnauthorizedHandler } from "@/api/client";
import { pinService } from "@/auth/pin";
import { prefs } from "@/auth/prefs";
import { proofCache } from "@/auth/proofCache";
import { secure } from "@/auth/secure";
import { beginGoogleSignIn, clearSession, completeGoogleSignIn, fetchMe, restoreBearer, type UserDTO } from "@/auth/zklogin";

/**
 * AppSession — the phase state machine, ported from ios App/AppSession.swift.
 *
 * launching → signedOut | onboarding | pinSetup | ready | locked
 *
 * Cold launch restores if (snapshot user) && (bearer + maxEpoch present) &&
 * (signed in < 3 days ago). Session TTL is 3 days (aligned to maxEpoch = epoch+3).
 * Backgrounding ≥ 20s with a PIN set re-locks to the PIN screen.
 */

export type Phase = "launching" | "signedOut" | "onboarding" | "pinSetup" | "ready" | "locked";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const LOCK_GRACE_MS = 20 * 1000;

type SessionValue = {
  phase: Phase;
  user: UserDTO | null;
  signIn: () => Promise<{ existing: boolean }>;
  completeOnboarding: (user: UserDTO) => void;
  completePinSetup: () => void;
  unlock: () => void;
  verifyAndUnlock: (pin: string) => Promise<boolean>;
  hasPinForCurrent: () => Promise<boolean>;
  setPinAndReady: (pin: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionValue | null>(null);
export const useSession = (): SessionValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used within <SessionProvider>");
  return v;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("launching");
  const [user, setUser] = useState<UserDTO | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const authInFlight = useRef(false);
  const lastCallbackUrl = useRef<string | null>(null);

  /** accountType==null → onboarding; else no PIN → pinSetup; else ready. */
  const route = useCallback(async (u: UserDTO) => {
    setUser(u);
    if (!u.accountType) return setPhase("onboarding");
    const hasPin = await pinService.hasPin(u.id);
    setPhase(hasPin ? "ready" : "pinSetup");
  }, []);

  const doSignOut = useCallback(async () => {
    await clearSession();
    setUser(null);
    setPhase("signedOut");
  }, []);

  // 401 anywhere → clean sign-out (matches .taliseSessionExpired).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void doSignOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [doSignOut]);

  // Cold-launch bootstrap.
  useEffect(() => {
    (async () => {
      if (!(await prefs.getPinFlowReset())) await prefs.setPinFlowReset();

      const lastUserId = await prefs.getLastUserId();
      const snapshotUser = lastUserId ? await prefs.getUserSnapshot<UserDTO>(lastUserId) : null;
      const bearer = await restoreBearer();
      const maxEpoch = await proofCache.maxEpoch();
      const signInAt = await prefs.getSignInAt();
      const expired = signInAt == null || Date.now() - signInAt >= THREE_DAYS_MS;

      if (snapshotUser && bearer && maxEpoch != null && !expired) {
        setUser(snapshotUser);
        const hasPin = await pinService.hasPin(snapshotUser.id);
        setPhase(hasPin ? "locked" : "pinSetup");
        // Refresh the authoritative record in the background.
        fetchMe().then((u) => setUser(u)).catch(() => {});
      } else {
        await clearSession();
        setPhase("signedOut");
      }
    })();
  }, []);

  // OAuth deep-link callback. On Android the talise://auth/callback redirect
  // deep-links back INTO the app (rather than being captured by the auth
  // session), so finish sign-in here from the incoming URL — otherwise it lands
  // on an "unmatched route". Deduped by URL so getInitialURL + the url event
  // don't complete twice.
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url || !url.includes("auth/callback")) return;
      if (url === lastCallbackUrl.current || authInFlight.current) return;
      lastCallbackUrl.current = url;
      authInFlight.current = true;
      try {
        const { user: u } = await completeGoogleSignIn(url);
        await route(u);
      } catch {
        /* leave the user on the welcome screen; retrying re-opens OAuth */
      } finally {
        authInFlight.current = false;
        try { WebBrowser.dismissBrowser(); } catch { /* no browser open */ }
      }
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
  }, [route]);

  // Background lock — record on background, re-lock on foreground after 20s.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (user) backgroundedAt.current = Date.now();
      } else if (next === "active") {
        (async () => {
          const bg = backgroundedAt.current;
          backgroundedAt.current = null;
          if (phase !== "ready" || !user) return;
          const signInAt = await prefs.getSignInAt();
          if (signInAt == null || Date.now() - signInAt >= THREE_DAYS_MS) return void doSignOut();
          if (bg != null && Date.now() - bg >= LOCK_GRACE_MS && (await pinService.hasPin(user.id))) {
            setPhase("locked");
          }
        })();
      }
    });
    return () => sub.remove();
  }, [phase, user, doSignOut]);

  const value: SessionValue = {
    phase,
    user,
    signIn: async () => {
      const url = await beginGoogleSignIn();
      if (url) {
        const { user: u, existing } = await completeGoogleSignIn(url);
        await route(u);
        return { existing };
      }
      // The redirect deep-linked into the app; the listener below finishes it.
      return { existing: false };
    },
    completeOnboarding: (u) => {
      void route(u);
    },
    completePinSetup: () => setPhase("ready"),
    unlock: () => {
      if (user) setPhase("ready");
    },
    verifyAndUnlock: async (pin) => {
      if (!user) return false;
      const ok = await pinService.verifyPin(user.id, pin);
      if (ok) setPhase("ready");
      return ok;
    },
    hasPinForCurrent: async () => (user ? pinService.hasPin(user.id) : false),
    setPinAndReady: async (pin) => {
      if (!user) throw new Error("No user");
      await pinService.setPin(user.id, pin);
      setPhase("ready");
    },
    signOut: doSignOut,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Re-export so screens can also clear the keychain PIN on "Forgot PIN".
export { secure };
