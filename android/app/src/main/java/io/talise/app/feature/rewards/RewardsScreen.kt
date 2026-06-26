package io.talise.app.feature.rewards

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.StatTile
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** Rewards tab — iOS `RewardsView`: points hero + referral/sent stat tiles (live data in phase 2). */
@Composable
fun RewardsScreen() {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(horizontal = 22.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Rewards", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
        Column(
            Modifier.fillMaxWidth().taliseGlass(radius = 25.dp, tint = TaliseColors.greenDeep).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("POINTS", style = TaliseType.mono(10.sp), letterSpacing = 2.sp, color = TaliseColors.fgMuted)
            Text("0", style = TaliseType.display(40.sp, FontWeight.SemiBold), color = TaliseColors.fg)
            Text("Bronze tier", style = TaliseType.body(13.sp), color = TaliseColors.accent)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile("Referrals", "0", Modifier.weight(1f))
            StatTile("Sent with Talise", "0", Modifier.weight(1f))
        }
    }
}
