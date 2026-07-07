package io.talise.app.feature.pin

import android.view.HapticFeedbackConstants
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * PIN entry, Android port of iOS `PinEntrySheet` + `PinGate`.
 *
 * Two modes, resolved automatically from stored state (see [PinEntryViewModel]):
 *   - Create: prompt for 4 digits, then prompt again to confirm. Matching
 *     pair -> persist -> `onComplete`.
 *   - Verify: prompt for 4 digits, compare against the stored hash. Wrong
 *     PIN shakes + clears; "Forgot PIN" clears the PIN, signs out, closes.
 *
 * iOS hosts this as a swipe-dismissable bottom sheet; on Android it is a
 * full-screen route, so an explicit close affordance stands in for the
 * sheet's drag-to-dismiss (iOS `onCancel`).
 */
@Composable
fun PinEntryScreen(
    onComplete: (String) -> Unit,
    onClose: () -> Unit,
    reason: String = "Enter your PIN to continue.",
    vm: PinEntryViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val view = LocalView.current

    LaunchedEffect(Unit) {
        vm.events.collect { event ->
            when (event) {
                is PinEntryViewModel.Event.Success -> onComplete(event.pin)
                PinEntryViewModel.Event.ForgotSignOut -> onClose()
            }
        }
    }

    // Horizontal shake, driven by an incrementing trigger (iOS `ShakeEffect`):
    // step the offset through the same keyframes at 50ms per step.
    val shakeOffset = remember { Animatable(0f) }
    LaunchedEffect(state.shakeTrigger) {
        if (state.shakeTrigger > 0) {
            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            val steps = listOf(-10f, 10f, -8f, 8f, -4f, 4f, 0f)
            for (s in steps) {
                shakeOffset.snapTo(s)
                delay(50)
            }
        }
    }

    val titleText = when (state.mode) {
        PinEntryViewModel.Mode.Verify -> "Enter PIN to confirm"
        PinEntryViewModel.Mode.Create ->
            if (state.firstPin == null) "Create your PIN" else "Confirm your PIN"
    }
    val subtitleText = when (state.mode) {
        PinEntryViewModel.Mode.Verify -> reason
        PinEntryViewModel.Mode.Create ->
            if (state.firstPin == null)
                "Set a 4-digit PIN. You'll use it to confirm every transaction."
            else
                "Re-enter the PIN to confirm."
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // Flat near-black sheet — no bloom, no wash. The digits stay the
            // focal point.
            .background(TaliseColors.bg),
    ) {
        // Close affordance (top-right). iOS hosts this as a bottom sheet with a
        // grabber; on Android we expose an explicit dismiss (= iOS onCancel).
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
            // Title block — no icon badge. The header padding here is
            // intentionally tight so the eye lands on the dots, not on
            // an oversized chrome. Crossfade = iOS .contentTransition(.opacity).
            Crossfade(
                targetState = titleText,
                label = "pinTitle",
                modifier = Modifier.padding(top = 22.dp),
            ) { title ->
                Text(
                    text = title,
                    style = TaliseType.heading(22.sp, FontWeight.Medium),
                    letterSpacing = (-0.6).sp,
                    color = TaliseColors.fg,
                    textAlign = TextAlign.Center,
                )
            }
            Text(
                text = subtitleText,
                style = TaliseType.body(13.sp),
                color = TaliseColors.fgMuted,
                textAlign = TextAlign.Center,
                lineHeight = 18.sp,
                modifier = Modifier
                    .padding(horizontal = 36.dp)
                    .padding(top = 6.dp),
            )

            PinDots(
                filledCount = state.entry.length,
                modifier = Modifier
                    .padding(top = 24.dp)
                    .offset { IntOffset(shakeOffset.value.dp.roundToPx(), 0) },
            )

            val failure = state.failureMessage
            if (failure != null) {
                Text(
                    text = failure,
                    style = TaliseType.body(12.sp),
                    color = TaliseColors.danger,
                    modifier = Modifier.padding(top = 10.dp),
                )
            } else {
                Spacer(Modifier.height(26.dp))
            }

            Spacer(Modifier.weight(1f))

            Numpad(
                onDigit = { d ->
                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    vm.tapDigit(d)
                },
                onDelete = {
                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    vm.tapDelete()
                },
                modifier = Modifier
                    .padding(horizontal = 40.dp)
                    .padding(bottom = 4.dp),
            )

            if (state.mode == PinEntryViewModel.Mode.Verify) {
                Text(
                    text = "Forgot PIN?",
                    style = TaliseType.body(13.sp, FontWeight.Medium),
                    color = TaliseColors.fgSubtle,
                    textDecoration = TextDecoration.Underline,
                    modifier = Modifier
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = vm::forgotPin,
                        )
                        .padding(vertical = 10.dp)
                        .padding(bottom = 4.dp),
                )
            } else {
                Spacer(Modifier.height(14.dp))
            }
        }
    }
}

/**
 * Apple-lockscreen-style filled/hollow circles (iOS `pinDots`). No box
 * outlines — just four dots that fill in white as you type.
 */
@Composable
private fun PinDots(filledCount: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        for (idx in 0 until PIN_LENGTH) {
            val filled = idx < filledCount
            // iOS: .spring(response: 0.22, dampingFraction: 0.7) — response
            // 0.22s maps to stiffness (2*pi/0.22)^2 ~= 816.
            val scale by animateFloatAsState(
                targetValue = if (filled) 1f else 0.9f,
                animationSpec = spring(dampingRatio = 0.7f, stiffness = 816f),
                label = "pinDotScale",
            )
            val fill by animateColorAsState(
                targetValue = if (filled) TaliseColors.fg else Color.Transparent,
                animationSpec = spring(dampingRatio = 0.7f, stiffness = 816f),
                label = "pinDotFill",
            )
            Box(
                modifier = Modifier
                    .size(15.dp)
                    .scale(scale)
                    .clip(CircleShape)
                    .background(fill)
                    .then(
                        if (filled) Modifier
                        else Modifier.border(1.2.dp, TaliseColors.fgDim, CircleShape)
                    ),
            )
        }
    }
}

/**
 * Native-feeling keypad (iOS `numpad`): large numerals, no per-key chrome.
 * Tap targets stay 64dp tall so the buttons remain accessible; the capsule
 * fill is hidden because it made the whole grid look heavy.
 */
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
                        // iOS blank key: Color.clear, 56pt tall.
                        "" -> Spacer(
                            Modifier
                                .weight(1f)
                                .height(56.dp)
                        )
                        // iOS delete key: plain button style — no press flash.
                        "del" -> Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(64.dp)
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = onDelete,
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Backspace,
                                contentDescription = "Delete",
                                tint = TaliseColors.fg,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        else -> DigitKey(
                            digit = key,
                            onClick = { onDigit(key) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/**
 * A single digit key with iOS `KeyPressStyle` feedback: a brief 72dp circular
 * background flash on press (white @ 8%), no border / no capsule chrome.
 */
@Composable
private fun DigitKey(
    digit: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val flashAlpha by animateFloatAsState(
        targetValue = if (pressed) 0.08f else 0f,
        animationSpec = tween(durationMillis = 150, easing = LinearOutSlowInEasing),
        label = "keyFlash",
    )
    Box(
        modifier = modifier
            .height(64.dp)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = flashAlpha))
        )
        Text(
            text = digit,
            style = TaliseType.display(32.sp, FontWeight.Normal),
            color = TaliseColors.fg,
        )
    }
}
