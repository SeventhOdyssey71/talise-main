package io.talise.app.feature.ramps

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.core.session.AppSession
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Ramps container, the Android home of the iOS Ramps module
 * (`CorridorPickerView` / `BridgeOnrampView` / `BridgeCashOutView`).
 *
 * On iOS the two directions are entered from the Deposit sheet
 * (`AddMoneyCorridorFlow`) and the Withdraw sheet (`UnifiedCashOutFlow`); on
 * Android both live behind this single route, so a small hub fronts them:
 *   hub -> corridor picker (exact iOS port) -> Bridge on-ramp / cash-out flow.
 *
 * Gating mirrors iOS exactly:
 *   - Cash out is server-gated (FEATURE_CASHOUT): iOS shows the entry only when
 *     `currentUser.cashoutEnabled == true`; here the "Cash out" card renders
 *     only when `features.cashout` is set.
 *   - Bridge corridors stay "coming soon" while `RampFlags.bridgeLive` is false.
 *   - Nigeria's local Linq rail routes to the Withdraw flow's bank view on iOS;
 *     that view isn't part of this module, so a clean not-available card shows.
 */
@Composable
fun RampsScreen(onClose: () -> Unit) {
    // hub -> picker(direction) -> detail(corridor, direction)
    var direction by remember { mutableStateOf<RampDirection?>(null) }
    var corridor by remember { mutableStateOf<RampCorridor?>(null) }

    val userCountry = AppSession.currentUser?.country
    val cashoutEnabled = AppSession.currentUser?.features?.cashout == true

    BackHandler(enabled = direction != null) {
        if (corridor != null) corridor = null else direction = null
    }

    when {
        corridor != null && direction != null -> Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
            HubHeader(title = "", onBack = { corridor = null })
            when {
                direction == RampDirection.Onramp -> BridgeOnrampView(corridor = corridor!!)
                corridor!!.availability == RampCorridor.Availability.Local ->
                    // Nigeria -> Linq (NGN). The Linq bank view lives in the
                    // Withdraw flow on iOS, not the Ramps module; cash-out is
                    // FEATURE_CASHOUT-gated off server-side today.
                    Column(Modifier.padding(horizontal = 20.dp).padding(top = 8.dp)) {
                        RampMessageCard(
                            title = "Not available just yet",
                            body = "Bank cash-out for ${corridor!!.name} is being switched back on. You can still send, receive, and hold USDsui in the meantime.",
                        )
                    }
                else -> BridgeCashOutView(corridor = corridor!!)
            }
        }

        direction != null -> Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
            HubHeader(title = "", onBack = { direction = null })
            CorridorPickerView(
                direction = direction!!,
                userCountry = userCountry,
                onSelect = { corridor = it },
            )
        }

        else -> RampsHub(
            onClose = onClose,
            cashoutEnabled = cashoutEnabled,
            onAdd = { direction = RampDirection.Onramp },
            onCashOut = { direction = RampDirection.Offramp },
        )
    }
}

@Composable
private fun RampsHub(
    onClose: () -> Unit,
    cashoutEnabled: Boolean,
    onAdd: () -> Unit,
    onCashOut: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        HubHeader("Money in and out", onClose = onClose)
        Column(
            Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Eyebrow("Move between banks and Talise")
            HubCard(R.drawable.hi_card, "Add money", "Fund your wallet from a bank in your country.", onAdd)
            // Cash-out to bank is server-gated (FEATURE_CASHOUT), iOS hides the
            // entry entirely unless the user's cashout feature flag is on.
            if (cashoutEnabled) {
                HubCard(R.drawable.hi_bank, "Cash out", "Withdraw USDsui to your linked bank account.", onCashOut)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Icon(painterResource(R.drawable.hi_globe), null, tint = TaliseColors.fgDim, modifier = Modifier.size(14.dp))
                Text(
                    "Rails settle in USDsui, pegged 1:1 to USD on Sui.",
                    style = TaliseType.mono(10.sp),
                    color = TaliseColors.fgDim,
                )
            }
        }
    }
}

@Composable
private fun HubCard(icon: Int, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(TaliseColors.surface, RoundedCornerShape(24.dp))
            .clickable { onClick() }.padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(TaliseColors.greenMint.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(painterResource(icon), null, tint = TaliseColors.greenMint, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = TaliseType.heading(16.sp, FontWeight.SemiBold), letterSpacing = (-0.3).sp, color = TaliseColors.fg)
            Text(subtitle, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = TaliseColors.fgDim, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun HubHeader(title: String, onClose: (() -> Unit)? = null, onBack: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            CircleBtn(Icons.AutoMirrored.Filled.ArrowBack, onBack)
        } else if (onClose != null) {
            CircleBtn(Icons.Filled.Close, onClose)
        }
        Spacer(Modifier.size(12.dp))
        if (title.isNotEmpty()) {
            Text(title, style = TaliseType.heading(24.sp, FontWeight.Medium), letterSpacing = (-0.6).sp, color = TaliseColors.fg)
        }
    }
}

@Composable
private fun CircleBtn(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier.size(34.dp).clip(CircleShape).background(TaliseColors.surface2).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = TaliseColors.fgMuted, modifier = Modifier.size(18.dp)) }
}
