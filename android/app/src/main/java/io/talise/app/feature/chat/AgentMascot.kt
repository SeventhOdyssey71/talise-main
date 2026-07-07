package io.talise.app.feature.chat

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.talise.app.R

/**
 * Talise Agent mascot — the brand mark (`applogo`), the Android counterpart of
 * iOS `AgentMascot`. Used as the chat header avatar (small, static), the
 * assistant bubble avatar, and the chat empty-state hero (large, gently
 * animated: an idle float + head sway, mirroring the iOS lift/sway beat).
 */
@Composable
fun AgentMascot(size: Dp, animated: Boolean = false) {
    var modifier: Modifier = Modifier.size(size)
    if (animated) {
        val transition = rememberInfiniteTransition(label = "mascot-idle")
        val lift by transition.animateFloat(
            initialValue = 0f,
            targetValue = -(size.value * 0.03f),
            animationSpec = infiniteRepeatable(tween(durationMillis = 2400), RepeatMode.Reverse),
            label = "mascot-lift",
        )
        val sway by transition.animateFloat(
            initialValue = -3.5f,
            targetValue = 3.5f,
            animationSpec = infiniteRepeatable(tween(durationMillis = 3400), RepeatMode.Reverse),
            label = "mascot-sway",
        )
        modifier = modifier
            .offset(y = lift.dp)
            .rotate(sway)
    }
    Image(
        painter = painterResource(R.drawable.applogo),
        contentDescription = "Talise Copilot",
        modifier = modifier,
    )
}
