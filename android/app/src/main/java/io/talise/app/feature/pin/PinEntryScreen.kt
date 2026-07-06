package io.talise.app.feature.pin

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * PIN entry — Android port of iOS `PinEntrySheet`.
 *
 * Apple-lockscreen feel: a tight title block, four filled/hollow dots that fill
 * white as you type, and a chrome-less numeric keypad (0-9 + backspace). Fires
 * `onComplete` once `pinLength` digits are entered (matches iOS: 4 digits).
 *
 * Self-contained: does not touch nav/Routes. Signature:
 *   PinEntryScreen(title, onComplete: (String) -> Unit, onClose: () -> Unit)
 */
private const val PIN_LENGTH = 4

@Composable
fun PinEntryScreen(
    title: String = "Enter your PIN",
    onComplete: (String) -> Unit,
    onClose: () -> Unit,
) {
    var entry by remember { mutableStateOf("") }

    // Defer one tick after the final digit so the last dot animates in before
    // the caller dismisses / advances (matches iOS' 120ms deferral).
    LaunchedEffect(entry) {
        if (entry.length == PIN_LENGTH) {
            val pin = entry
            delay(120)
            onComplete(pin)
        }
    }

    fun tapDigit(d: String) {
        if (entry.length < PIN_LENGTH) entry += d
    }

    fun tapDelete() {
        if (entry.isNotEmpty()) entry = entry.dropLast(1)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
    ) {
        // Close affordance (top-right). iOS hosts this as a bottom sheet with a
        // grabber; on Android we expose an explicit dismiss.
        Icon(
            imageVector = Icons.Filled.Close,
            contentDescription = "Close",
            tint = TaliseColors.fgMuted,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
                .size(24.dp)
                .clip(CircleShape)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClose,
                ),
        )

        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Title block — tight top padding so the eye lands on the dots.
            Text(
                text = title,
                style = TaliseType.heading(22.sp, FontWeight.Medium),
                letterSpacing = (-0.6).sp,
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(top = 22.dp, start = 36.dp, end = 36.dp),
            )

            // PIN dots — four circles that fill white as you type.
            PinDots(
                filledCount = entry.length,
                modifier = Modifier.padding(top = 24.dp),
            )

            Spacer(Modifier.weight(1f))

            // Numeric keypad.
            Numpad(
                onDigit = ::tapDigit,
                onDelete = ::tapDelete,
                modifier = Modifier
                    .padding(horizontal = 40.dp)
                    .padding(bottom = 4.dp),
            )

            Spacer(Modifier.height(14.dp))
        }
    }
}

/** Apple-lockscreen-style filled/hollow dots (iOS `pinDots`). */
@Composable
private fun PinDots(filledCount: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        for (idx in 0 until PIN_LENGTH) {
            val filled = idx < filledCount
            val scale by animateFloatAsState(
                targetValue = if (filled) 1f else 0.9f,
                animationSpec = spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow),
                label = "pinDotScale",
            )
            Box(
                modifier = Modifier
                    .size(15.dp)
                    .scale(scale)
                    .clip(CircleShape)
                    .background(if (filled) TaliseColors.fg else Color.Transparent)
                    .then(
                        if (filled) Modifier
                        else Modifier.border(1.2.dp, TaliseColors.fgDim, CircleShape)
                    ),
            )
        }
    }
}

/** Chrome-less keypad: large numerals, backspace glyph (iOS `numpad`). */
@Composable
private fun Numpad(
    onDigit: (String) -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf("", "0", "del"),
    )
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (row in rows) {
            Row(modifier = Modifier.fillMaxWidth()) {
                for (key in row) {
                    when (key) {
                        "" -> Spacer(Modifier.weight(1f).height(56.dp))
                        "del" -> KeyButton(
                            modifier = Modifier.weight(1f),
                            onClick = onDelete,
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Backspace,
                                contentDescription = "Delete",
                                tint = TaliseColors.fg,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        else -> KeyButton(
                            modifier = Modifier.weight(1f),
                            onClick = { onDigit(key) },
                        ) {
                            Text(
                                text = key,
                                style = TaliseType.display(32.sp, FontWeight.Normal),
                                color = TaliseColors.fg,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** A single 64dp-tall tap target with a brief press flash (iOS `KeyPressStyle`). */
@Composable
private fun KeyButton(
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .height(64.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}
