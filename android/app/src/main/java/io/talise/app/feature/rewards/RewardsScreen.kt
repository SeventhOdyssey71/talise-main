package io.talise.app.feature.rewards

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Rewards tab, iOS `RewardsView`. Points hero on a solid forest card, a locked
 * campaign pool, and two stat tiles. Live data (points, tier, referrals) lands in
 * phase 2; for now the surface renders its zero-state exactly like iOS.
 */
@Composable
fun RewardsScreen() {
    val forest = Brush.linearGradient(listOf(Color(0xFF3A6E2A), Color(0xFF224417)))

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp)
            .padding(top = 24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        HeroCard(forest)
        CampaignCard()
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile(Icons.Filled.Group, "0", "Referrals", Modifier.weight(1f))
            StatTile(Icons.AutoMirrored.Filled.Send, "$0.00", "Sent with Talise", Modifier.weight(1f))
        }
        InfoStrip()
        Spacer(Modifier.height(120.dp))
    }
}

/** Points balance on a solid forest card, tier chip top-right, big count, honest caption. */
@Composable
private fun HeroCard(forest: Brush) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(26.dp))
            .background(forest, RoundedCornerShape(26.dp))
            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(26.dp))
            .padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "REWARD POINTS",
                style = TaliseType.mono(11.sp),
                letterSpacing = 1.6.sp,
                color = Color.White.copy(alpha = 0.75f),
            )
            Spacer(Modifier.weight(1f))
            Text(
                "Bronze",
                style = TaliseType.mono(10.sp),
                letterSpacing = 0.8.sp,
                color = TaliseColors.greenMint,
                modifier = Modifier
                    .background(Color.White.copy(alpha = 0.12f), CircleShape)
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("0", style = TaliseType.heading(44.sp, FontWeight.SemiBold), letterSpacing = (-1.2).sp, color = Color.White)
            Text(
                "pts",
                style = TaliseType.heading(17.sp, FontWeight.Medium),
                color = Color.White.copy(alpha = 0.65f),
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        Text(
            "Move money and refer friends to start earning points.",
            style = TaliseType.mono(10.5.sp),
            color = Color.White.copy(alpha = 0.7f),
        )
    }
}

/** Locked $5,000 reward pool, opens later. Join surfaces a quiet "opens soon" affordance. */
@Composable
private fun CampaignCard() {
    val ink = Color(0xFF0E1A0D)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(TaliseColors.surface, RoundedCornerShape(24.dp))
            .border(1.dp, TaliseColors.greenMint.copy(alpha = 0.22f), RoundedCornerShape(24.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("CAMPAIGN", style = TaliseType.mono(10.sp), letterSpacing = 2.0.sp, color = TaliseColors.greenMint)
            Spacer(Modifier.weight(1f))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                modifier = Modifier
                    .background(TaliseColors.surface2, CircleShape)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            ) {
                Icon(Icons.Filled.Lock, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(9.dp))
                Text("LOCKED", style = TaliseType.mono(9.sp), letterSpacing = 1.sp, color = TaliseColors.fgDim)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("$5,000", style = TaliseType.display(46.sp, FontWeight.SemiBold), letterSpacing = (-1.8).sp, color = TaliseColors.fg)
            Text("reward pool", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Text(
            "A community rewards campaign is coming. Join to lock your spot. The more you move and refer, the more you share when it opens.",
            style = TaliseType.body(13.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
                .clip(CircleShape)
                .background(TaliseColors.greenMint, CircleShape)
                .clickable { /* opens soon */ },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Filled.Lock, contentDescription = null, tint = ink, modifier = Modifier.size(12.dp))
            Spacer(Modifier.size(8.dp))
            Text("Join · opens soon", style = TaliseType.heading(15.sp, FontWeight.Medium), color = ink)
        }
    }
}

/** Two-up stat tile, icon chip + value + label, on a flat surface card. iOS `statTile`. */
@Composable
private fun StatTile(icon: ImageVector, value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(22.dp))
            .background(TaliseColors.surface, RoundedCornerShape(22.dp))
            .border(1.dp, Color.White.copy(alpha = 0.05f), RoundedCornerShape(22.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(34.dp).background(TaliseColors.greenMint.copy(alpha = 0.12f), RoundedCornerShape(11.dp)),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(15.dp)) }
        Text(value, style = TaliseType.heading(22.sp, FontWeight.SemiBold), letterSpacing = (-0.5).sp, color = TaliseColors.fg)
        Text(label, style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
    }
}

/** One quiet line on how referrals earn, iOS `infoStrip`. */
@Composable
private fun InfoStrip() {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(TaliseColors.surface.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
            .padding(horizontal = 16.dp, vertical = 13.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(12.dp).padding(top = 1.dp))
        Text(
            "Invite friends. You earn points when they join and start moving money.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}
