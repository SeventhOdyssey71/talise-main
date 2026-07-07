package io.talise.app.feature.send

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.talise.app.ui.theme.TaliseColors
import kotlin.math.PI
import kotlin.math.sin

/**
 * Stylized paper-plane path builder — iOS `SendPaperPlane` Shape. Two
 * stroked subpaths sharing the nose: the outer body silhouette and a
 * smaller crease line that suggests a folded wing. Built so a length-trim
 * produces a clean draw-on animation from tail to tip.
 */
private fun planePaths(w: Float, h: Float): Pair<Path, Path> {
    // Outer plane silhouette: tail (bottom-left) → nose (top-right)
    // → wing (mid-right) → fuselage (center) → tail.
    val tailX = w * 0.05f; val tailY = h * 0.85f
    val noseX = w * 0.95f; val noseY = h * 0.10f
    val wingX = w * 0.55f; val wingY = h * 0.60f
    val bellyX = w * 0.40f; val bellyY = h * 0.45f

    val outer = Path().apply {
        moveTo(tailX, tailY)
        lineTo(noseX, noseY)
        lineTo(wingX, wingY)
        lineTo(bellyX, bellyY)
        close()
    }
    // Inner crease — nose down to the wing-fold, for a hint of depth.
    val crease = Path().apply {
        moveTo(noseX, noseY)
        lineTo(bellyX, bellyY)
    }
    return Pair(outer, crease)
}

/**
 * Trim a list of contours to [progress] of their combined length — the
 * Compose stand-in for SwiftUI's `.trim(from:to:)` across subpaths.
 */
internal fun trimmedPath(contours: List<Path>, progress: Float): Path {
    val out = Path()
    if (progress >= 1f) {
        contours.forEach { out.addPath(it) }
        return out
    }
    if (progress <= 0f) return out
    val measures = contours.map { c -> PathMeasure().apply { setPath(c, false) } }
    val total = measures.fold(0f) { acc, m -> acc + m.length }
    var remaining = total * progress
    for (m in measures) {
        if (remaining <= 0f) break
        val seg = if (m.length < remaining) m.length else remaining
        m.getSegment(0f, seg, out, true)
        remaining -= m.length
    }
    return out
}

/**
 * Animated paper-plane card — iOS `AnimatedPaperPlane`. Renders the plane
 * with a slow stroke-draw once on appear, then a perpetual gentle flutter
 * (slight rotation + translate) so the screen reads as "in flight".
 */
@Composable
fun AnimatedPaperPlane(size: Dp = 120.dp, color: Color = TaliseColors.accent) {
    val drawProgress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        drawProgress.animateTo(1f, tween(durationMillis = 1100, easing = EaseInOut))
    }
    val infinite = rememberInfiniteTransition(label = "planeFlutter")
    val flutter by infinite.animateFloat(
        initialValue = 1f,
        targetValue = -1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1600, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "flutter",
    )

    Canvas(
        Modifier
            .size(size)
            .graphicsLayer {
                rotationZ = 4f * flutter
                translationY = 4f * density * flutter
            },
    ) {
        val (outer, crease) = planePaths(this.size.width, this.size.height)
        drawPath(
            path = trimmedPath(listOf(outer, crease), drawProgress.value),
            brush = Brush.linearGradient(listOf(color.copy(alpha = 0.9f), color)),
            style = Stroke(
                width = 2.2.dp.toPx(),
                cap = StrokeCap.Round,
                join = StrokeJoin.Round,
            ),
        )
    }
}

/**
 * Vertical bars that shimmer left-to-right beneath the plane — iOS
 * `ShimmerBars`. Reads as a soft "transmission" pulse so the screen has
 * rhythm even before the network call comes back.
 */
@Composable
fun ShimmerBars(count: Int = 14, color: Color = TaliseColors.accent) {
    val infinite = rememberInfiniteTransition(label = "shimmerBars")
    // sin(t * 1.6 + frac * 5) on wall time — a full 2π sweep every ~3.93s.
    val phase by infinite.animateFloat(
        initialValue = 0f,
        targetValue = (2 * PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(3927, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "phase",
    )

    Row(
        Modifier.height(24.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { i ->
            val frac = i.toFloat() / count
            val wave = sin(phase + frac * 5f)
            val h = 6f + (1f + wave) * 8f       // 6 → 22dp range
            val alpha = 0.25f + (1f + wave) * 0.2f
            Box(
                Modifier
                    .width(3.dp)
                    .height(h.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = alpha.coerceIn(0f, 1f))),
            )
        }
    }
}
