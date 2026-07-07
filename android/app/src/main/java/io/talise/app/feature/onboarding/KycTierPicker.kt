package io.talise.app.feature.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Three-tier KYC picker — iOS `KycTierPicker` (legacy: not in the active flow, kept and
 * routed defensively). Free is selected by default and finishes immediately on confirm.
 * Verified and Pro both open a "coming soon" alert; the Sumsub wiring is Plan 11.
 *
 * Local-only persistence for now: `talise.kyc_tier` is stamped `free` by the coordinator
 * once the flow completes.
 */
@Composable
fun KycTierPicker(onFreeChosen: () -> Unit) {
    var selected by remember { mutableStateOf(Tier.Free) }
    var pendingTier by remember { mutableStateOf<Tier?>(null) }
    var showingComingSoon by remember { mutableStateOf(false) }

    val continueTitle = when (selected) {
        Tier.Free -> "Continue with Free"
        Tier.Verified, Tier.Pro -> "Continue"
    }

    fun handleContinue() {
        when (selected) {
            Tier.Free -> onFreeChosen()
            Tier.Verified, Tier.Pro -> {
                pendingTier = selected
                showingComingSoon = true
            }
        }
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Eyebrow(text = "Verification")
                Text(
                    "Choose your limits",
                    style = TaliseType.heading(28.sp, FontWeight.Medium),
                    letterSpacing = (-0.8).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "Start free in seconds. Upgrade any time to send more.",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TierCard(
                    title = "Free",
                    limit = "$100/day",
                    requirements = "Phone only · No upload required",
                    isSelected = selected == Tier.Free,
                    onSelect = { selected = Tier.Free },
                )
                TierCard(
                    title = "Verified",
                    limit = "$5,000/day",
                    requirements = "Government ID + selfie · 5-min review",
                    isSelected = selected == Tier.Verified,
                    onSelect = { selected = Tier.Verified },
                )
                TierCard(
                    title = "Pro",
                    limit = "$50,000/day",
                    requirements = "Verified + proof of address · 24-hr review",
                    isSelected = selected == Tier.Pro,
                    onSelect = { selected = Tier.Pro },
                )
            }

            LiquidGlassButton(
                title = continueTitle,
                onClick = { handleContinue() },
                modifier = Modifier.padding(top = 12.dp),
            )
            Spacer(Modifier.height(32.dp))
        }
    }

    if (showingComingSoon) {
        val tierName = pendingTier?.label ?: "upgrade"
        AlertDialog(
            onDismissRequest = {
                pendingTier = null
                showingComingSoon = false
            },
            confirmButton = {
                TextButton(onClick = {
                    pendingTier = null
                    showingComingSoon = false
                }) { Text("OK") }
            },
            title = { Text("Verification coming soon") },
            text = {
                Text(
                    "We'll notify you when the $tierName flow is live. For now, you'll be set up on Free. You can upgrade later from Profile."
                )
            },
            containerColor = TaliseColors.surface2,
            titleContentColor = TaliseColors.fg,
            textContentColor = TaliseColors.fgMuted,
        )
    }
}

private enum class Tier(val label: String) {
    Free("Free"),
    Verified("Verified"),
    Pro("Pro"),
}

@Composable
private fun TierCard(
    title: String,
    limit: String,
    requirements: String,
    isSelected: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .taliseGlass(radius = 20.dp)
            .border(
                1.dp,
                if (isSelected) TaliseColors.fg.copy(alpha = 0.35f) else Color.Transparent,
                RoundedCornerShape(20.dp),
            )
            .clickable(onClick = onSelect)
            .padding(18.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    style = TaliseType.heading(17.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
                Text(
                    limit,
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.accent,
                )
            }
            Text(
                requirements,
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        // Radio indicator — hollow ring, filled dot when selected.
        Box(
            Modifier
                .padding(top = 2.dp, start = 14.dp)
                .size(22.dp)
                .border(
                    1.5.dp,
                    if (isSelected) TaliseColors.fg else TaliseColors.fgDim,
                    CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (isSelected) {
                Box(
                    Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(TaliseColors.fg)
                )
            }
        }
    }
}
