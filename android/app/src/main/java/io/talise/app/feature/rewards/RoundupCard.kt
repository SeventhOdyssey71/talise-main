package io.talise.app.feature.rewards

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Spa
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
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

/**
 * Round-up & Save config state — mirrors iOS `RoundupCard`'s optimistic
 * `pendingToggle` / `pendingPercentage` shadows. The shadow is held (NOT
 * cleared on the POST response) until the parent's refetched summary carries
 * the new value — the reconciler drops it seamlessly so the toggle never
 * flickers back to a stale snapshot.
 */
class RoundupViewModel : ViewModel() {

    data class State(
        val pendingToggle: Boolean? = null,
        val pendingPercentage: Int? = null,
        val saving: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    /** Stamp the optimistic percentage while the slider drags. */
    fun stagePercentage(p: Int) {
        _state.value = _state.value.copy(pendingPercentage = p.coerceIn(1, 10))
    }

    /** Drop each optimistic shadow ONLY once the server summary caught up. */
    fun reconcile(serverEnabled: Boolean?, serverPercentage: Int?) {
        val s = _state.value
        var next = s
        if (s.pendingToggle != null && serverEnabled == s.pendingToggle) next = next.copy(pendingToggle = null)
        if (s.pendingPercentage != null && serverPercentage == s.pendingPercentage) next = next.copy(pendingPercentage = null)
        if (next != s) _state.value = next
    }

    /** POST the updated config; optimistic, reverting on failure (iOS `save`). */
    fun save(enabled: Boolean?, percentage: Int?, onChange: () -> Unit) {
        if (_state.value.saving) return
        _state.value = _state.value.copy(
            saving = true,
            error = null,
            pendingToggle = enabled ?: _state.value.pendingToggle,
            pendingPercentage = percentage ?: _state.value.pendingPercentage,
        )
        viewModelScope.launch {
            runCatching {
                rewardsApi.roundup(RoundupUpdateRequest(enabled = enabled, percentage = percentage))
            }.onSuccess { resp ->
                // Pin the shadow to the SERVER-CONFIRMED values; the reconciler
                // clears it once the refetched summary matches.
                _state.value = _state.value.copy(
                    saving = false,
                    pendingToggle = resp.enabled,
                    pendingPercentage = resp.percentage,
                )
                onChange()
            }.onFailure {
                // Revert the optimistic flip so the toggle doesn't lie.
                _state.value = _state.value.copy(
                    saving = false,
                    pendingToggle = null,
                    pendingPercentage = null,
                    error = "Couldn't update. Try again.",
                )
            }
        }
    }
}

/**
 * Round-up & Save card — iOS `RoundupCard`. Opt in to auto-saving a small
 * percentage of every outbound send (default 2%, configurable 1-10).
 * Renders from the parent's `summary`; `onChange` asks the parent to
 * refetch `/api/referral/summary`.
 */
@Composable
fun RoundupCard(
    summary: RewardsSummary?,
    onChange: () -> Unit,
    vm: RoundupViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()

    val enabled = state.pendingToggle ?: summary?.roundup?.enabled ?: false
    val percentage = state.pendingPercentage ?: summary?.roundup?.percentage ?: 2
    val savedUsd = summary?.roundupSavedUsd ?: 0.0

    // Reconcile the optimistic shadows against the refetched summary.
    LaunchedEffect(summary?.roundup?.enabled, summary?.roundup?.percentage) {
        vm.reconcile(summary?.roundup?.enabled, summary?.roundup?.percentage)
    }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface, RoundedCornerShape(20.dp))
            .alpha(if (enabled) 1.0f else 0.92f)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Header — eyebrow + subtitle + toggle.
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "ROUND-UP & SAVE",
                    style = TaliseType.mono(10.sp),
                    letterSpacing = 2.0.sp,
                    color = TaliseColors.fgMuted,
                )
                Text(
                    "Auto-save $percentage% of every send and earn on the saved balance",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }
            Switch(
                checked = enabled,
                onCheckedChange = { newValue ->
                    vm.save(enabled = newValue, percentage = null, onChange = onChange)
                },
                enabled = !state.saving,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = TaliseColors.accent,
                    checkedThumbColor = Color.White,
                ),
            )
        }

        if (enabled) {
            RowDivider(inset = 18.dp)

            // Slider (% picker) — POST only on release so dragging doesn't spam.
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "SAVE PERCENTAGE",
                        style = TaliseType.mono(10.sp),
                        letterSpacing = 2.0.sp,
                        color = TaliseColors.fgMuted,
                    )
                    Spacer(Modifier.weight(1f))
                    // White, not green — a setting readout, not an earnings figure.
                    Text(
                        "$percentage%",
                        style = TaliseType.heading(22.sp, FontWeight.Medium),
                        letterSpacing = (-0.8).sp,
                        color = TaliseColors.fg,
                    )
                }
                Slider(
                    value = percentage.toFloat(),
                    onValueChange = { vm.stagePercentage(it.toInt()) },
                    onValueChangeFinished = {
                        state.pendingPercentage?.let { p ->
                            vm.save(enabled = null, percentage = p, onChange = onChange)
                        }
                    },
                    valueRange = 1f..10f,
                    steps = 8,
                    enabled = !state.saving,
                    colors = SliderDefaults.colors(
                        thumbColor = TaliseColors.accent,
                        activeTrackColor = TaliseColors.accent,
                        inactiveTrackColor = TaliseColors.surface2,
                    ),
                )
            }

            RowDivider(inset = 18.dp)

            // Saved-via-roundup line — the ONE green hero on this card.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "SAVED VIA ROUND-UP",
                        style = TaliseType.mono(10.sp),
                        letterSpacing = 2.0.sp,
                        color = TaliseColors.fgMuted,
                    )
                    Text(
                        local2(savedUsd),
                        style = TaliseType.heading(20.sp, FontWeight.Medium),
                        letterSpacing = (-0.8).sp,
                        color = TaliseColors.accent,
                        maxLines = 1,
                    )
                }
                Spacer(Modifier.weight(1f))
                Icon(
                    Icons.Filled.Spa,
                    contentDescription = null,
                    tint = TaliseColors.fgMuted,
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        // Footer — only show the explainer in the OFF (opt-in) state.
        if (!enabled) {
            Text(
                "Funds stay in your wallet and earn 5 pts per $1 saved.",
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.fgDim,
            )
        }
        state.error?.let { error ->
            Text(
                error,
                style = TaliseType.mono(10.sp),
                color = TaliseColors.danger,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}
