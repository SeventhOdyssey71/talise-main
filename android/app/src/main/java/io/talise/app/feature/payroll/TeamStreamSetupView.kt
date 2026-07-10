package io.talise.app.feature.payroll

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.core.model.TeamDTO
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Set up a streaming payout for a team, a 1:1 port of iOS TeamStreamSetupView.
 * Fund a pot once, then equal shares stream to every member on an interval,
 * gaslessly, until the pot runs out.
 *
 * Flow: streamCreatePrepare (draft + escrow address), fund the escrow over the
 * normal gasless send rail (signAndSubmitSend), then streamRecord (activate).
 * A backend cron releases each tranche, no per-tranche signing by the user.
 */

private enum class StreamInterval(val label: String, val minutes: Int, val unit: String) {
    Minute("Every minute", 1, "minute"),
    Hourly("Hourly", 60, "hour"),
    Daily("Daily", 1440, "day"),
    Weekly("Weekly", 10080, "week"),
}

/**
 * Owns the fund-the-pot pipeline (prepare -> sign+send -> record) so it runs on
 * [viewModelScope] and survives the composable. On the previous
 * `rememberCoroutineScope` a back press mid-flight cancelled the coroutine
 * between `signAndSubmitSend` (real USDsui moved to escrow) and `streamRecord`
 * (activation), silently stranding the funds.
 */
class TeamStreamSetupViewModel : ViewModel() {

    data class State(
        val starting: Boolean = false,
        val error: String? = null,
        val started: Boolean = false,
        val startedSummary: String = "",
        /** Forces the slider knob back to start after a failed confirm. */
        val resetSliderTick: Int = 0,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    fun bounceSlider() {
        _state.value = _state.value.copy(resetSliderTick = _state.value.resetSliderTick + 1)
    }

    fun start(teamId: String, totalUsd: Double, numTranches: Int, intervalMinutes: Int, intervalUnit: String) {
        if (_state.value.starting) return
        _state.value = _state.value.copy(starting = true, error = null)
        viewModelScope.launch {
            try {
                val prep = PayrollApi.service.streamCreatePrepare(
                    StreamCreateBody(
                        teamId = teamId,
                        totalUsd = totalUsd,
                        numTranches = numTranches,
                        intervalMinutes = intervalMinutes,
                    ),
                )
                val digest = PayrollApi.signAndSubmitSend(to = prep.escrowAddress, amountUsd = prep.totalUsd)
                PayrollApi.service.streamRecord(StreamRecordBody(streamId = prep.streamId, digest = digest))
                val people = if (prep.memberCount == 1) "person" else "people"
                _state.value = _state.value.copy(
                    starting = false,
                    started = true,
                    startedSummary = "${prep.memberCount} $people will each receive ${payrollUsd2(prep.perMemberUsd)} per $intervalUnit, ${prep.numTranches} times.",
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    starting = false,
                    error = PayrollApi.friendlyPayoutError(e, "Couldn't start the stream. Please try again."),
                    resetSliderTick = _state.value.resetSliderTick + 1,
                )
            }
        }
    }
}

@Composable
fun TeamStreamSetupView(
    team: TeamDTO,
    onDismiss: () -> Unit,
    vm: TeamStreamSetupViewModel = viewModel(key = "team-stream-${team.id}") { TeamStreamSetupViewModel() },
) {
    var amount by remember { mutableStateOf("") }
    var numTranches by remember { mutableStateOf(4) }
    var interval by remember { mutableStateOf(StreamInterval.Daily) }
    val state by vm.state.collectAsStateWithLifecycle()
    val starting = state.starting

    // Tick -> one-frame reset pulse for the slider (same wiring as PayTeamView).
    var resetSlider by remember { mutableStateOf(false) }
    LaunchedEffect(state.resetSliderTick) {
        if (state.resetSliderTick > 0) {
            resetSlider = true
            delay(50)
            resetSlider = false
        }
    }

    val memberCount = maxOf(team.members.size, 1)
    val totalUsd = amount.trim().toDoubleOrNull() ?: 0.0
    val perMemberPerPayout = if (numTranches > 0) totalUsd / numTranches / memberCount else 0.0
    val canStart = totalUsd > 0 && numTranches >= 1 && perMemberPerPayout >= 0.01 && !starting

    fun start() {
        if (!canStart) { vm.bounceSlider(); return }
        vm.start(
            teamId = team.id,
            totalUsd = totalUsd,
            numTranches = numTranches,
            intervalMinutes = interval.minutes,
            intervalUnit = interval.unit,
        )
    }

    if (state.started) {
        StreamStartedView(summary = state.startedSummary, onDone = onDismiss)
        return
    }

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp).padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // Header
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("STREAM TO TEAM", style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
            Text("Stream to ${team.name}", style = TaliseType.heading(24.sp, FontWeight.Medium), letterSpacing = (-0.5).sp, color = TaliseColors.fg)
            Text(
                "Fund a pot once. Everyone gets an equal share on a schedule, automatically and gaslessly.",
                style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted,
            )
        }

