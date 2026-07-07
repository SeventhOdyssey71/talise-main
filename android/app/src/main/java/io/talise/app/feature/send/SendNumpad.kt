package io.talise.app.feature.send

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Tap-only 3×4 numpad — the Android port of iOS `SendNumpad`.
 *
 * Behavior contract (verbatim from iOS):
 *   - Digits append to the input string.
 *   - "." is a no-op when the input already contains a decimal mark.
 *   - Backspace removes one trailing character; empty input is a no-op.
 *   - Hard cap on the integer portion (default 9 digits).
 *   - Hard cap on fractional digits (default 2).
 */
@Composable
fun SendNumpad(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    maxIntegerDigits: Int = 9,
    maxFractionDigits: Int = 2,
    haptics: Boolean = true,
) {
    val haptic = LocalHapticFeedback.current

    fun backspace(): String = if (value.isEmpty()) value else value.dropLast(1)

    fun insertDecimal(): String = when {
        value.contains(".") -> value
        value.isEmpty() -> "0."     // Bare "." reads as "0."
        else -> "$value."
    }

    fun insertDigit(d: String): String {
        // Strip a leading zero unless we're typing a decimal ("0.…").
        if (value == "0") return d
        val dot = value.indexOf('.')
        if (dot >= 0) {
            val fractionLen = value.length - dot - 1
            if (fractionLen >= maxFractionDigits) return value
        } else {
            if (value.length >= maxIntegerDigits) return value
        }
        return value + d
    }

    fun tap(key: String) {
        val next = when (key) {
            "<" -> backspace()
            "." -> insertDecimal()
            else -> insertDigit(key)
        }
        if (next != value) onValueChange(next)
        if (haptics) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf(".", "0", "<"),   // "<" is the backspace key
        ).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { key -> NumpadKey(key, onTap = { tap(key) }) }
            }
        }
    }
}

/**
 * A single key. Slight press-darken + scale so a 60dp-tall hit target still
 * feels tactile — no filled-in chip background; the digits sit on the page.
 */
@Composable
private fun RowScope.NumpadKey(key: String, onTap: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.94f else 1f,
        animationSpec = tween(120),
        label = "numpadKeyScale",
    )

    Box(
        Modifier
            .weight(1f)
            .height(60.dp)
            .clickable(interactionSource = interaction, indication = null) { onTap() },
        contentAlignment = Alignment.Center,
    ) {
        // Press disc — surface2 circle that appears only while pressed.
        Box(
            Modifier
                .size(64.dp)
                .graphicsLayer { alpha = if (pressed) 1f else 0f }
                .background(TaliseColors.surface2, CircleShape),
        )
        Box(
            Modifier.graphicsLayer {
                scaleX = scale
                scaleY = scale
            },
            contentAlignment = Alignment.Center,
        ) {
            if (key == "<") {
                Icon(
                    Icons.AutoMirrored.Outlined.Backspace,
                    contentDescription = "Delete",
                    tint = TaliseColors.fg,
                    modifier = Modifier.size(22.dp),
                )
            } else {
                Text(key, style = TaliseType.heading(28.sp, FontWeight.Normal), color = TaliseColors.fg)
            }
        }
    }
}
