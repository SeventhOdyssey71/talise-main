package io.talise.app.feature.onboarding

import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * Brief celebration frame — iOS `OnboardingCompletedView`. Animates the checkmark
 * treatment (soft accent ring springs in, check fades in just after), then after
 * ~1.4s hands off via [onDismiss] which routes into the app.
 */
@Composable
fun OnboardingCompletedView(onDismiss: () -> Unit) {
    var started by remember { mutableStateOf(false) }

    val ringScale by animateFloatAsState(
        targetValue = if (started) 1f else 0.6f,
        animationSpec = spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow),
        label = "ringScale",
    )
    val ringOpacity by animateFloatAsState(
        targetValue = if (started) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow),
        label = "ringOpacity",
    )
    val checkOpacity by animateFloatAsState(
        targetValue = if (started) 1f else 0f,
        animationSpec = tween(durationMillis = 250, delayMillis = 150, easing = LinearOutSlowInEasing),
        label = "checkOpacity",
    )

    LaunchedEffect(Unit) {
        started = true
        delay(1_400)
        onDismiss()
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size(96.dp)
                        .scale(ringScale)
                        .alpha(ringOpacity)
                        .clip(CircleShape)
                        .background(TaliseColors.accent.copy(alpha = 0.15f))
                )
                Icon(
                    imageVector = Icons.Filled.Check,
                    contentDescription = null,
                    tint = TaliseColors.accent,
                    modifier = Modifier
                        .size(44.dp)
                        .alpha(checkOpacity),
                )
            }

            Spacer(Modifier.size(18.dp))

            Text(
                "You're all set",
                style = TaliseType.heading(28.sp, FontWeight.Medium),
                letterSpacing = (-0.8).sp,
                color = TaliseColors.fg,
                modifier = Modifier.padding(top = 10.dp),
            )

            Spacer(Modifier.size(18.dp))

            Text(
                "Your wallet is ready. Taking you in…",
                style = TaliseType.body(14.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}
