package io.talise.app.feature.onboarding

import android.content.Context
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.core.model.UserDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.AppSession
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Onboarding coordinator — the Android port of iOS `OnboardingRoot`. State machine
 * drives the flow (iOS raw step names preserved for persistence parity):
 *
 *     handlePicker → pinSetup → permissions → done
 *
 * Mounting differs from iOS by phase, not by sequencing:
 *   • On iOS `OnboardingRoot` is the pre-auth surface too, opening at `.signIn`
 *     ([[sign-in-only-entry]]). On Android, `Phase.SignedOut` renders `SignInScreen`
 *     directly (TaliseRoot), so this coordinator mounts AFTER a successful sign-in —
 *     `Phase.Onboarding(user)` (accountType == null → genuinely new account) — and
 *     picks up the flow at the first post-auth step, exactly where the iOS machine
 *     lands after `SignInScreen.onSignedIn` for a new user.
 *   • The legacy pre-auth cases (splash / welcome / intro carousel / kycTier /
 *     country) are kept and routed defensively, mirroring iOS keeping the source on
 *     disk with defensive jumps.
 *
 * Persistence: every transition writes the current step to prefs under
 * `talise.onboarding.currentStep` (same key as iOS UserDefaults). On mount, a saved
 * step resumes the user where they left off; the key is cleared on `done`.
 */
enum class OnboardingStep(val raw: String) {
    Splash("splash"),
    Welcome("welcome"),
    Intro1("intro1"),
    Intro2("intro2"),
    Intro3("intro3"),
    SignIn("signIn"),

    /**
     * Brief "Welcome back, <name>" interstitial for a sign-in that resolves to an
     * ALREADY-onboarded account. On Android the coordinator inside core/auth routes
     * returning users straight to `Phase.Ready`, so this beat is currently unreachable
     * (see parity notes) — ported and kept so wiring it is a one-line route.
     */
    WelcomeBack("welcomeBack"),
    KycTier("kycTier"),           // legacy — not in active flow
    HandlePicker("handlePicker"),
    Country("country"),           // retired — routes forward
    PinSetup("pinSetup"),
    Permissions("permissions"),
    Done("done");

    companion object {
        fun fromRaw(raw: String): OnboardingStep? = entries.firstOrNull { it.raw == raw }
    }
}

@Composable
fun OnboardingRoot(user: UserDTO? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val signedInUser = user ?: AppSession.currentUser

    var step by rememberSaveable { mutableStateOf(resumeStep(context)) }

    fun advance(next: OnboardingStep) {
        step = next
        persist(context, next)
    }

    // Mirror the legacy kyc-tier behaviour: stamp a free tier locally, then celebrate.
    fun handleFlowComplete() {
        OnboardingPrefs.of(context).edit()
            .putString(OnboardingPrefs.KEY_KYC_TIER, "free")
            .apply()
        advance(OnboardingStep.Done)
    }

    // Hand off to the authenticated app. We refresh /api/me first so the freshly
    // claimed handle (taliseSubname) rides along; on failure we fall back to the
    // user we already hold.
    fun finish() {
        OnboardingPrefs.of(context).edit().remove(OnboardingPrefs.KEY_STEP).apply()
        scope.launch {
            val fresh = runCatching { ApiClient.api.me() }.getOrNull() ?: signedInUser
            if (fresh != null) AppSession.completeOnboarding(fresh) else AppSession.bootstrap()
        }
    }

    // The id PinService keys against — prefer the signed-in user (defensive fallback).
    val pinUserId = signedInUser?.id ?: ""

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        AnimatedContent(
            targetState = step,
            transitionSpec = {
                fadeIn(tween(durationMillis = 320)) togetherWith fadeOut(tween(durationMillis = 320))
            },
            label = "onboardingStep",
        ) { current ->
            when (current) {
                OnboardingStep.Splash ->
                    SplashView(onAdvance = { advance(OnboardingStep.Welcome) })

                OnboardingStep.Welcome ->
                    WelcomeView(
                        onContinue = { advance(OnboardingStep.SignIn) },
                        onSignIn = { advance(OnboardingStep.SignIn) },
                    )

                OnboardingStep.Intro1, OnboardingStep.Intro2, OnboardingStep.Intro3 ->
                    // Legacy carousel — not routed in the new flow but left in place so
                    // we can re-enable it without a refactor.
                    BrandIntroCarousel(onContinue = { advance(OnboardingStep.SignIn) })

                OnboardingStep.SignIn -> {
                    // On Android this coordinator only mounts AFTER auth
                    // (Phase.Onboarding), so a stray signIn step jumps forward
                    // to the first real onboarding step.
                    LaunchedEffect(Unit) { advance(OnboardingStep.HandlePicker) }
                    Box(Modifier.fillMaxSize())
                }

                OnboardingStep.WelcomeBack ->
                    WelcomeBackInterstitial(
                        name = signedInUser?.name,
                        onFinished = { finish() },
                    )

                OnboardingStep.KycTier ->
                    // Legacy — defensive jump to the new flow if hit.
                    KycTierPicker(onFreeChosen = { advance(OnboardingStep.HandlePicker) })

                OnboardingStep.HandlePicker ->
                    HandlePickerScreen(onContinue = { advance(OnboardingStep.PinSetup) })

                OnboardingStep.Country, OnboardingStep.PinSetup ->
                    // `country` is retired (double-prompted) — route stragglers forward,
                    // same as iOS.
                    PinSetupScreen(
                        userId = pinUserId,
                        onContinue = { advance(OnboardingStep.Permissions) },
                    )

                OnboardingStep.Permissions ->
                    PermissionsScreen(onContinue = { handleFlowComplete() })

                OnboardingStep.Done ->
                    OnboardingCompletedView(onDismiss = { finish() })
            }
        }
    }
}

