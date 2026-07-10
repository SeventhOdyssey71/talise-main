package io.talise.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseSize
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Drag-to-confirm capsule — iOS `SlideToConfirm`. 58dp track, knob slides L→R, title
 * fades with progress, releasing past 80% snaps to the end and runs [onConfirm] while
 * showing a spinner. Releasing short springs back. Flipping [reset] forces the knob home
 * after a failed attempt, exactly like the SwiftUI `reset` binding.
 */
@Composable
fun SlideToConfirm(
    title: String,
    onConfirm: suspend () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = TaliseColors.accent,
    reset: Boolean = false,
) {
    val density = LocalDensity.current
    val trackH = TaliseSize.slideTrack
    val inset = 4.dp
    val knob = trackH - inset * 2

    var trackWidthPx by remember { mutableFloatStateOf(0f) }
    var dragX by remember { mutableFloatStateOf(0f) }
    var confirming by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val knobPx = with(density) { knob.toPx() }
    val insetPx = with(density) { inset.toPx() }
    val maxTravel = (trackWidthPx - knobPx - insetPx * 2).coerceAtLeast(0f)
    val progress = if (maxTravel > 0f) (dragX / maxTravel).coerceIn(0f, 1f) else 0f

    LaunchedEffect(reset) { if (reset) { dragX = 0f; confirming = false } }

    val animatedX by animateFloatAsState(
        targetValue = dragX,
        animationSpec = spring(dampingRatio = 0.8f, stiffness = 420f),
        label = "knob",
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(trackH)
            .clip(CircleShape)
            .background(TaliseColors.surface2)
            .border(1.dp, TaliseColors.line, CircleShape)
            .alpha(if (enabled) 1f else 0.5f)
            .onSizeChanged { trackWidthPx = it.width.toFloat() },
        contentAlignment = Alignment.CenterStart,
    ) {
        // Progress fill behind the knob (flat tint @22%).
        Box(
            Modifier
                .fillMaxHeight()
                .width(with(density) { (animatedX + knobPx + insetPx * 2).roundToInt().toDp() })
                .clip(CircleShape)
                .background(tint.copy(alpha = 0.22f)),
        )
        // Title — fades out as the knob advances.
        Text(
            title,
            style = TaliseType.heading(16.sp, FontWeight.Medium),
            color = TaliseColors.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .alpha((1f - progress * 1.6f).coerceIn(0f, 1f)),
        )
        // Knob.
        Box(
            Modifier
                .padding(inset)
                .offset { IntOffset(animatedX.roundToInt(), 0) }
                .size(knob)
                .clip(CircleShape)
                .background(tint)
                .pointerInput(enabled, maxTravel) {
                    if (!enabled) return@pointerInput
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            // Recompute from live state: the composition-time `progress` local
                            // is captured when this pointerInput block launches (its keys don't
                            // change during a drag), so it is stale here — always the value from
                            // block start, which would make the slider never confirm.
                            val endProgress = if (maxTravel > 0f) (dragX / maxTravel).coerceIn(0f, 1f) else 0f
                            if (endProgress >= 0.8f && !confirming) {
                                confirming = true
                                dragX = maxTravel
                                scope.launch { onConfirm() }
                            } else if (!confirming) {
                                dragX = 0f
                            }
                        },
                    ) { _, delta ->
                        if (!confirming) dragX = (dragX + delta).coerceIn(0f, maxTravel)
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            if (confirming) {
                CircularProgressIndicator(color = TaliseColors.inkOnGreen, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            } else {
                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = TaliseColors.inkOnGreen, modifier = Modifier.size(20.dp))
            }
        }
    }
}
