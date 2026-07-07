package io.talise.app.feature.payroll

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.R
import io.talise.app.core.model.TeamDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Payroll / Teams hub, ported 1:1 from iOS `PayrollView.swift`. A reusable
 * "team" is a saved list of recipients you pay all at once, one Onara-sponsored
 * batch payout (signAndExecuteRaw), no per-recipient gas, no juggling addresses.
 *
 * iOS drives its sub-screens (create/edit a team, pay a team, stream to a team)
 * with NavigationLink inside the parent's NavigationStack; here a small internal
 * back stack does the same, and the list reloads whenever it reappears (so a
 * save/pay upstream is reflected without a callback round-trip).
 */

/** Internal destinations, mirrors the iOS push structure. */
internal sealed interface PayrollDest {
    data object TeamList : PayrollDest
    data class Edit(val team: TeamDTO?) : PayrollDest
    data class Pay(val team: TeamDTO) : PayrollDest
    data class Stream(val team: TeamDTO) : PayrollDest
}

class PayrollViewModel : ViewModel() {

    data class State(
        val teams: List<TeamDTO> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        if (_state.value.teams.isEmpty()) _state.value = _state.value.copy(loading = true)
        _state.value = _state.value.copy(error = null)
        viewModelScope.launch {
            try {
                val teams = ApiClient.api.teams().teams
                _state.value = _state.value.copy(teams = teams, loading = false)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    error = "Couldn't load your teams right now.",
                    loading = false,
                )
            }
        }
    }
}

@Composable
fun PayrollScreen(onClose: () -> Unit, vm: PayrollViewModel = viewModel { PayrollViewModel() }) {
    // Internal back stack: root is the team list; pushes mirror iOS NavigationLink.
    val stack = remember { mutableStateListOf<PayrollDest>(PayrollDest.TeamList) }
    val top = stack.last()

    fun push(dest: PayrollDest) {
        stack.add(dest)
    }

    fun pop() {
        if (stack.size > 1) {
            stack.removeAt(stack.lastIndex)
            // Reload on every reappearance of the list so a save/pay on a pushed
            // screen is reflected the moment we pop back (mirrors iOS `.task`).
            if (stack.last() == PayrollDest.TeamList) vm.load()
        } else {
            onClose()
        }
    }

    BackHandler { pop() }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Back affordance; iOS relies on the nav-stack chevron.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 18.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(34.dp).background(TaliseColors.surface2, CircleShape).clickable { pop() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = TaliseColors.fg,
                    modifier = Modifier.size(15.dp),
                )
            }
        }

        when (top) {
            PayrollDest.TeamList -> PayrollListView(
                vm = vm,
                onNewTeam = { push(PayrollDest.Edit(null)) },
                onOpenTeam = { push(PayrollDest.Pay(it)) },
            )
            is PayrollDest.Edit -> TeamEditView(
                team = top.team,
                onDismiss = { pop() },
            )
            is PayrollDest.Pay -> PayTeamView(
                team = top.team,
                onEdit = { push(PayrollDest.Edit(top.team)) },
                onStream = { push(PayrollDest.Stream(top.team)) },
                onDismiss = { pop() },
            )
            is PayrollDest.Stream -> TeamStreamSetupView(
                team = top.team,
                onDismiss = { pop() },
            )
        }
    }
}

// MARK: - Team list (iOS PayrollView body)

@Composable
private fun PayrollListView(
    vm: PayrollViewModel,
    onNewTeam: () -> Unit,
    onOpenTeam: (TeamDTO) -> Unit,
) {
    val state by vm.state.collectAsStateWithLifecycle()

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // -- Header --
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "PAYROLL",
                style = TaliseType.mono(10.sp),
                letterSpacing = 1.4.sp,
                color = TaliseColors.fgDim,
            )
            Text(
                "Pay your team",
                style = TaliseType.heading(26.sp, FontWeight.Medium),
                letterSpacing = (-0.6).sp,
                color = TaliseColors.fg,
            )
            Text(
                "Save a team once, then pay everyone in one tap, one gasless transaction.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        // -- New team capsule --
        Row(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(TaliseColors.greenMint, CircleShape)
                .clickable { onNewTeam() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = Color.Black, modifier = Modifier.size(14.dp))
            Spacer(Modifier.size(10.dp))
            Text("New team", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = Color.Black)
        }

        when {
            state.loading -> LoadingState()
            state.error != null -> ErrorState(onRetry = { vm.load() })
            state.teams.isEmpty() -> EmptyState()
            else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                state.teams.forEach { team ->
                    TeamRow(team, onClick = { onOpenTeam(team) })
                }
            }
        }

        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun TeamRow(team: TeamDTO, onClick: () -> Unit) {
    val people = if (team.members.size == 1) "1 person" else "${team.members.size} people"
    // Sum of every member's saved amount (members with no saved amount count as
    // $0 toward the at-rest total shown on the row).
    val total = team.members.sumOf { it.amount ?: 0.0 }
    Row(
        Modifier
            .fillMaxWidth()
            .rampCard()
            .clickable { onClick() }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(46.dp).background(TaliseColors.greenMint.copy(alpha = 0.12f), RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(R.drawable.hi_team),
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(18.dp),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                team.name,
                style = TaliseType.heading(16.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(people, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(payrollUsd2(total), style = TaliseType.mono(14.sp), color = TaliseColors.fg)
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

// MARK: - States

@Composable
private fun LoadingState() {
    Box {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            repeat(3) {
                Box(Modifier.fillMaxWidth().height(78.dp).taliseGlass(radius = 20.dp))
            }
        }
        CircularProgressIndicator(
            color = TaliseColors.fgMuted,
            strokeWidth = 2.dp,
            modifier = Modifier.size(22.dp).align(Alignment.Center),
        )
    }
}

@Composable
private fun ErrorState(onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(top = 50.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Couldn't load your teams right now.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
        )
        Box(
            Modifier
                .height(46.dp)
                .background(TaliseColors.greenMint, CircleShape)
                .clickable { onRetry() }
                .padding(horizontal = 24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("Try again", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = Color.Black)
        }
    }
}

@Composable
private fun EmptyState() {
    Column(
        Modifier.fillMaxWidth().padding(top = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            painterResource(R.drawable.hi_team),
            contentDescription = null,
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(38.dp),
        )
        Text("No teams yet", style = TaliseType.heading(18.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            "Create one to pay a group in one transaction.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

// MARK: - Shared payroll helpers

/** "$X,XXX.XX" money string, mirroring iOS `TaliseFormat.usd2`. */
internal fun payrollUsd2(v: Double): String = "$" + "%,.2f".format(v)

/** Trailing-zero-free amount string, mirroring iOS `String(format: "%g", v)`. */
internal fun payrollAmountG(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

/** "0x1234…abcd" shortener, mirroring iOS `recipientShort`. */
internal fun payrollRecipientShort(r: String): String =
    if (r.startsWith("0x") && r.length > 12) "${r.take(6)}…${r.takeLast(4)}" else r

/** "1 person" / "N people", mirroring iOS `peopleCount`. */
internal fun payrollPeopleCount(n: Int): String = if (n == 1) "1 person" else "$n people"
