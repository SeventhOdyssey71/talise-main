package io.talise.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** Generic list row — iOS `PremiumListRow`: badge + title + subtitle + optional chevron. */
@Composable
fun PremiumListRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    tint: Color = TaliseColors.accent,
    trailing: @Composable (() -> Unit)? = null,
    showChevron: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(40.dp).background(tint.copy(alpha = 0.16f), CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp)) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fg, letterSpacing = (-0.48).sp)
            if (subtitle != null) Text(subtitle, style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
        }
        trailing?.invoke()
        if (showChevron) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(18.dp))
        }
    }
}

/** Vertical option row for Deposit/Withdraw — iOS `OptionCardRow`. */
@Composable
fun OptionCardRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    badge: String? = null,
    tint: Color = TaliseColors.accent,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .taliseGlass(radius = 18.dp)
            .clickable { onClick() }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(42.dp).background(tint.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.fg)
                if (badge != null) {
                    Text(
                        badge,
                        style = TaliseType.mono(9.sp),
                        color = tint,
                        modifier = Modifier.background(tint.copy(alpha = 0.15f), CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Text(subtitle, style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(13.dp))
    }
}

/** 132dp primary tile in the Move-money 2×2 grid — iOS `ActionTile`. */
@Composable
fun ActionTile(
    icon: ImageVector,
    title: String,
    caption: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    locked: Boolean = false,
) {
    Column(
        modifier = modifier
            .height(132.dp)
            .taliseGlass(radius = 24.dp)
            .clickable(enabled = !locked) { onClick() }
            .alpha(if (locked) 0.5f else 1f)
            .padding(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            IconChip(icon)
            if (locked) {
                Text(
                    "SOON",
                    style = TaliseType.mono(8.sp),
                    letterSpacing = 1.sp,
                    color = TaliseColors.fgDim,
                    modifier = Modifier.background(TaliseColors.surface2, CircleShape).padding(horizontal = 7.dp, vertical = 4.dp),
                )
            }
        }
        Spacer(Modifier.weight(1f))
        Text(title, style = TaliseType.heading(16.sp, FontWeight.SemiBold), color = if (locked) TaliseColors.fgMuted else TaliseColors.fg, letterSpacing = (-0.3).sp)
        Text(caption, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgDim, maxLines = 1, modifier = Modifier.padding(top = 3.dp))
    }
}