// ── Persistence ─────────────────────────────────────────────────────────────

private fun persist(context: Context, step: OnboardingStep) {
    val prefs = OnboardingPrefs.of(context)
    when (step) {
        // welcomeBack is a transient beat for an ALREADY-onboarded account — resuming
        // into it after a relaunch would strand the user, so it's never written.
        OnboardingStep.Done, OnboardingStep.Splash, OnboardingStep.WelcomeBack ->
            prefs.edit().remove(OnboardingPrefs.KEY_STEP).apply()

        else ->
            prefs.edit().putString(OnboardingPrefs.KEY_STEP, step.raw).apply()
    }
}

/**
 * Resume mid-flow if the user backgrounded the app during onboarding. Only the real
 * post-auth steps are resumable (never splash/welcome — start clean), matching iOS
 * `resumeIfNeeded`.
 */
private fun resumeStep(context: Context): OnboardingStep {
    val raw = OnboardingPrefs.of(context).getString(OnboardingPrefs.KEY_STEP, null)
        ?: return OnboardingStep.HandlePicker
    val saved = OnboardingStep.fromRaw(raw) ?: return OnboardingStep.HandlePicker
    return when (saved) {
        OnboardingStep.HandlePicker,
        OnboardingStep.PinSetup,
        OnboardingStep.Permissions,
        OnboardingStep.Done -> saved

        else -> OnboardingStep.HandlePicker
    }
}

// ── Welcome-back interstitial ───────────────────────────────────────────────

/**
 * Brief "Welcome back, <name>" beat between a returning user's sign-in and Home —
 * iOS `WelcomeBackInterstitial`. Auto-advances after ~1.4s (or on tap, for the
 * impatient). Greets with the first word of the display name.
 */
@Composable
private fun WelcomeBackInterstitial(name: String?, onFinished: () -> Unit) {
    var appeared by remember { mutableStateOf(false) }
    var finished by remember { mutableStateOf(false) }

    // Idempotent — the tap-to-skip and the timed auto-advance can race.
    fun complete() {
        if (finished) return
        finished = true
        onFinished()
    }

    val contentAlpha by animateFloatAsState(
        targetValue = if (appeared) 1f else 0f,
        animationSpec = tween(durationMillis = 450),
        label = "welcomeBackAlpha",
    )
    val contentOffset by animateDpAsState(
        targetValue = if (appeared) 0.dp else 10.dp,
        animationSpec = tween(durationMillis = 450),
        label = "welcomeBackOffset",
    )
    val logoScale by animateFloatAsState(
        targetValue = if (appeared) 1f else 0.85f,
        animationSpec = tween(durationMillis = 450),
        label = "welcomeBackLogoScale",
    )

    LaunchedEffect(Unit) {
        appeared = true
        delay(1_400)
        complete()
    }

    val firstName = name
        ?.trim()
        ?.split(Regex("\\s+"))
        ?.firstOrNull()
        ?.takeIf { it.isNotEmpty() }

    Box(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { complete() }
    ) {
        OnboardingBackground(Modifier.fillMaxSize())

        Column(
            Modifier
                .fillMaxSize()
                .alpha(contentAlpha)
                .offset(y = contentOffset),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))

            Image(
                painter = painterResource(R.drawable.taliselogo),
                contentDescription = "Talise",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .size(96.dp)
                    .scale(logoScale),
            )

            Text(
                firstName?.let { "Welcome back, $it" } ?: "Welcome back",
                style = TaliseType.heading(26.sp, FontWeight.SemiBold),
                letterSpacing = (-0.78).sp,
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 28.dp, start = 32.dp, end = 32.dp),
            )

            Text(
                "Taking you to your money.",
                style = TaliseType.body(14.sp, FontWeight.Light),
                letterSpacing = (-0.42).sp,
                color = TaliseColors.fgMuted,
                modifier = Modifier.padding(top = 10.dp),
            )

            Spacer(Modifier.weight(1f))
        }
    }
}
