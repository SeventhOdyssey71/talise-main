package io.talise.app.feature.earn

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.model.YieldComparison
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.PremiumListRow
import io.talise.app.ui.components.TaliseIcons
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Invest tab — iOS `EarnView`. One consolidated "Earn" row (the SAM router picks the
 * best venue) with live APY + the user's supplied/earned position. Tap → manage sheet (phase 2).
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

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(horizontal = 22.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Earn", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
        Eyebrow("Where your money earns")
        Column(Modifier.fillMaxSize().taliseGlass(radius = 20.dp)) {
            PremiumListRow(
                icon = TaliseIcons.cash,
                title = "Earn",
                subtitle = if (supplied > 0) "Supplied $%,.2f · Earned +$%,.2f".format(supplied, earned) else "Tap to add money",
                trailing = {
                    Text(
                        apy?.let { "%.1f%%".format(it * if (it < 1) 100 else 1) } ?: "—",
                        style = TaliseType.mono(14.sp),
                        color = if (apy != null) TaliseColors.accent else TaliseColors.fgDim,
                    )
                },
                onClick = { /* phase 2: EarnManageSheet */ },
            )
        }
    }
}
