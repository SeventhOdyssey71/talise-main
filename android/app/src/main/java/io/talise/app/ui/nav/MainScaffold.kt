package io.talise.app.ui.nav

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import io.talise.app.feature.earn.EarnScreen
import io.talise.app.feature.home.HomeScreen
import io.talise.app.feature.profile.ProfileScreen
import io.talise.app.feature.rewards.RewardsScreen
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * The authenticated shell — the four tabs over a floating pill bottom bar, mirroring
 * iOS `MainTabView`. Tab content swaps in place; the bar is a rounded surface pill
 * with the active tab highlighted.
 */
@Composable
fun MainScaffold(nav: NavController) {
    var tab by remember { mutableStateOf(TaliseTab.Home) }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        when (tab) {
            TaliseTab.Home -> HomeScreen(nav)
            TaliseTab.Invest -> EarnScreen()
            TaliseTab.Rewards -> RewardsScreen()
            TaliseTab.Profile -> ProfileScreen(nav)
        }

        FloatingTabBar(
            selected = tab,
            onSelect = { tab = it },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 24.dp, vertical = 18.dp),
        )
    }
}

@Composable
private fun FloatingTabBar(
    selected: TaliseTab,
    onSelect: (TaliseTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .height(64.dp)
            .background(TaliseColors.surfaceGlass, RoundedCornerShape(40.dp))
            .border(1.dp, TaliseColors.line, RoundedCornerShape(40.dp))
            .padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TaliseTab.entries.forEach { t ->
            TabItem(tab = t, active = t == selected, onClick = { onSelect(t) }, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun TabItem(
    tab: TaliseTab,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val fg: Color = if (active) TaliseColors.accent else TaliseColors.fgDim
    Column(
        modifier = modifier
            .padding(horizontal = 4.dp)
            .background(if (active) TaliseColors.surfaceGlassStrong else Color.Transparent, RoundedCornerShape(34.dp))
            .clickable { onClick() }
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(tab.icon, contentDescription = tab.label, tint = fg, modifier = Modifier.size(20.dp))
        Text(tab.label, style = TaliseType.mono(9.sp, FontWeight.Medium), color = fg, modifier = Modifier.padding(top = 2.dp))
    }
}
