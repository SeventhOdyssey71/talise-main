package io.talise.app.feature.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.R
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Sign-in entry, mirrors iOS `Onboarding/SignInScreen`. Native zkLogin via Google:
 * Credential Manager returns a nonce-bound ID token → `/api/auth/mobile/exchange` →
 * bearer. Layout matches iOS: shared onboarding backdrop (mossy-green wash → black with a
 * top-right bloom), Talise pinwheel hero, welcome copy, a white "Continue with Google"
 * capsule CTA, then the beta + legal notes. iOS also offers Apple; Android is Google-only,
 * so the subtitle names Google alone (auth wiring unchanged).
 */
@Composable
fun SignInScreen(vm: SignInViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val loading = state.loading
    val error = state.error

    // True once at least one successful sign-in happened on this device — drives the
    // "Welcome back" copy for returning users (iOS `talise.hasSignedInBefore`).
    val returningUser = remember {
        OnboardingPrefs.of(context).getBoolean(OnboardingPrefs.KEY_HAS_SIGNED_IN_BEFORE, false)
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        OnboardingBackground(Modifier.fillMaxSize())

        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Leaves room for the progress-bar overlay the iOS coordinator mounts here.
            Spacer(Modifier.height(70.dp))
            Spacer(Modifier.weight(1f))

            // Talise pinwheel hero, the real brand mark (96×96, fit).
            Image96Logo()

            Text(
                if (returningUser) "Welcome back" else "Welcome to Talise",
                style = TaliseType.heading(26.sp, FontWeight.SemiBold),
                letterSpacing = (-0.78).sp,
                color = TaliseColors.fg,
                modifier = Modifier.padding(top = 28.dp),
            )
            Text(
                if (returningUser) "Sign in to your Talise account."
                else "One tap with Google.\nNo seed phrase, no setup.",
                style = TaliseType.body(14.sp, FontWeight.Light),
                letterSpacing = (-0.42).sp,
                color = TaliseColors.fgMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp, start = 32.dp, end = 32.dp),
            )

            Spacer(Modifier.weight(1f))

            if (error != null) {
                Text(
                    error,
                    style = TaliseType.body(12.sp),
                    color = TaliseColors.danger,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 8.dp),
                )
            }

            // Provider CTA, white 54dp capsule, Google G leading the label.
            ContinueWithGoogleButton(
                loading = loading,
                onClick = { vm.signInWithGoogle(context) },
                modifier = Modifier.padding(horizontal = 24.dp),
            )

            Text(
                "Talise is in private beta. Access is invite-only.",
                style = TaliseType.body(11.sp, FontWeight.Light),
                letterSpacing = (-0.33).sp,
                color = TaliseColors.fgDim,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp, start = 24.dp, end = 24.dp),
            )
            Text(
                "By continuing you agree to our Terms and Privacy.",
                style = TaliseType.body(11.sp, FontWeight.Light),
                letterSpacing = (-0.33).sp,
                color = TaliseColors.fgDim,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp, bottom = 28.dp, start = 24.dp, end = 24.dp),
            )
        }
    }
}

/** Talise pinwheel brand mark, 96×96 fit, iOS `hero` (`Image("TaliseLogo")`). */
@Composable
private fun Image96Logo() {
    androidx.compose.foundation.Image(
        painter = painterResource(R.drawable.taliselogo),
        contentDescription = "Talise",
        contentScale = ContentScale.Fit,
        modifier = Modifier.size(96.dp),
    )
}

/**
 * White capsule CTA, iOS `continueWithGoogleButton` (54dp tall, white fill, dark ink label,
 * 20dp leading Google G). While loading the G is swapped for a dark spinner; label unchanged.
 */
@Composable
private fun ContinueWithGoogleButton(
    loading: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(27.dp))
            .background(TaliseColors.fg)
            .clickable(enabled = !loading) { onClick() },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) {
            CircularProgressIndicator(
                color = TaliseColors.bg,
                strokeWidth = 2.dp,
                modifier = Modifier.size(20.dp),
            )
        } else {
            androidx.compose.foundation.Image(
                painter = painterResource(R.drawable.googleg),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(20.dp),
            )
        }
        Spacer(Modifier.size(10.dp))
        Text(
            "Continue with Google",
            style = TaliseType.body(15.sp, FontWeight.Medium),
            letterSpacing = (-0.45).sp,
            color = TaliseColors.bg,
        )
    }
}

// OnboardingBackground moved to its own file (OnboardingBackground.kt) to mirror
// the iOS file layout now that every onboarding step shares it.

