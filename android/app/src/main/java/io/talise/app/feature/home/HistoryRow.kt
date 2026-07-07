package io.talise.app.feature.home

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.ArrowOutward
import androidx.compose.material.icons.filled.Eco
import androidx.compose.material.icons.filled.SouthWest
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import androidx.compose.ui.text.font.FontWeight

/**
 * Single history row. Reused by Home (top 4) and HistoryView (full list),
 * a 1:1 port of iOS `HistoryRow`.
 *
 * FLAT row — the enclosing card supplies the surface; the row itself is
 * transparent at rest with a flat solid circular icon chip. On press it picks
 * up a faint directional wash (red for money-out, green for money-in).
 */
@Composable
internal fun HistoryRow(
    entry: ActivityEntryDTO,
    amountsHidden: Boolean,
    onTap: () -> Unit,
) {
    val category = categoryOf(entry)

    // Circular badge fill — a flat colored disc (no glass).
    val badgeBg: Color = when (category) {
        TxCategory.SENT, TxCategory.CASHOUT, TxCategory.TEAM -> HomeSentRed.copy(alpha = 0.16f)
        TxCategory.RECEIVED -> HomeReceivedGreen.copy(alpha = 0.20f)
        TxCategory.INVEST, TxCategory.AUTOSWAP -> TaliseColors.accent.copy(alpha = 0.20f)
        TxCategory.WITHDRAW -> HomeReceivedMint.copy(alpha = 0.42f)
        TxCategory.NEUTRAL -> TaliseColors.surface2
    }
    val badgeFg: Color = when (category) {
        TxCategory.SENT, TxCategory.CASHOUT, TxCategory.TEAM -> HomeSentRedSoft
        TxCategory.RECEIVED -> HomeReceivedMint
        TxCategory.INVEST, TxCategory.AUTOSWAP -> TaliseColors.accent
        TxCategory.WITHDRAW -> HomeWithdrawForest
        TxCategory.NEUTRAL -> TaliseColors.fg
    }
    val icon: ImageVector = when (category) {
        TxCategory.SENT -> Icons.Filled.ArrowOutward
        TxCategory.CASHOUT -> Icons.Filled.AccountBalance
        TxCategory.RECEIVED -> Icons.Filled.SouthWest
        TxCategory.INVEST, TxCategory.AUTOSWAP -> Icons.Filled.Eco
        TxCategory.WITHDRAW -> Icons.Outlined.Eco
        TxCategory.TEAM -> Icons.Filled.AccountBalance // unused — team renders hi_team
        TxCategory.NEUTRAL -> Icons.Outlined.Circle
    }
    // Directional press tint — red for money-out, green for money-in; neutral
    // never tints. Applied only while pressed (iOS HistoryRowButtonStyle).
    val tintColor: Color = when (category) {
        TxCategory.SENT, TxCategory.CASHOUT, TxCategory.TEAM -> HomeSentRed
        TxCategory.RECEIVED, TxCategory.WITHDRAW -> HomeReceivedGreen
        TxCategory.INVEST, TxCategory.AUTOSWAP -> TaliseColors.accent
        TxCategory.NEUTRAL -> TaliseColors.fgMuted
    }
    val tintAlpha = if (category == TxCategory.NEUTRAL) 0f else 0.18f

    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val pressWash by animateColorAsState(
        targetValue = if (pressed) tintColor.copy(alpha = tintAlpha) else Color.Transparent,
        animationSpec = tween(150),
        label = "rowPressWash",
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(pressWash)
            .clickable(interactionSource = interaction, indication = null) { onTap() }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp)) {
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(badgeBg),
                contentAlignment = Alignment.Center,
            ) {
                if (category == TxCategory.TEAM) {
                    // Team payouts use the HugeIcons team glyph.
                    Icon(
                        painterResource(R.drawable.hi_team),
                        contentDescription = null,
                        tint = badgeFg,
                        modifier = Modifier.size(18.dp),
                    )
                } else {
                    Icon(icon, contentDescription = null, tint = badgeFg, modifier = Modifier.size(14.dp))
                }
            }
            // Cash-out rows carry the destination country's flag tucked into
            // the bottom-trailing corner of the badge.
            cashoutFlagCode(entry)?.let { code ->
                val flagRes = if (code == "ng") R.drawable.flag_ng else R.drawable.flag_us
                Image(
                    painter = painterResource(flagRes),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .offset(x = 12.dp, y = 12.dp)
                        .size(20.dp)
                        .clip(CircleShape)
                        .border(2.dp, TaliseColors.bg, CircleShape),
                )
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    rowTitle(entry, category),
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    letterSpacing = (-0.48).sp,
                    color = TaliseColors.fg,
                )
                // Cash-out rows carry a small disbursement-status pill
                // (Pending / Failed) so the user can tell at a glance
                // whether the naira has landed.
                entry.offramp?.let { off ->
                    offrampStatusPill(off)?.let { (label, color) ->
                        Text(
                            label,
                            style = TaliseType.body(9.sp, FontWeight.SemiBold),
                            letterSpacing = 0.2.sp,
                            color = color,
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(color.copy(alpha = 0.16f))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }
            MicroLabel(text = rowSubtitle(entry), color = TaliseColors.fgDim)
        }
        // Amount only — the whole row is tappable.
        Text(
            if (amountsHidden) "••••" else rowAmount(entry, category),
            style = TaliseType.body(14.sp, FontWeight.Light),
            letterSpacing = (-0.56).sp,
            color = if (amountsHidden) TaliseColors.fgMuted else rowAmountColor(entry, category, TaliseColors.fg),
        )
    }
}
