package io.talise.app.feature.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Sign-in entry — iOS `SignInScreen`. Native zkLogin via Google: Credential Manager
 * returns a nonce-bound ID token → `/api/auth/mobile/exchange` → bearer. Layout mirrors
 * iOS: top green glow, logo, welcome copy, provider button, beta + legal notes.
 */
@Composable
fun SignInScreen(vm: SignInViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val loading = state.loading
    val error = state.error

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Top glow — mossy green → forest → black (iOS TopGlow).
        Box(
            Modifier
                .fillMaxWidth()
                .height(380.dp)
                .background(
                    Brush.verticalGradient(
                        0.0f to TaliseColors.accent.copy(alpha = 0.30f),
                        0.30f to TaliseColors.greenDeep.copy(alpha = 0.22f),
                        0.78f to TaliseColors.bg,
                        1.0f to TaliseColors.bg,
                    )
                )
                .align(Alignment.TopCenter),
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 28.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                Modifier.size(96.dp).background(TaliseColors.surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text("T", style = TaliseType.display(44.sp, FontWeight.SemiBold), color = TaliseColors.accent) }

            Spacer(Modifier.height(28.dp))
            Text("Welcome to Talise", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
            Spacer(Modifier.height(8.dp))
            Text(
                "One tap with Google.\nNo seed phrase, no setup.",
                style = TaliseType.body(14.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(40.dp))
            LiquidGlassButton(
                title = if (loading) "Signing in…" else "Continue with Google",
                tint = TaliseColors.fg, // white provider button
                loading = loading,
                onClick = { vm.signInWithGoogle(context) },
            )

            if (error != null) {
                Spacer(Modifier.height(14.dp))
                Text(error!!, style = TaliseType.body(12.sp), color = TaliseColors.danger, textAlign = TextAlign.Center)
            }

            Spacer(Modifier.height(24.dp))
            Text(
                "Talise is in private beta — access is invite-only.",
                style = TaliseType.body(11.sp, FontWeight.Light),
                color = TaliseColors.fgDim,
                textAlign = TextAlign.Center,
            )
        }
    }
}
