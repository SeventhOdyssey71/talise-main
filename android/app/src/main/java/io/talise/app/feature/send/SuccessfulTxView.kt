package io.talise.app.feature.send

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.IosShare
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/** Mint-green celebration accent — iOS `Color(hex: 0xB1F49A)`. */
private val MintGreen = Color(0xFFB1F49A)

/**
 * Full-screen "Transaction Successful!" celebration — iOS `SuccessfulTxView`
 * (Figma node 141:18). Dark theme: black field, a coin stack that drops in
 * scrapbook-style, a large light-green amount, the title line, a one-line
 * mono reassurance, an optional "Saved" pop, and Share Receipt + Done.
 *
 * [amountText] is pre-formatted in the user's display currency, e.g. "$65.00".
 */
@Composable
fun SuccessfulTxView(
    amountText: String,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = "Transaction Successful!",
    subtitle: String = "gas cost = 0, money arrives < 1s",
    onShareReceipt: (() -> Unit)? = null,
    /** Pre-formatted Round-up & Save amount. Null/empty → no pop. */
    savedText: String? = null,
    /** Recipient display name for the receipt copy. Unused visually today. */
    recipientDisplay: String? = null,
) {
    val haptic = LocalHapticFeedback.current
    var showSavedPop by remember { mutableStateOf(false) }

    Column(
        modifier.fillMaxSize().background(TaliseColors.bg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        // Coin stack drops in with the paper-placement wobble, tilted the
        // opposite way from the savings piggy so the screens feel hand-placed.
        Image(
            painter = painterResource(R.drawable.successcoins),
            contentDescription = null,
            modifier = Modifier
                .width(360.dp)
                .height(282.dp)
                .scrapbookEntry(delayMillis = 50, tilt = 6f),
        )

        Spacer(Modifier.height(24.dp))

        Text(
            amountText,
            style = TaliseType.heading(75.sp, FontWeight.Normal),
            letterSpacing = (-1.5).sp,
            color = MintGreen,
            textAlign = TextAlign.Center,
            maxLines = 1,
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .scrapbookFadeUp(delayMillis = 200),
        )

        Text(
            title,
            style = TaliseType.heading(25.sp, FontWeight.Medium),
            letterSpacing = (-0.5).sp,
            color = MintGreen,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 18.dp)
                .scrapbookFadeUp(delayMillis = 280),
        )

        Text(
            subtitle,
            style = TaliseType.mono(13.sp, FontWeight.Normal),
            letterSpacing = (-0.26).sp,
            color = Color.White,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp)
                .scrapbookFadeUp(delayMillis = 340),
        )

        // Spend + Save pop — the auto-saved slice, springing up a beat after
        // the celebration so the save reads as its own moment.
        if (!savedText.isNullOrEmpty()) {
            val popScale by animateFloatAsState(
                targetValue = if (showSavedPop) 1f else 0.6f,
                animationSpec = spring(dampingRatio = 0.62f, stiffness = 200f),
                label = "savedPopScale",
            )
            val popAlpha by animateFloatAsState(
                targetValue = if (showSavedPop) 1f else 0f,
                animationSpec = spring(dampingRatio = 0.62f, stiffness = 200f),
                label = "savedPopAlpha",
            )
            LaunchedEffect(Unit) {
                delay(700)
                showSavedPop = true
                delay(50)
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            }
            Row(
                Modifier
                    .padding(top = 18.dp)
                    .graphicsLayer {
                        scaleX = popScale
                        scaleY = popScale
                        alpha = popAlpha.coerceIn(0f, 1f)
                    }
                    .background(MintGreen.copy(alpha = 0.12f), CircleShape)
                    .border(1.dp, MintGreen.copy(alpha = 0.25f), CircleShape)
                    .padding(horizontal = 18.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Image(
                    painter = painterResource(R.drawable.savingspiggy),
                    contentDescription = null,
                    modifier = Modifier.size(30.dp),
                )
                Text(
                    "Saved $savedText",
                    style = TaliseType.body(14.sp, FontWeight.Medium),
                    letterSpacing = (-0.3).sp,
                    color = MintGreen,
                )
                Text(
                    "· Spend + Save",
                    style = TaliseType.mono(11.sp, FontWeight.Normal),
                    color = TaliseColors.fgDim,
                )
            }
        }

        Spacer(Modifier.weight(1f))

        Row(
            Modifier
                .padding(bottom = 40.dp)
                .scrapbookFadeUp(delayMillis = 400),
            horizontalArrangement = Arrangement.spacedBy(13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Share Receipt — white-on-surface2 pill, 158×41.
            Row(
                Modifier
                    .width(158.dp)
                    .height(41.dp)
                    .background(TaliseColors.surface2, CircleShape)
                    .clickable { onShareReceipt?.invoke() },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Share Receipt",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.3).sp,
                    color = Color.White,
                )
                Spacer(Modifier.width(6.dp))
                Icon(
                    Icons.Outlined.IosShare,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(12.dp),
                )
            }
            // Done — white pill, 92×41, black text.
            Box(
                Modifier
                    .width(92.dp)
                    .height(41.dp)
                    .background(Color.White, CircleShape)
                    .clickable { onDone() },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Done",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.3).sp,
                    color = Color.Black,
                )
            }
        }
    }
}

// ── Scrapbook entry animations (iOS ScrapbookEntry.swift, feature-local) ────

/**
 * "Paper / scrapbook placement" entry: drops in slightly oversized, rotated
 * and lifted, then settles with a bouncy spring — like a paper cutout
 * pressed onto a page.
 */
@Composable
internal fun Modifier.scrapbookEntry(
    delayMillis: Int = 0,
    tilt: Float = -7f,
    lift: Float = -26f,
): Modifier {
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(delayMillis.toLong())
        settled = true
    }
    // Low damping → a visible 1-2 wobble settle, like paper springing flat.
    val t by animateFloatAsState(
        targetValue = if (settled) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.56f, stiffness = 103f),
        label = "scrapbookEntry",
    )
    return this.graphicsLayer {
        val inv = 1f - t
        scaleX = 1f + 0.16f * inv
        scaleY = 1f + 0.16f * inv
        rotationZ = tilt * inv
        translationY = lift * density * inv
        alpha = t.coerceIn(0f, 1f)
    }
}

/**
 * Lighter companion for text — fades up with a small rise and a gentler
 * spring (no rotation).
 */
@Composable
internal fun Modifier.scrapbookFadeUp(delayMillis: Int = 0): Modifier {
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(delayMillis.toLong())
        settled = true
    }
    val t by animateFloatAsState(
        targetValue = if (settled) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.8f, stiffness = 158f),
        label = "scrapbookFadeUp",
    )
    return this.graphicsLayer {
        translationY = 14f * density * (1f - t)
        alpha = t.coerceIn(0f, 1f)
    }
}
