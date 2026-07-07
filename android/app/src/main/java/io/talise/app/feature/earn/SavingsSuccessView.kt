package io.talise.app.feature.earn

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Full-screen success confirmation shown after a successful NAVI supply
 * (invest) — a pixel port of iOS `SavingsSuccessView`. Calm, premium
 * treatment: black field with the shared green glow at the top, the
 * SavingsPiggy art dropping in with the scrapbook wobble, a white headline,
 * one quiet mono sub-line, and the white "Back to Invest" pill.
 *
 * [amountText] is pre-formatted by the caller (EarnViewModel via `earnUsd2`).
 */
@Composable
fun SavingsSuccessView(
    amountText: String,
    onDismiss: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
    ) {
        // Shared green success glow at the top of the field — the Android
        // stand-in for iOS `SuccessGlowBackground`.
        Box(
            Modifier
                .fillMaxWidth()
                .height(360.dp)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            TaliseColors.accent.copy(alpha = 0.22f),
                            TaliseColors.accent.copy(alpha = 0.06f),
                            Color.Transparent,
                        ),
                    ),
                ),
        )

        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))

            // The piggy IS the hero — drops in with the scrapbook wobble
            // (tilted opposite to the send screen's coin stack so the two
            // screens feel hand-placed).
            ScrapbookEntry(delayMs = 50, tiltDegrees = -6f) {
                Image(
                    painter = painterResource(R.drawable.savingspiggy),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.width(300.dp).height(240.dp),
                )
            }

            Spacer(Modifier.height(30.dp))

            ScrapbookFadeUp(delayMs = 220) {
                Text(
                    "You're now earning",
                    style = TaliseType.display(40.sp, FontWeight.Normal),
                    letterSpacing = (-0.8).sp,
                    color = TaliseColors.fg,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
            }

            ScrapbookFadeUp(delayMs = 300) {
                Text(
                    "$amountText is now earning on your idle balance.",
                    style = TaliseType.mono(13.sp),
                    letterSpacing = (-0.26).sp,
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                    lineHeight = 19.sp,
                    modifier = Modifier.width(310.dp).padding(top = 14.dp),
                )
            }

            Spacer(Modifier.weight(1f))

            ScrapbookFadeUp(delayMs = 380) {
                Box(
                    Modifier
                        .width(175.dp)
                        .height(41.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "Back to Invest",
                        style = TaliseType.body(15.sp, FontWeight.Medium),
                        letterSpacing = (-0.3).sp,
                        color = Color.Black,
                    )
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

/**
 * The hand-placed "scrapbook" entrance — the content settles in with a slight
 * over-tilt + scale, landing on [tiltDegrees]. Android port of the iOS
 * `.scrapbookEntry(delay:tilt:)` modifier.
 */
@Composable
private fun ScrapbookEntry(
    delayMs: Long,
    tiltDegrees: Float,
    content: @Composable () -> Unit,
) {
    val alpha = remember { Animatable(0f) }
    val scale = remember { Animatable(1.08f) }
    val rotation = remember { Animatable(tiltDegrees * 2f) }
    LaunchedEffect(Unit) {
        delay(delayMs)
        launch { alpha.animateTo(1f, tween(220)) }
        launch { scale.animateTo(1f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMediumLow)) }
        launch { rotation.animateTo(tiltDegrees, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow)) }
    }
    Box(
        Modifier.graphicsLayer {
            this.alpha = alpha.value
            this.scaleX = scale.value
            this.scaleY = scale.value
            this.rotationZ = rotation.value
        },
    ) { content() }
}

/**
 * Quiet fade-up entrance for the supporting copy — Android port of the iOS
 * `.scrapbookFadeUp(delay:)` modifier.
 */
@Composable
private fun ScrapbookFadeUp(
    delayMs: Long,
    content: @Composable () -> Unit,
) {
    val alpha = remember { Animatable(0f) }
    val offsetY = remember { Animatable(12f) }
    LaunchedEffect(Unit) {
        delay(delayMs)
        launch { alpha.animateTo(1f, tween(260)) }
        launch { offsetY.animateTo(0f, tween(260)) }
    }
    Box(
        Modifier.graphicsLayer {
            this.alpha = alpha.value
            this.translationY = offsetY.value * density
        },
    ) { content() }
}
