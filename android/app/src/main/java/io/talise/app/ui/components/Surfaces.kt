package io.talise.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.talise.app.ui.theme.TaliseColors

/**
 * The core Talise surface — flat `surface` fill + 1px `line` hairline, optional tint wash.
 * Mirrors iOS `.taliseGlass(cornerRadius:tint:)` ("Liquid Glass" is flat now: no blur/gradient).
 */
fun Modifier.taliseGlass(
    radius: Dp = 25.dp,
    tint: Color? = null,
): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .clip(shape)
        .background(TaliseColors.surface, shape)
        .then(if (tint != null) Modifier.background(tint.copy(alpha = 0.10f), shape) else Modifier)
        .border(1.dp, TaliseColors.line, shape)
}

/** Ramp-flow card chrome — equivalent to iOS `.rampCard()` (taliseGlass at radius 20). */
fun Modifier.rampCard(): Modifier = taliseGlass(radius = 20.dp)
