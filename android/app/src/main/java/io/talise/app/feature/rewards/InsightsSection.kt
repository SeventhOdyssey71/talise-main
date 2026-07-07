package io.talise.app.feature.rewards

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SwapHoriz

/** Month insights data — mirrors iOS `InsightsSection`'s `@State` trio. */
class InsightsViewModel : ViewModel() {

    data class State(
        val insights: MonthInsights? = null,
        val loading: Boolean = true,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            runCatching { rewardsApi.insights() }
                .onSuccess { _state.value = State(insights = it, loading = false, error = null) }
                .onFailure { t -> _state.value = _state.value.copy(loading = false, error = t.message) }
        }
    }
}

/**
 * Phase 3 — Month Insights, iOS `InsightsSection`. Text-only month-to-date
 * summary: total spent / received / saved + a top-3 counterparties strip.
 * Owns its own data lifecycle, like iOS.
 */
@Composable
fun InsightsSection(vm: InsightsViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val insights = state.insights
    val loading = state.loading

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader("This month", trailing = {
            val count = insights?.sampleSize ?: 0
            if (count > 0) {
                Text("$count", style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
            }
        })

        // Metric tiles — Spent (danger) · Received · Saved (accent).
        Row(
            Modifier
                .fillMaxWidth()
                .alpha(if (loading && insights == null) 0.6f else 1f),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            InsightStatTile(
                eyebrow = "Spent",
                value = local2(insights?.spentUsd ?: 0.0),
                valueColor = TaliseColors.danger,
                loading = loading && insights == null,
                modifier = Modifier.weight(1f),
            )
            InsightStatTile(
                eyebrow = "Received",
                value = local2(insights?.receivedUsd ?: 0.0),
                loading = loading && insights == null,
                modifier = Modifier.weight(1f),
            )
            InsightStatTile(
                eyebrow = "Saved",
                value = local2(insights?.savedUsd ?: 0.0),
                valueColor = TaliseColors.accent,
                loading = loading && insights == null,
                modifier = Modifier.weight(1f),
            )
        }

        // Counterparties strip.
        val list = insights?.topCounterparties.orEmpty()
        when {
            list.isNotEmpty() -> {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .earnHeroGlass(20.dp)
                        .padding(horizontal = 18.dp),
                ) {
                    list.forEachIndexed { idx, cp ->
                        RewardsListRow(
                            icon = Icons.Filled.SwapHoriz,
                            kind = RewardsBadgeKind.Neutral,
                            title = "You moved ${local2(cp.totalUsd)}",
                            subtitle = "with ${cp.displayName} · ${cp.count} tx" + if (cp.count == 1) "" else "s",
                        )
                        if (idx < list.size - 1) RowDivider()
                    }
                }
            }
            loading -> {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .earnHeroGlass(20.dp)
                        .alpha(0.6f)
                        .padding(horizontal = 18.dp),
                ) {
                    InsightsSkeletonRow()
                    RowDivider()
                    InsightsSkeletonRow()
                }
            }
            else -> {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .earnHeroGlass(20.dp)
                        .padding(horizontal = 16.dp, vertical = 22.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        "No movements yet this month.",
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fgDim,
                    )
                }
            }
        }

        if (!state.error.isNullOrEmpty()) {
            Text(
                state.error ?: "",
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.danger,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }
}

/** iOS `StatTile` with the `valueColor` override (danger for "Spent"). */
@Composable
private fun InsightStatTile(
    eyebrow: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
    loading: Boolean = false,
) {
    Column(
        modifier
            .earnHeroGlass(20.dp)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            eyebrow.uppercase(),
            style = TaliseType.mono(10.sp),
            letterSpacing = 2.0.sp,
            color = TaliseColors.fgMuted,
        )
        if (loading) {
            SkeletonCapsule(width = 56.dp, height = 14.dp)
        } else {
            Text(
                value,
                style = TaliseType.heading(22.sp, FontWeight.Medium),
                letterSpacing = (-0.8).sp,
                color = valueColor ?: TaliseColors.fg,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun InsightsSkeletonRow() {
    Row(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 60.dp)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp).background(TaliseColors.surface2, CircleShape))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SkeletonCapsule(width = 120.dp, height = 10.dp)
            SkeletonCapsule(width = 70.dp, height = 8.dp)
        }
        Spacer(Modifier.weight(1f))
    }
}