        // Amount card
        Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("AMOUNT TO STREAM", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
            Row(
                Modifier.fillMaxWidth().height(54.dp).background(TaliseColors.surface2, RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("$", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
                TextField(
                    value = amount,
                    onValueChange = { s -> amount = s.filter { it.isDigit() || it == '.' } },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("10.00", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgDim) },
                    textStyle = TaliseType.heading(22.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    colors = transparentFieldColors(),
                )
            }
        }

        // Schedule card
        Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("PAYOUTS", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
                Spacer(Modifier.weight(1f))
                StepperControl(
                    value = numTranches,
                    onDec = { if (numTranches > 1) numTranches -= 1 },
                    onInc = { if (numTranches < 365) numTranches += 1 },
                )
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("HOW OFTEN", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
                Spacer(Modifier.weight(1f))
                IntervalPicker(selected = interval, onSelect = { interval = it })
            }
        }

        // Summary card
        Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("PREVIEW", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
            val people = if (memberCount == 1) "person" else "people"
            Text(
                "$memberCount $people each get ${payrollUsd2(perMemberPerPayout)} per ${interval.unit}",
                style = TaliseType.body(14.sp, FontWeight.Normal), color = TaliseColors.fg,
            )
            Text("$numTranches payouts, ${payrollUsd2(totalUsd)} total", style = TaliseType.mono(11.sp), color = TaliseColors.fgMuted)
            if (totalUsd > 0 && perMemberPerPayout < 0.01) {
                Text(
                    "Each share is too small, add more or use fewer payouts (min $0.01 each).",
                    style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.danger,
                )
            }
        }

        state.error?.let {
            Text(it, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
        }

        SlideToConfirm(
            title = if (starting) "Starting…" else "Slide to start streaming",
            onConfirm = { start() },
            enabled = canStart,
            tint = TaliseColors.accent,
            reset = resetSlider,
        )

        Text(
            "One gasless transaction funds the pot. Payouts release automatically, no gas, ever.",
            style = TaliseType.mono(11.sp), color = TaliseColors.fgMuted,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun StepperControl(value: Int, onDec: () -> Unit, onInc: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StepperButton(Icons.Filled.Remove, onDec)
        Text("$value", style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.fg)
        StepperButton(Icons.Filled.Add, onInc)
    }
}

@Composable
private fun StepperButton(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier.size(30.dp).background(TaliseColors.surface2, CircleShape).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = TaliseColors.fg, modifier = Modifier.size(16.dp)) }
}

@Composable
private fun IntervalPicker(selected: StreamInterval, onSelect: (StreamInterval) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.clickable { open = true }.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(selected.label, style = TaliseType.body(15.sp, FontWeight.Medium), color = TaliseColors.accent)
            Icon(Icons.Filled.UnfoldMore, null, tint = TaliseColors.accent, modifier = Modifier.size(16.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            StreamInterval.entries.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(opt.label, style = TaliseType.body(15.sp, FontWeight.Normal), color = TaliseColors.fg) },
                    onClick = { onSelect(opt); open = false },
                )
            }
        }
    }
}

@Composable
private fun StreamStartedView(summary: String, onDone: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(92.dp).background(TaliseColors.accent.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.UnfoldMore, null, tint = TaliseColors.accent, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("Streaming started", style = TaliseType.heading(24.sp, FontWeight.Medium), color = TaliseColors.fg)
        Spacer(Modifier.height(8.dp))
        Text(summary, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        Spacer(Modifier.height(28.dp))
        Box(
            Modifier.fillMaxWidth().height(54.dp).background(TaliseColors.greenMint, RoundedCornerShape(27.dp)).clickable { onDone() },
            contentAlignment = Alignment.Center,
        ) { Text("Done", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = TaliseColors.inkOnGreen) }
    }
}

@Composable
private fun transparentFieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Color.Transparent,
    unfocusedContainerColor = Color.Transparent,
    disabledContainerColor = Color.Transparent,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
    disabledIndicatorColor = Color.Transparent,
    cursorColor = TaliseColors.accent,
)
