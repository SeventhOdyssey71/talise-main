package io.talise.app.feature.rewards

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Rewards tab — iOS `RewardsView`, the points + perks hub.
 *
 * Structure (2026-06-10 refresh):
 *   1. HERO — one solid forest card: points balance + tier + honest
 *      progress to the next tier.
 *   2. CAMPAIGN — locked $5,000 pool card ("Join · opens soon").
 *   3. STAT TILES — two-up: Referrals · Sent with Talise.
 *   4. SHARE CTA — the big referral action (code row + share button).
 *   5. INFO STRIP — one quiet line on how referrals earn.
 *   6. EARNING HISTORY — the 5 most recent point events + See all.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RewardsScreen(vm: RewardsViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val summary = state.summary

    /** "Campaign opens soon" toast when the locked Join button is tapped. */
    var campaignToast by remember { mutableStateOf(false) }
    LaunchedEffect(campaignToast) {
        if (campaignToast) {
            delay(2400)
            campaignToast = false
        }
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { vm.refresh() },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp)
                    .padding(top = 24.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                HeroCard(summary = summary, loading = state.loading)
                CampaignCard(onLockedJoin = { campaignToast = true })
                StatTiles(summary)
                // Redemption catalogue removed for now — points still accrue and
                // the balance/tier/history stay visible (matches iOS).
                ShareSection(summary?.code)
                InfoStrip()
                HistorySection(summary?.recentEvents.orEmpty())
                state.error?.let { error ->
                    Text(
                        error,
                        style = TaliseType.body(12.sp, FontWeight.Light),
                        color = TaliseColors.danger,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
                Spacer(Modifier.height(120.dp))
            }
        }

        // "Opens soon" toast — bottom, above the floating tab bar.
        AnimatedVisibility(
            visible = campaignToast,
            enter = slideInVertically(initialOffsetY = { it / 2 }) + fadeIn(),
            exit = slideOutVertically(targetOffsetY = { it / 2 }) + fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Text(
                "This campaign opens soon. You'll be the first to know.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(horizontal = 32.dp)
                    .padding(bottom = 110.dp)
                    .background(TaliseColors.surface2, CircleShape)
                    .padding(horizontal = 18.dp, vertical = 12.dp),
            )
        }
    }
}

// ── 1. Hero — points balance on a solid forest card ──────────────────────────

@Composable
private fun HeroCard(summary: RewardsSummary?, loading: Boolean) {
    val forest = Brush.linearGradient(listOf(Color(0xFF3A6E2A), Color(0xFF224417)))
    val tier = summary?.tier
    val points = summary?.pointsTotal ?: 0

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
            // Tier chip — quiet, top-right (Bronze/Silver/Gold/Plat).
            Text(
                tier?.label ?: "Bronze",
                style = TaliseType.mono(10.sp),
                letterSpacing = 0.8.sp,
                color = TaliseColors.greenMint,
                modifier = Modifier
                    .background(Color.White.copy(alpha = 0.12f), CircleShape)
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            )
        }

        if (loading && summary == null) {
            SkeletonCapsule(width = 110.dp, height = 34.dp)
        } else {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    grouped(points),
                    style = TaliseType.heading(44.sp, FontWeight.SemiBold),
                    letterSpacing = (-1.2).sp,
                    color = Color.White,
                )
                Text(
                    "pts",
                    style = TaliseType.heading(17.sp, FontWeight.Medium),
                    color = Color.White.copy(alpha = 0.65f),
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }
        }

        TierProgress(tier = tier, points = points)
    }
}

/** Honest progress to the next tier — no fake minimum fill. */
@Composable
private fun TierProgress(tier: RewardsTier?, points: Int) {
    val nextLabel = tier?.nextLabel
    val toNext = tier?.pointsToNext ?: 0
    if (nextLabel != null && toNext > 0) {
        val total = points + toNext
        val progress = if (total > 0) points.toFloat() / total.toFloat() else 0f
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BoxWithConstraints(
                Modifier
                    .fillMaxWidth()
                    .height(5.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.16f)),
            ) {
                val fill = (maxWidth * progress).coerceAtLeast(4.dp)
                Box(
                    Modifier
                        .width(fill)
                        .height(5.dp)
                        .clip(CircleShape)
                        .background(TaliseColors.greenMint),
                )
            }
            Text(
                "${grouped(toNext)} pts to $nextLabel",
                style = TaliseType.mono(10.5.sp),
                color = Color.White.copy(alpha = 0.7f),
            )
        }
    } else if (tier != null) {
        Text(
            "Top tier. Every point still counts toward perks",
            style = TaliseType.mono(10.5.sp),
            color = TaliseColors.greenMint,
        )
    }
}

// ── Campaign — locked $5,000 pool (opens later) ──────────────────────────────

/** Flip to true (and wire the Join action) when the campaign opens. */
private const val CAMPAIGN_LIVE = false

