package io.talise.app.ui.nav

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.shadow
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
 * iOS `MainTabView` + `BottomNavPill`. Tab content swaps in place; the bar is a flat
 * `surfaceGlass` capsule with a single hairline edge and a soft drop shadow. The active
 * tab nests its own raised `surfaceGlassStrong` capsule. Icons + labels stay white on
 * every tab (only the raised active capsule signals selection) — exactly as on iOS.
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

        BottomNavPill(
            active = tab,
            onSelect = { tab = it },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 24.dp)
                .padding(bottom = 20.dp),
        )
    }
}

@Composable
private fun BottomNavPill(
    active: TaliseTab,
    onSelect: (TaliseTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            // Soft drop shadow under the whole pill for depth against the page bg.
            .shadow(18.dp, CircleShape, clip = false, ambientColor = Color.Black, spotColor = Color.Black)
            .height(64.dp)
            // Flat solid pill — a clean raised bar on the page (no blur/glass).
            .clip(CircleShape)
            .background(TaliseColors.surfaceGlass, CircleShape)
            // One faint hairline to define the pill edge.
            .border(1.dp, TaliseColors.line, CircleShape)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        TaliseTab.entries.forEach { t ->
            TabButton(tab = t, active = t == active, onClick = { onSelect(t) }, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun TabButton(
    tab: TaliseTab,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .height(48.dp)
            .clip(CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        // Active tab: a smaller raised capsule that nests inside the outer pill —
        // solid `surfaceGlassStrong` fill + hairline, inset 4h / 2v (the Figma effect).
        if (active) {
            Box(
                Modifier
                    .matchParentSize()
                    .padding(horizontal = 4.dp, vertical = 2.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.surfaceGlassStrong, CircleShape)
                    .border(1.dp, TaliseColors.line, CircleShape),
            )
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(tab.icon, contentDescription = tab.label, tint = TaliseColors.fg, modifier = Modifier.size(18.dp))
            Text(
                tab.label,
                style = TaliseType.body(10.sp, FontWeight.Normal),
                letterSpacing = (-0.36).sp,
                color = TaliseColors.fg,
            )
        }
    }
}
