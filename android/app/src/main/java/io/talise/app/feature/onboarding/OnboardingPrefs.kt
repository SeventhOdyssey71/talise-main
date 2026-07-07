package io.talise.app.feature.onboarding

import android.content.Context
import android.content.SharedPreferences

/**
 * UserDefaults-equivalent for the onboarding flow. Key names mirror iOS
 * `UserDefaults.standard` exactly so behavior (resume step, saved handle,
 * local kyc tier stamp, returning-user greeting) matches 1:1.
 */
internal object OnboardingPrefs {
    private const val FILE = "talise_prefs"

    /** iOS `talise.onboarding.currentStep` — resume point for a backgrounded flow. */
    const val KEY_STEP = "talise.onboarding.currentStep"

    /** iOS `talise.onboarding.handle` — in-progress handle if the user backgrounds mid-pick. */
    const val KEY_HANDLE = "talise.onboarding.handle"

    /** iOS `talise.kyc_tier` — local free-tier stamp written on flow completion. */
    const val KEY_KYC_TIER = "talise.kyc_tier"

    /** iOS `talise.hasSignedInBefore` — drives the "Welcome back" sign-in copy. */
    const val KEY_HAS_SIGNED_IN_BEFORE = "talise.hasSignedInBefore"

    /** iOS `talise.onboarding.biometricsEnabled`. */
    const val KEY_BIOMETRICS_ENABLED = "talise.onboarding.biometricsEnabled"

    /** iOS `talise.onboarding.permissionsRequested`. */
    const val KEY_PERMISSIONS_REQUESTED = "talise.onboarding.permissionsRequested"

    fun of(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
