package io.talise.app.feature.onboarding

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/**
 * Shared onboarding backdrop, iOS `OnboardingBackground`. A mossy-green vertical wash at the
 * top fading into pure black, plus a soft pastel-green bloom anchored top-right (screen blend)
 * for the frosted-glass highlight from the reference screens.
 */
@Composable
fun OnboardingBackground(modifier: Modifier = Modifier) {
    Box(
        modifier.background(
            Brush.verticalGradient(
                0.0f to Color(0xFF6BA85A),
                0.28f to Color(0xFF355626),
                0.68f to Color(0xFF000000),
                1.0f to Color(0xFF000000),
            )
        )
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val minWH = minOf(size.width, size.height)
            val bloomRadius = minWH * 0.55f
            // Circle centered then shifted top-right: (W/2 + W*0.35, H/2 - H*0.45).
            val center = Offset(size.width * 0.85f, size.height * 0.05f)
            drawCircle(
                brush = Brush.radialGradient(
                    0.0f to Color(0xFF9BD68A).copy(alpha = 0.55f),
                    0.5f to Color(0xFF6BA85A).copy(alpha = 0.18f),
                    1.0f to Color.Transparent,
                    center = center,
                    radius = bloomRadius,
                ),
                radius = bloomRadius,
                center = center,
                blendMode = BlendMode.Screen,
            )
        }
    }
}
