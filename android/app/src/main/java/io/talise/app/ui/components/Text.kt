package io.talise.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** Mono uppercase section label — iOS `Eyebrow` (mono 10, tracking 2.0, fgMuted). */
@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = TaliseColors.fgMuted) {
    Text(
        text = text.uppercase(),
        style = TaliseType.mono(10.sp),
        letterSpacing = 2.0.sp,
        color = color,
        modifier = modifier,
    )
}

/** Tiny mono caption — iOS `MicroLabel` (mono 8, tight kerning). */
@Composable
fun MicroLabel(text: String, modifier: Modifier = Modifier, color: Color = TaliseColors.fg) {
    Text(
        text = text,
        style = TaliseType.mono(8.sp),
        letterSpacing = (-0.32).sp,
        color = color,
        modifier = modifier,
    )
}

/**
 * Big money figure with an eyebrow + optional caption — iOS `HeroAmount`.
 * `value` is the formatted string (currency composed by the caller).
 */
@Composable
fun HeroAmount(
    eyebrow: String,
    value: String,
    symbol: String? = null,
    unit: String? = null,
    caption: String? = null,
    captionAccent: Boolean = false,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(eyebrow.uppercase(), style = TaliseType.mono(10.sp), letterSpacing = 2.0.sp, color = TaliseColors.fgMuted)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (symbol != null) Text(symbol, style = TaliseType.mono(15.sp), color = TaliseColors.fgDim)
            Text(
                value,
                style = TaliseType.display(42.sp, FontWeight.SemiBold),
                letterSpacing = (-1.6).sp,
                color = TaliseColors.fg,
            )
            if (unit != null) Text(unit, style = TaliseType.mono(15.sp), color = TaliseColors.fgDim, modifier = Modifier.padding(start = 2.dp))
        }
        if (caption != null) {
            Text(
                caption,
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = if (captionAccent) TaliseColors.accent else TaliseColors.fgMuted,
            )
        }
    }
}

/** Eyebrow + value tile on a flat card — iOS `StatTile`. */
@Composable
fun StatTile(
    eyebrow: String,
    value: String,
    modifier: Modifier = Modifier,
    accent: Boolean = false,
) {
    Column(
        modifier = modifier
            .taliseGlass(radius = 20.dp)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(eyebrow.uppercase(), style = TaliseType.mono(10.sp), letterSpacing = 2.0.sp, color = TaliseColors.fgMuted)
        Text(
            value,
            style = TaliseType.heading(22.sp, FontWeight.Medium),
            letterSpacing = (-0.8).sp,
            color = if (accent) TaliseColors.accent else TaliseColors.fg,
        )
    }
}
