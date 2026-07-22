import * as LocalAuthentication from "expo-local-authentication";

import { prefs } from "@/auth/prefs";

/**
 * Biometric consent gate — required before every fund-moving signature (matches
 * ios BiometricGate.swift). Uses device-owner authentication (biometric OR device
 * credential fallback) — the goal is fresh user presence, not biometric per se.
 * The `reason` MUST carry the amount + counterparty so the system prompt shows
 * exactly what is being authorized. No-ops when the toggle is off.
 */
export class BiometricError extends Error {
  constructor(
    public code: "cancelled" | "notAvailable" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "BiometricError";
  }
}

export async function requireUserPresence(reason: string): Promise<void> {
  if (!(await prefs.getBiometricRequired())) return;

  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware && !enrolled) {
    // No biometrics and no device credential — cannot establish presence.
    throw new BiometricError("notAvailable", "Device authentication is not set up.");
  }

  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: false, // allow passcode/pattern fallback
    cancelLabel: "Cancel",
    requireConfirmation: false,
  });

  if (!res.success) {
    if (res.error === "user_cancel" || res.error === "system_cancel" || res.error === "app_cancel") {
      throw new BiometricError("cancelled", "Authentication cancelled.");
    }
    throw new BiometricError("failed", res.error ?? "Authentication failed.");
  }
}

/** Label for the enrolled biometric ("Face ID" / "Fingerprint" / "Biometrics"). */
export async function biometryDisplayName(): Promise<string> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "Fingerprint";
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return "Iris";
  return "Biometrics";
}
