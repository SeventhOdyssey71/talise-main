package io.talise.app.feature.onboarding

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Hero onboarding screen — iOS `WelcomeView`. A mossy-green wash fills the top ~42% of
 * the viewport then falls hard into black; the Talise mark sits centered just below the
 * gradient transition; bottom-left "Move money without borders" headline + supporting
 * subtitle frames the two CTAs (primary "Get Started", secondary "I have an account")
 * above a small Terms acknowledgement footer.
 *
 * `onContinue` → new user path. `onSignIn` → straight to sign-in (returning user).
 */
@Composable
fun WelcomeView(onContinue: () -> Unit, onSignIn: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        val screenH = maxHeight

        // Top green wash — linear, even across the width, fading vertically. Stops
        // match iOS: 0% mossy green, 45% transition midpoint, 85% pure black. Sized
        // to ~42% of the screen height so the logo lands just below it.
        Box(
            Modifier
                .fillMaxWidth()
                .height(screenH * 0.42f)
                .background(
                    Brush.verticalGradient(
                        0.0f to Color(0xFF6BA85A),
                        0.45f to Color(0xFF355626),
                        0.85f to Color(0xFF000000),
                        1.0f to Color(0xFF000000),
                    )
                )
        )

        Column(
            Modifier.fillMaxSize().navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Logo positioned just below the gradient's end (~50% of screen height).
            Spacer(Modifier.height(screenH * 0.42f))

            Image(
                painter = painterResource(R.drawable.taliselogo),
                contentDescription = "Talise",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(88.dp),
            )

            Spacer(Modifier.weight(1f))

            CopyBlock(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 22.dp)
            )

            PrimaryCta(
                onClick = onContinue,
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 12.dp),
            )

            SecondaryCta(
                onClick = onSignIn,
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 18.dp),
            )

            TermsFooter(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp)
                    .padding(bottom = 28.dp)
            )
        }
    }
}

@Composable
private fun CopyBlock(modifier: Modifier = Modifier) {
    Column(modifier) {
        // Headline — Figma spec: 23.5px / 600 / -0.705 letter spacing.
        Text(
            "Move money without borders",
            style = TaliseType.heading(23.5.sp, FontWeight.SemiBold),
            letterSpacing = (-0.705).sp,
            color = TaliseColors.fg,
            maxLines = 1,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "Moving money across the world is complex, Talise brings simplicity to this. No network fees, smart money movement.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            letterSpacing = (-0.39).sp,
            lineHeight = 17.sp,
            color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun PrimaryCta(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(27.dp))
            .background(TaliseColors.fg)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "Get Started",
            style = TaliseType.body(15.sp, FontWeight.Medium),
            letterSpacing = (-0.45).sp,
            color = TaliseColors.bg,
        )
    }
}

@Composable
private fun SecondaryCta(onClick: () -> Unit, modifier: Modifier = Modifier) {
    // Glassmorphic capsule — soft white fill + specular hairline so the pill reads
    // as a frosted surface against the black page (iOS `taliseGlass(cornerRadius: 27)`).
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(27.dp))
            .background(Color.White.copy(alpha = 0.08f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(27.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "I have an account",
            style = TaliseType.body(15.sp, FontWeight.Medium),
            letterSpacing = (-0.45).sp,
            color = TaliseColors.fg,
        )
    }
}

@Composable
private fun TermsFooter(modifier: Modifier = Modifier) {
    Text(
        buildAnnotatedString {
            append("You accept ")
            withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) {
                append("Terms and Conditions")
            }
            append(" by continuing.")
        },
        style = TaliseType.body(11.sp, FontWeight.Light),
        letterSpacing = (-0.33).sp,
        color = TaliseColors.fgDim,
        textAlign = TextAlign.Center,
        modifier = modifier,
    )
}
