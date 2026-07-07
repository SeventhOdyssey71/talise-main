package io.talise.app.feature.rewards

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import java.util.Locale

/*
 * Rewards-local design helpers — 1:1 ports of the iOS pieces the Rewards
 * feature leans on (`SectionHeader`, `RowDivider`, `QuietProgressBar`,
 * `.earnHeroGlass` / `.earnFieldGlass`, `PremiumListRow` with badge kinds,
 * `LiquidGlassPill` with an icon slot, scrapbook entry animations). Kept in
 * the feature package so no shared file changes.
 */

/** "$1,234.56" — the Android stand-in for iOS `TaliseFormat.local2` (USD display). */
internal fun local2(usd: Double): String = String.format(Locale.US, "$%,.2f", usd)

/** Grouped integer, e.g. "12,340" — iOS `Int.formatted()`. */
internal fun grouped(n: Int): String = String.format(Locale.US, "%,d", n)

/** FLAT solid hero plate — iOS `.earnHeroGlass(cornerRadius:)` (surface fill, no border). */
internal fun Modifier.earnHeroGlass(radius: Dp = 24.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .clip(shape)
        .background(TaliseColors.surface, shape)
}

/** FLAT solid input-field chrome — iOS `.earnFieldGlass(cornerRadius:)` (surface2 fill). */
internal fun Modifier.earnFieldGlass(radius: Dp = 16.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .clip(shape)
        .background(TaliseColors.surface2, shape)
}

/** The canonical section eyebrow — iOS `SectionHeader` (mono-10 / tracking-2 / fgMuted). */
@Composable
internal fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title.uppercase(),
            style = TaliseType.mono(10.sp),
            letterSpacing = 2.0.sp,
            color = TaliseColors.fgMuted,
        )
        Spacer(Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** The inset hairline between grouped rows — iOS `RowDivider` (0.75pt, 62pt inset). */
@Composable
internal fun RowDivider(inset: Dp = 62.dp) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = inset)
            .height(0.75.dp)
            .background(TaliseColors.line),
    )
}

/** Honest progress fill — iOS `QuietProgressBar` (6pt, accent over faint white, NO fake floor). */
@Composable
internal fun QuietProgressBar(progress: Double, modifier: Modifier = Modifier) {
    val clamped = progress.coerceIn(0.0, 1.0).toFloat()
    Box(
        modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.06f)),
    ) {
        if (clamped > 0f) {
            Box(
                Modifier
                    .fillMaxWidth(clamped)
                    .height(6.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.accent),
            )
        }
    }
}

/** Badge kinds for [RewardsListRow] — iOS `TaliseBadgeKind`. */
internal enum class RewardsBadgeKind { Earn, MoneyIn, MoneyOut, Neutral, Locked }

private fun discColor(kind: RewardsBadgeKind): Color = when (kind) {
    RewardsBadgeKind.Earn -> TaliseColors.accent.copy(alpha = 0.18f)
    RewardsBadgeKind.MoneyIn -> Color(0xFFCAFFB8).copy(alpha = 0.42f)
    RewardsBadgeKind.MoneyOut -> Color(0xFF4B8A37).copy(alpha = 0.18f)
    RewardsBadgeKind.Neutral -> TaliseColors.surface2
    RewardsBadgeKind.Locked -> TaliseColors.surface2
}

private fun glyphColor(kind: RewardsBadgeKind): Color = when (kind) {
    RewardsBadgeKind.Earn -> TaliseColors.accent
    RewardsBadgeKind.MoneyIn -> Color(0xFF2E5E1F)
    RewardsBadgeKind.MoneyOut -> TaliseColors.accent
    RewardsBadgeKind.Neutral -> TaliseColors.fg
    RewardsBadgeKind.Locked -> TaliseColors.fgDim
}

/**
 * The universal list row — iOS `PremiumListRow`: a 36×36 kind-styled badge,
 * title + optional mono subtitle, a trailing slot. Drop several into ONE
 * grouped card with a [RowDivider] between them.
 */
