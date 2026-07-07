package io.talise.app.feature.withdraw

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.session.AppSession
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Cash-out flow — the Android port of iOS `UnifiedCashOutFlow` (hosted inside
 * `WithdrawFlowView`): ONE country picker; the settlement rail is chosen by
 * the corridor, not the user. Nigeria settles via Linq (NGN), US/Europe via
 * Bridge (USD/EUR).
 *
 * Entry: `WithdrawFlow(onClose)`. The orchestrator registers it as
 * `Routes.WITHDRAW` ([WithdrawRoutes.WITHDRAW]) in TaliseRoot; the Move-money
 * hub's "Cash out" tile navigates here (gated on `features.cashout`).
 */
@Composable
fun WithdrawFlow(onClose: () -> Unit) {
    var page by remember { mutableStateOf<CashOutPage>(CashOutPage.Picker) }

    BackHandler {
        if (page is CashOutPage.Picker) onClose() else page = CashOutPage.Picker
    }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        when (val p = page) {
            is CashOutPage.Picker -> {
                WithdrawTopBar(title = null, onBack = onClose)
                CorridorPickerView(
                    direction = RampDirection.Offramp,
                    userCountry = AppSession.currentUser?.country,
                    onSelect = { corridor ->
                        page = when (corridor.availability) {
                            CorridorAvailability.Local -> CashOutPage.Bank
                            else -> CashOutPage.Bridge(corridor)
                        }
                    },
                )
            }
            is CashOutPage.Bank -> BankWithdrawScreen(onBack = { page = CashOutPage.Picker })
            is CashOutPage.Bridge -> BridgeCashOutScreen(
                corridor = p.corridor,
                onBack = { page = CashOutPage.Picker },
            )
        }
    }
}

private sealed interface CashOutPage {
    data object Picker : CashOutPage
    data object Bank : CashOutPage
    data class Bridge(val corridor: RampCorridor) : CashOutPage
}

/**
 * Slim inline top bar standing in for the iOS navigation bar: back chevron on
 * the left, optional centered inline title.
 */
@Composable
internal fun WithdrawTopBar(title: String?, onBack: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Box(
            Modifier
                .size(38.dp)
                .background(TaliseColors.surface2, CircleShape)
                .clickable { onBack() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = TaliseColors.fg,
                modifier = Modifier.size(18.dp),
            )
        }
        if (title != null) {
            Text(
                title,
                style = TaliseType.heading(17.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.Center),
            )
        }
    }
}

/**
 * Clean, full-page country/currency picker for the ramps — iOS
 * `CorridorPickerView`. Available corridors render as tappable rows with
 * rounded flags; the not-yet-live tail collapses into one quiet row of
 * overlapped country circles.
 */
@Composable
fun CorridorPickerView(
    direction: RampDirection,
    userCountry: String?,
    onSelect: (RampCorridor) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val (available, soon) = remember(direction, userCountry) {
        RampCorridors.forDirection(direction, userCountry)
    }
    val title = if (direction == RampDirection.Onramp) "Add money" else "Cash out"
    val subtitle = if (direction == RampDirection.Onramp) {
        "Choose where you're funding from."
    } else {
        "Choose where your money should land."
    }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 8.dp, bottom = 18.dp),
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
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            if (available.isEmpty()) {
                // Nothing bookable in this direction yet — say so plainly.
                val shape = RoundedCornerShape(20.dp)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(TaliseColors.surface, shape)
                        .border(1.dp, TaliseColors.line, shape)
                        .padding(horizontal = 18.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        Icons.Outlined.Schedule,
                        contentDescription = null,
                        tint = TaliseColors.fgMuted,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        "Bank ${if (direction == RampDirection.Onramp) "funding" else "cash-out"} is rolling out, coming soon.",
                        style = TaliseType.body(13.5.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Eyebrow("Available now", modifier = Modifier.padding(start = 4.dp), color = TaliseColors.fgMuted)
                    available.forEach { c ->
                        Box(
                            Modifier.clickable {
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
                    Eyebrow("More countries soon", modifier = Modifier.padding(start = 4.dp), color = TaliseColors.fgMuted)
                    val shape = RoundedCornerShape(20.dp)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(TaliseColors.surface.copy(alpha = 0.6f), shape)
                            .border(1.dp, TaliseColors.line, shape)
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

            // Footer.
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            ) {
                Icon(
                    Icons.Filled.Lock,
                    contentDescription = null,
                    tint = TaliseColors.fgDim,
                    modifier = Modifier.size(11.dp),
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
        }
    }
}
