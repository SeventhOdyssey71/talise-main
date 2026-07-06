package io.talise.app.feature.earn

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Spa
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.model.YieldComparison
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.PremiumListRow
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Invest tab — iOS `EarnView`. One consolidated "Earn" row (the SAM router picks the
 * best venue) under a "Where your money earns" section header, on a flat hero plate,
 * carrying the live BEST rate. Tap → manage sheet (phase 2).
 */
@Composable
fun EarnScreen() {
    val comparison by produceState<YieldComparison?>(initialValue = null) {
        value = runCatching { ApiClient.api.yieldComparison() }.getOrNull()
    }
    val best = comparison?.best ?: comparison?.venues?.maxByOrNull { it.apy }
    val apy = best?.apy
    val supplied = best?.supplied ?: 0.0
    val earned = best?.earned ?: 0.0
    // Live rate reads as "—" below 1bp (matches iOS: near-zero utilization
    // isn't "0.00%", it's "no demand right now").
    val live = apy != null && apy >= 0.0001
    val apyText = if (live) "%.2f%%".format(apy!! * 100) else "—"
    val subtitle = when {
        supplied <= 0 -> "Tap to add money"
        earned > 0 -> "Supplied $%,.2f · Earned +$%,.2f".format(supplied, earned)
        else -> "Supplied $%,.2f".format(supplied)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp)
            .padding(top = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Eyebrow("Where your money earns")
        // Flat hero plate (iOS `.earnHeroGlass(cornerRadius: 20)`) holding one Earn row.
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) {
            PremiumListRow(
                icon = Icons.Outlined.Spa,
                title = "Earn",
                subtitle = subtitle,
                trailing = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "BEST",
                            style = TaliseType.mono(9.sp),
                            letterSpacing = 1.sp,
                            color = TaliseColors.accent,
                            modifier = Modifier
                                .background(TaliseColors.accent.copy(alpha = 0.15f), CircleShape)
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                        Text(
                            apyText,
                            style = TaliseType.heading(22.sp, FontWeight.Medium),
                            letterSpacing = (-0.8).sp,
                            color = if (live) TaliseColors.accent else TaliseColors.fgDim,
                        )
                    }
                },
                onClick = { /* phase 2: EarnManageSheet */ },
            )
        }
        // Clearance so the last content isn't hidden behind the floating tab bar.
        Spacer(Modifier.height(120.dp))
    }
}
