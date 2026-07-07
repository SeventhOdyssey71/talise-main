package io.talise.app.feature.earn

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Spa
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.PremiumListRow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Invest tab — a pixel port of iOS `EarnView`. One consolidated "Earn" row
 * (the SAM router picks the best venue) under a "Where your money earns"
 * section header, on a flat hero plate, carrying the live BEST rate. Tapping
 * the row opens the combined Add money / Withdraw sheet (`EarnManageSheet`);
 * a successful deposit lands on the full-screen piggy celebration
 * (`SavingsSuccessView`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EarnScreen(vm: EarnViewModel = viewModel()) {
    val comparison by vm.comparison.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val savedAmountText by vm.savedAmountText.collectAsStateWithLifecycle()

    /** The venue the user tapped — drives the combined Add money / Withdraw sheet. */
    var manageTarget by remember { mutableStateOf<EarnVenueDTO?>(null) }

    // A successful deposit presents the piggy cover; close the sheet under it.
    LaunchedEffect(savedAmountText) {
        if (savedAmountText != null) manageTarget = null
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { vm.refresh() },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp)
                    .padding(top = 24.dp),
                verticalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                // ── Venue section ──
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Eyebrow("Where your money earns", modifier = Modifier.padding(horizontal = 4.dp))
                    VenueListCard(
                        loading = loading,
                        comparison = comparison,
                        onTapEarn = { manageTarget = it },
                    )
                }

                error?.let {
                    Text(it, style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.danger)
                }

                // Clearance so the last content isn't hidden behind the tab bar.
                Spacer(Modifier.height(120.dp))
            }
        }

        // Full-screen piggy celebration for a completed save. Dismissing
        // returns to the Earn screen with the sheet closed.
        savedAmountText?.let { amount ->
            SavingsSuccessView(amountText = amount, onDismiss = { vm.consumeSavedAmount() })
        }
    }

    // Tapping the Earn row opens the combined Add money / Withdraw sheet.
    manageTarget?.let { venue ->
        LaunchedEffect(venue) { vm.resetSheet() }
        ModalBottomSheet(
            onDismissRequest = {
                manageTarget = null
                vm.resetSheet()
            },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = TaliseColors.bg,
        ) {
            EarnManageSheet(
                venue = venue,
                bestApy = comparison?.best?.apy ?: 0.0,
                vm = vm,
                onDismiss = {
                    manageTarget = null
                    vm.resetSheet()
                },
            )
        }
    }
}

// ── Venue list card ─────────────────────────────────────────────────────────

/**
 * Filter the venue list before render — DeepBook USDsui margin sits at ~0%
 * APY, so it's hidden unless the user already has a position there (existing
 * depositors can still tap through to withdraw).
 */
private fun visibleVenues(venues: List<EarnVenueDTO>): List<EarnVenueDTO> =
    venues.filter { v ->
        if (v.venue == "deepbook") (v.supplied ?: 0.0) > 0 else true
    }

/**
 * The single "Earn" position — routes taps to the best venue (highest live
 * APY); the SAM router consolidates + auto-rebalances funds there.
 */
private fun earnSummary(cmp: EarnComparisonDTO): EarnVenueDTO? {
    val visible = visibleVenues(cmp.venues)
    if (visible.isEmpty()) return null
    return cmp.best?.let { b -> visible.firstOrNull { it.venue == b.venue } }
        ?: visible.maxByOrNull { it.apy }
        ?: visible.firstOrNull()
}

@Composable
private fun VenueListCard(
    loading: Boolean,
    comparison: EarnComparisonDTO?,
    onTapEarn: (EarnVenueDTO) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .earnHeroGlass(radius = 20.dp)
            .padding(horizontal = 18.dp, vertical = 4.dp),
    ) {
        val earn = comparison?.let { earnSummary(it) }
        when {
            loading -> {
                VenueSkeletonRow()
                EarnRowDivider()
                VenueSkeletonRow()
            }
            earn != null -> {
                // ONE clean "Earn" row. The SAM router consolidates funds into
                // the best venue + auto-rebalances, so the user sees a single
                // position at the best live rate — never a per-venue list.
                EarnRow(best = earn, comparison = comparison, onTap = { onTapEarn(earn) })
            }
            else -> EmptyState()
        }
    }
}

/**
 * One unified "Earn" row: best live rate + the user's TOTAL supplied/earned
 * aggregated across venues (no per-venue breakdown on the main screen).
 */
@Composable
private fun EarnRow(
    best: EarnVenueDTO,
    comparison: EarnComparisonDTO?,
    onTap: () -> Unit,
) {
    val visible = comparison?.let { visibleVenues(it.venues) } ?: listOf(best)
    val totalSupplied = visible.sumOf { it.supplied ?: 0.0 }
    val totalEarned = visible.sumOf { it.earned ?: 0.0 }
    val hasPosition = totalSupplied > 0
    // APY < 1bp reads as "-" instead of "0.00%" — near-zero utilization is
    // "no demand for loans right now", not "guaranteed to pay 0".
    val live = best.apy >= 0.0001
    val apyText = if (live) "%.2f%%".format(best.apy * 100) else "-"
    val subtitle = when {
        !hasPosition -> "Tap to add money"
        totalEarned > 0 -> "Supplied ${earnUsd2(totalSupplied)} · Earned +${earnUsd2(totalEarned)}"
        else -> "Supplied ${earnUsd2(totalSupplied)}"
    }

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
                    maxLines = 1,
                )
            }
        },
        onClick = onTap,
    )
}

@Composable
private fun VenueSkeletonRow() {
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 60.dp)
            .padding(vertical = 4.dp)
            .alpha(0.6f),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp).background(TaliseColors.surface2, CircleShape))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(
                Modifier
                    .width(80.dp)
                    .height(10.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.line),
            )
            Box(
                Modifier
                    .width(50.dp)
                    .height(8.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.line),
            )
        }
        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun EmptyState() {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            "No live venues right now.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
            textAlign = TextAlign.Center,
        )
        Text(
            "Pull to refresh.",
            style = TaliseType.mono(10.sp),
            color = TaliseColors.fgDim,
            textAlign = TextAlign.Center,
        )
    }
}
