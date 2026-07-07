package io.talise.app.feature.send

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.talise.app.ui.theme.TaliseColors

/**
 * Wireframe "3D" check — iOS `SendSuccessAnimation` / `Check3DShape`. No
 * outer ring, no halo: just the check drawn as a ribbon-extrusion outline
 * with an inner crease line at the vertex, same construction logic as the
 * paper plane (outer silhouette + interior fold line). Stroke draw-on,
 * gentle float.
 */
@Composable
fun SendSuccessAnimation(size: Dp = 140.dp, color: Color = TaliseColors.accent) {
    val drawProgress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        drawProgress.animateTo(1f, tween(durationMillis = 1100, easing = EaseInOut))
    }
    val infinite = rememberInfiniteTransition(label = "checkFloat")
    val float by infinite.animateFloat(
        initialValue = 1f,
        targetValue = -1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1600, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "float",
    )

    Canvas(
        Modifier
            .size(size)
            .graphicsLayer {
                rotationZ = -3f * float
                translationY = 3f * density * float
            },
    ) {
        val (outline, fold) = check3DPaths(this.size.width, this.size.height)
        drawPath(
            path = trimmedPath(listOf(outline, fold), drawProgress.value),
            brush = SolidColor(color),
            style = Stroke(
                width = 2.4.dp.toPx(),
                cap = StrokeCap.Round,
                join = StrokeJoin.Round,
            ),
        )
    }
}

/**
 * Ribbon-extrusion checkmark paths — two parallel check strokes (offset
 * perpendicular to the visual direction) form the front and back edges of a
 * thin band; the caps close the ribbon and an interior fold line at the
 * vertex gives the folded-paper feel. Tuned by eye for a 140pt frame; all
 * coordinates are fractions of the bounding rect so it scales cleanly.
 */
private fun check3DPaths(w: Float, h: Float): Pair<Path, Path> {
    // Front (top) edge of the check ribbon — start → vertex → end.
    val startFrontX = w * 0.14f; val startFrontY = h * 0.48f
    val vertexFrontX = w * 0.42f; val vertexFrontY = h * 0.74f
    val endFrontX = w * 0.86f; val endFrontY = h * 0.22f

    // Back (bottom) edge — same path, offset down-right to imply depth.
    val dx = w * 0.045f
    val dy = h * 0.055f

    val outline = Path().apply {
        moveTo(startFrontX, startFrontY)
        lineTo(vertexFrontX, vertexFrontY)
        lineTo(endFrontX, endFrontY)
        lineTo(endFrontX + dx, endFrontY + dy)
        lineTo(vertexFrontX + dx, vertexFrontY + dy)
        lineTo(startFrontX + dx, startFrontY + dy)
        close()
    }
    // Interior fold line at the vertex — what makes the check read as a
    // folded ribbon rather than a flat outline.
    val fold = Path().apply {
        moveTo(vertexFrontX, vertexFrontY)
        lineTo(vertexFrontX + dx, vertexFrontY + dy)
    }
    return Pair(outline, fold)
}