@Composable
internal fun RewardsListRow(
    icon: ImageVector,
    kind: RewardsBadgeKind = RewardsBadgeKind.Earn,
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 60.dp)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(36.dp).background(discColor(kind), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = glyphColor(kind), modifier = Modifier.size(14.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title,
                style = TaliseType.body(14.sp, FontWeight.Light),
                letterSpacing = (-0.48).sp,
                color = TaliseColors.fg,
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = TaliseType.mono(11.sp),
                    letterSpacing = (-0.32).sp,
                    color = TaliseColors.fgDim,
                )
            }
        }
        trailing?.invoke()
    }
}

/**
 * Small capsule CTA with an optional leading icon — iOS `LiquidGlassPill`
 * ("Copy", "N pts", …). Flat `surface2` capsule + hairline, optional tint wash.
 */
@Composable
internal fun GlassPill(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    tint: Color? = null,
    compact: Boolean = false,
) {
    Row(
        modifier = modifier
            .height(if (compact) 24.dp else 30.dp)
            .clip(CircleShape)
            .background(TaliseColors.surface2, CircleShape)
            .then(if (tint != null) Modifier.background(tint.copy(alpha = 0.18f), CircleShape) else Modifier)
            .border(1.dp, TaliseColors.line, CircleShape)
            .clickable { onClick() }
            .padding(horizontal = if (compact) 10.dp else 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = TaliseColors.fg, modifier = Modifier.size(if (compact) 10.dp else 11.dp))
        }
        Text(
            title,
            style = TaliseType.body(if (compact) 11.sp else 12.sp, FontWeight.Medium),
            letterSpacing = (-0.1).sp,
            color = TaliseColors.fg,
        )
    }
}

/** Redacted-style placeholder capsule — the skeleton bar used in loading states. */
@Composable
internal fun SkeletonCapsule(width: Dp, height: Dp) {
    Box(Modifier.width(width).height(height).clip(CircleShape).background(TaliseColors.line))
}

/**
 * "Paper / scrapbook placement" entry — iOS `.scrapbookEntry(delay:tilt:)`.
 * The view drops in slightly oversized, rotated, and lifted, then settles
 * with a bouncy spring.
 */
internal fun Modifier.scrapbookEntry(
    delayMillis: Long = 0,
    tilt: Float = -7f,
    lift: Float = -26f,
): Modifier = composed {
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(delayMillis)
        settled = true
    }
    val anim = spring<Float>(dampingRatio = 0.56f, stiffness = 120f)
    val scale by animateFloatAsState(if (settled) 1f else 1.16f, anim, label = "scrapScale")
    val rotation by animateFloatAsState(if (settled) 0f else tilt, anim, label = "scrapTilt")
    val offsetY by animateFloatAsState(if (settled) 0f else lift, anim, label = "scrapLift")
    val alpha by animateFloatAsState(if (settled) 1f else 0f, anim, label = "scrapAlpha")
    graphicsLayer {
        scaleX = scale
        scaleY = scale
        rotationZ = rotation
        translationY = offsetY.dp.toPx()
        this.alpha = alpha
    }
}

/** Gentle fade-up entry for text — iOS `.scrapbookFadeUp(delay:)`. */
internal fun Modifier.scrapbookFadeUp(delayMillis: Long = 0): Modifier = composed {
    var settled by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(delayMillis)
        settled = true
    }
    val anim = spring<Float>(dampingRatio = 0.8f, stiffness = 160f)
    val offsetY by animateFloatAsState(if (settled) 0f else 14f, anim, label = "fadeUpY")
    val alpha by animateFloatAsState(if (settled) 1f else 0f, anim, label = "fadeUpAlpha")
    graphicsLayer {
        translationY = offsetY.dp.toPx()
        this.alpha = alpha
    }
}
