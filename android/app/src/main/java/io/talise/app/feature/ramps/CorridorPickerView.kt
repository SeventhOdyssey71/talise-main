package io.talise.app.feature.ramps

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Clean, full-page country/currency picker for the ramps, ported 1:1 from iOS
 * `CorridorPickerView.swift`. Available corridors render as tappable rows with
 * rounded flags; the not-yet-live tail collapses into a single quiet row of
 * overlapped country circles so the page reads as "here's where you can move
 * money, and here's what's next."
 */
@Composable
fun CorridorPickerView(
    direction: RampDirection,
    /** The signed-in user's ISO country, gates which corridors are bookable
     *  (a Nigerian sees Nigeria cash-out; others -> coming soon). */
    userCountry: String?,
    onSelect: (RampCorridor) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val (available, soon) = RampCorridors.forDirection(direction, userCountry)

    val title = if (direction == RampDirection.Onramp) "Add money" else "Cash out"
    val subtitle = if (direction == RampDirection.Onramp) {
        "Choose where you're funding from."
    } else {
        "Choose where your money should land."
    }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                title,
                style = TaliseType.heading(26.sp, FontWeight.Medium),
                letterSpacing = (-0.6).sp,
                color = TaliseColors.fg,
            )
            Text(
                subtitle,
                style = TaliseType.body(14.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            if (available.isEmpty()) {
                // Nothing bookable in this direction yet, say so plainly
                // instead of an empty "Available now" header.
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(20.dp))
                        .background(TaliseColors.surface, RoundedCornerShape(20.dp))
                        .border(1.dp, TaliseColors.line, RoundedCornerShape(20.dp))
                        .padding(horizontal = 18.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        Icons.Outlined.Schedule,
                        contentDescription = null,
                        tint = TaliseColors.fgMuted,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(
                        "Bank ${if (direction == RampDirection.Onramp) "funding" else "cash-out"} is rolling out, coming soon.",
                        style = TaliseType.body(13.5.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                        modifier = Modifier.weight(1f),
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Eyebrow("Available now", modifier = Modifier.padding(start = 4.dp), color = TaliseColors.fgDim)
                    available.forEach { c ->
                        androidx.compose.foundation.layout.Box(
                            Modifier
                                .clip(RoundedCornerShape(20.dp))
                                .clickable {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onSelect(c)
                                },
                        ) {
                            CorridorRow(corridor = c)
                        }
                    }
                }
            }

            if (soon.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Eyebrow("More countries soon", modifier = Modifier.padding(start = 4.dp), color = TaliseColors.fgDim)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(20.dp))
                            .background(TaliseColors.surface.copy(alpha = 0.6f), RoundedCornerShape(20.dp))
                            .border(1.dp, TaliseColors.line, RoundedCornerShape(20.dp))
                            .padding(horizontal = 18.dp, vertical = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        OverlappedFlags(codes = soon.map { it.code }, size = 34.dp)
                        Text(
                            "We're expanding fast, more rails are on the way.",
                            style = TaliseType.body(12.5.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            // Footer
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            ) {
                Icon(
                    Icons.Filled.Lock,
                    contentDescription = null,
                    tint = TaliseColors.fgDim,
                    modifier = Modifier.size(10.dp),
                )
                Text(
                    if (direction == RampDirection.Onramp) {
                        "Funds land as USDsui, pegged 1:1 to USD on Sui."
                    } else {
                        "Paid out from your USDsui, 1:1 to USD on Sui."
                    },
                    style = TaliseType.mono(10.sp, FontWeight.Light),
                    letterSpacing = 0.2.sp,
                    color = TaliseColors.fgDim,
                )
            }

            Spacer(Modifier.height(0.dp))
        }
    }
}