@Composable
private fun CampaignCard(onLockedJoin: () -> Unit) {
    val ink = Color(0xFF0E1A0D)
    val haptics = LocalHapticFeedback.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(TaliseColors.surface, RoundedCornerShape(24.dp))
            .border(1.dp, TaliseColors.greenMint.copy(alpha = 0.22f), RoundedCornerShape(24.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Header row — eyebrow + LOCKED pill.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "CAMPAIGN",
                style = TaliseType.mono(10.sp),
                letterSpacing = 2.0.sp,
                color = TaliseColors.greenMint,
            )
            Spacer(Modifier.weight(1f))
            if (!CAMPAIGN_LIVE) {
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
        }

        // The pool — the hero number.
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "$5,000",
                style = TaliseType.display(46.sp, FontWeight.SemiBold),
                letterSpacing = (-1.8).sp,
                color = TaliseColors.fg,
            )
            Text("reward pool", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }

        Text(
            "A community rewards campaign is coming. Join to lock your spot. The more you move and refer, the more you share when it opens.",
            style = TaliseType.body(13.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )

        // Join — locked for now.
        Row(
            Modifier
                .fillMaxWidth()
                .height(50.dp)
                .clip(CircleShape)
                .background(TaliseColors.greenMint, CircleShape)
                .alpha(if (CAMPAIGN_LIVE) 1f else 0.7f)
                .clickable {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onLockedJoin()
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            if (!CAMPAIGN_LIVE) {
                Icon(Icons.Filled.Lock, contentDescription = null, tint = ink, modifier = Modifier.size(12.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(
                if (CAMPAIGN_LIVE) "Join" else "Join · opens soon",
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = ink,
            )
        }
    }
}

// ── 2. Stat tiles ────────────────────────────────────────────────────────────

@Composable
private fun StatTiles(summary: RewardsSummary?) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StatTile(
            icon = Icons.Outlined.Group,
            value = "${summary?.referralCount ?: 0}",
            label = "Referrals",
            modifier = Modifier.weight(1f),
        )
        StatTile(
            icon = Icons.AutoMirrored.Outlined.Send,
            value = local2(summary?.lifetimeSentUsd ?: 0.0),
            label = "Sent with Talise",
            modifier = Modifier.weight(1f),
        )
    }
}

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
        ) {
            Icon(icon, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(15.dp))
        }
        Text(
            value,
            style = TaliseType.heading(22.sp, FontWeight.SemiBold),
            letterSpacing = (-0.5).sp,
            color = TaliseColors.fg,
            maxLines = 1,
        )
        Text(label, style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
    }
}

// ── 3. Share CTA (referral code + the one big action) ────────────────────────

@Composable
private fun ShareSection(code: String?) {
    if (code == null) return
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(TaliseColors.surface, RoundedCornerShape(18.dp))
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                code,
                style = TaliseType.mono(15.sp),
                letterSpacing = 1.0.sp,
                color = TaliseColors.fg,
            )
            Spacer(Modifier.weight(1f))
            GlassPill(
                title = "Copy",
                icon = Icons.Outlined.ContentCopy,
                compact = true,
                onClick = { clipboard.setText(AnnotatedString("https://www.talise.io/r/$code")) },
            )
        }

        LiquidGlassButton(
            title = "Share Talise",
            onClick = {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "Join me on Talise: https://www.talise.io/r/$code")
                }
                context.startActivity(Intent.createChooser(intent, "Share Talise"))
            },
        )
    }
}

// ── 4. Info strip ────────────────────────────────────────────────────────────

@Composable
private fun InfoStrip() {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(TaliseColors.surface.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            Icons.Filled.AutoAwesome,
            contentDescription = null,
            tint = TaliseColors.greenMint,
            modifier = Modifier.padding(top = 1.dp).size(12.dp),
        )
        Text(
            "Invite friends. You earn points when they join and start moving money.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

// ── 5. Earning history ───────────────────────────────────────────────────────

/** Collapsed: the 5 most recent point events + a "See all" row that expands
 *  the full server ledger inline (iOS `historySection`). */
@Composable
private fun HistorySection(events: List<RewardsEvent>) {
    if (events.isEmpty()) return
    var showAllHistory by remember { mutableStateOf(false) }
    val shown = if (showAllHistory) events else events.take(5)

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader("Earning history")
        Column(
            Modifier
                .fillMaxWidth()
                .earnHeroGlass(20.dp)
                .padding(vertical = 4.dp),
        ) {
            shown.forEachIndexed { i, ev ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            historyTitle(ev.kind),
                            style = TaliseType.body(14.sp),
                            color = TaliseColors.fg,
                        )
                        Text(
                            historyDate(ev.createdAt),
                            style = TaliseType.mono(10.sp),
                            color = TaliseColors.fgDim,
                        )
                    }
                    Text(
                        "+${ev.points}",
                        style = TaliseType.heading(15.sp, FontWeight.Medium),
                        color = TaliseColors.accent,
                    )
                }
                if (i < shown.size - 1) RowDivider()
            }

            // "See all" — only when there's more than the fold.
            if (!showAllHistory && events.size > 5) {
                RowDivider()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { showAllHistory = true }
                        .padding(horizontal = 18.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "See all",
                        style = TaliseType.body(13.5.sp),
                        color = TaliseColors.greenMint,
                    )
                    Spacer(Modifier.weight(1f))
                    Icon(
                        Icons.Filled.KeyboardArrowDown,
                        contentDescription = null,
                        tint = TaliseColors.fgDim,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
        }
    }
}

private fun historyTitle(kind: String): String = when (kind) {
    "send", "send_tx" -> "Sent money"
    "invest", "supply" -> "Saved to yield"
    "roundup", "roundup_sweep" -> "Round-up auto-save"
    "goal", "goal_deposit" -> "Added to a goal"
    "referral", "referee", "referrer" -> "Friend joined"
    else -> {
        // Unknown kind — humanize the slug instead of a generic label
        // so new server event kinds still read sensibly.
        val words = kind.replace("_", " ")
        words.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
    }
}

private val historyDateFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US)

/** Server timestamps carry fractional seconds ("…T19:31:59.142Z") —
 *  `Instant.parse` handles both fractional and plain. */
private fun historyDate(iso: String): String = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).format(historyDateFormatter)
}.getOrDefault("")
