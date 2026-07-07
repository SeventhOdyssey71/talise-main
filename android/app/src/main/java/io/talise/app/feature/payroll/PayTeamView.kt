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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
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
import io.talise.app.core.session.TaliseEvents
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Review-and-pay a saved team in one gasless transaction, ported 1:1 from iOS
 * `PayTeamView.swift`. Each member's amount is pre-filled from the saved
 * default (editable here; members with no saved amount start blank and must be
 * filled). Every shown member must have a positive amount before the batch can
 * go out.
 *
 * Confirm flow (Onara-sponsored, no per-recipient gas):
 *   1. prepareBatch(recipients:) -> batchId + sponsored bytes + total
 *   2. signAndExecuteRaw(bytesB64:meta:) -> digest
 *   3. recordBatch(batchId:digest:) -> server records the executed payout
 */
class PayTeamViewModel(private val team: TeamDTO) : ViewModel() {

    data class State(
        /** Editable amount text per member, keyed by member index. */
        val amounts: List<String> = emptyList(),
        val paying: Boolean = false,
        val paid: Boolean = false,
        val paidCount: Int = 0,
        val paidTotal: Double = 0.0,
        val error: String? = null,
        /** Forces the slider knob back to start after a failed confirm. */
        val resetSliderTick: Int = 0,
        val deleting: Boolean = false,
        /** One-shot: flips true after a successful delete so the screen pops. */
        val deleted: Boolean = false,
    )

    private val _state = MutableStateFlow(
        State(amounts = team.members.map { it.amount?.let { a -> payrollAmountG(a) } ?: "" }),
    )
    val state: StateFlow<State> = _state.asStateFlow()

    fun setAmount(idx: Int, text: String) {
        val amounts = _state.value.amounts.toMutableList()
        if (idx < amounts.size) {
            amounts[idx] = text
            _state.value = _state.value.copy(amounts = amounts)
        }
    }

    fun parsedAmounts(): List<Double> = _state.value.amounts.map { it.trim().toDoubleOrNull() ?: 0.0 }

    fun total(): Double = parsedAmounts().sum()

    /** Every shown member must have a positive amount to pay the batch. */
    fun allFilled(): Boolean = team.members.isNotEmpty() && parsedAmounts().all { it > 0 }

    private fun bounceSlider() {
        _state.value = _state.value.copy(resetSliderTick = _state.value.resetSliderTick + 1)
    }

    fun pay() {
        if (_state.value.paying) return
        if (!allFilled()) {
            _state.value = _state.value.copy(error = "Enter a positive amount for everyone before paying.")
            bounceSlider()
            return
        }
        _state.value = _state.value.copy(paying = true, error = null)

        val recipients = team.members.zip(parsedAmounts()).mapNotNull { (member, amount) ->
            if (amount > 0) BatchRecipient(to = member.recipient, amount = amount, label = member.label) else null
        }
        if (recipients.isEmpty()) {
            _state.value = _state.value.copy(
                paying = false,
                error = "Enter a positive amount for everyone before paying.",
            )
            bounceSlider()
            return
        }

        viewModelScope.launch {
            try {
                val resp = PayrollApi.service.prepareBatch(
                    BatchPrepareBody(
                        recipients = recipients,
                        asset = "USDsui",
                        teamName = team.name,
                        teamId = team.id,
                    ),
                )
                val digest = PayrollApi.signAndExecuteRaw(
                    bytesB64 = resp.bytes,
                    meta = PayrollTxMeta(kind = "payout-batch", amountUsd = resp.totalUsd),
                )
                PayrollApi.service.recordBatch(resp.batchId, DigestBody(digest))

                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "sent",
                        amountUsdsui = resp.totalUsd,
                        counterpartyName = team.name,
                    ),
                )

                _state.value = _state.value.copy(
                    paying = false,
                    paid = true,
                    paidCount = resp.recipientCount,
                    paidTotal = resp.totalUsd,
                )
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    paying = false,
                    error = PayrollApi.friendlyPayoutError(t, "Couldn't pay the team. Please try again."),
                )
                bounceSlider()
            }
        }
    }

    fun deleteTeam() {
        if (_state.value.deleting) return
        _state.value = _state.value.copy(deleting = true, error = null)
        viewModelScope.launch {
            try {
                // DB-only teams delete immediately; on-chain teams return
                // sponsor-ready `payroll::delete` bytes to sign, then record.
                val resp = PayrollApi.service.prepareDeleteTeam(team.id)
                if (resp.mode == "onchain" && resp.bytes != null) {
                    val digest = PayrollApi.signAndExecuteRaw(resp.bytes, PayrollTxMeta())
                    PayrollApi.service.recordDeleteTeam(team.id, DigestBody(digest))
                }
                // Pop back to the list, which reloads on appear.
                _state.value = _state.value.copy(deleting = false, deleted = true)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    deleting = false,
                    error = "Couldn't delete that team. Please try again.",
                )
            }
        }
    }
}

@Composable
fun PayTeamView(
    team: TeamDTO,
    onEdit: () -> Unit,
    onStream: () -> Unit,
    onDismiss: () -> Unit,
    vm: PayTeamViewModel = viewModel(key = "pay-team-${team.id}") { PayTeamViewModel(team) },
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var confirmDelete by remember { mutableStateOf(false) }
    var sliderReset by remember { mutableStateOf(false) }

    LaunchedEffect(state.deleted) {
        if (state.deleted) onDismiss()
    }
    LaunchedEffect(state.resetSliderTick) {
        if (state.resetSliderTick > 0) {
            sliderReset = true
            delay(80)
            sliderReset = false
        }
    }

    if (state.paid) {
        SuccessCard(paidCount = state.paidCount, paidTotal = state.paidTotal)
        return
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            containerColor = TaliseColors.surface,
            title = {
                Text("Delete ${team.name}?", style = TaliseType.heading(17.sp, FontWeight.Medium), color = TaliseColors.fg)
            },
            text = {
                Text(
                    "This removes the saved team. It won't affect any payments already sent.",
                    style = TaliseType.body(13.5.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    vm.deleteTeam()
                }) {
                    Text("Delete team", color = TaliseColors.sentRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) {
                    Text("Cancel", color = TaliseColors.fg)
                }
            },
        )
    }

    Column(
        Modifier
            .fillMaxWidth()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // -- Header --
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "PAY TEAM",
                        style = TaliseType.mono(10.sp),
                        letterSpacing = 1.4.sp,
                        color = TaliseColors.fgDim,
                    )
                    Text(
                        team.name,
                        style = TaliseType.heading(24.sp, FontWeight.Medium),
                        letterSpacing = (-0.5).sp,
                        color = TaliseColors.fg,
                    )
                }
                Row(
                    Modifier
                        .height(34.dp)
                        .background(TaliseColors.surface2, CircleShape)
                        .clickable { onEdit() }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(
                        Icons.Filled.Edit,
                        contentDescription = null,
                        tint = TaliseColors.fg,
                        modifier = Modifier.size(11.dp),
                    )
                    Text("Edit team", style = TaliseType.body(13.sp), color = TaliseColors.fg)
                }
            }
            Text(
                "Confirm what each person gets, then pay everyone at once.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        // -- Member list --
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            team.members.forEachIndexed { idx, member ->
                Row(
                    Modifier.fillMaxWidth().rampCard().padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            member.label ?: payrollRecipientShort(member.recipient),
                            style = TaliseType.body(15.sp, FontWeight.Medium),
                            color = TaliseColors.fg,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (member.label != null) {
                            Text(
                                payrollRecipientShort(member.recipient),
                                style = TaliseType.mono(10.sp),
                                color = TaliseColors.fgDim,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Row(
                        Modifier
                            .height(44.dp)
                            .background(TaliseColors.surface2, RoundedCornerShape(12.dp))
                            .padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text("$", style = TaliseType.body(15.sp), color = TaliseColors.fgMuted)
                        BasicTextField(
                            value = state.amounts.getOrElse(idx) { "" },
                            onValueChange = { text ->
                                vm.setAmount(idx, text.filter { ch -> ch.isDigit() || ch == '.' })
                            },
                            textStyle = TaliseType.mono(15.sp)
                                .copy(color = TaliseColors.fg, textAlign = TextAlign.End),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                            cursorBrush = SolidColor(TaliseColors.greenMint),
                            modifier = Modifier.width(86.dp),
                            decorationBox = { inner ->
                                Box(contentAlignment = Alignment.CenterEnd) {
                                    if (state.amounts.getOrElse(idx) { "" }.isEmpty()) {
                                        Text(
                                            "0",
                                            style = TaliseType.mono(15.sp),
                                            color = TaliseColors.fgDim,
                                            modifier = Modifier.fillMaxWidth(),
                                            textAlign = TextAlign.End,
                                        )
                                    }
                                    inner()
                                }
                            },
                        )
                    }
                }
            }
        }

        // -- Total --
        Row(
            Modifier.fillMaxWidth().rampCard().padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "TOTAL",
                style = TaliseType.mono(11.sp),
                letterSpacing = 1.2.sp,
                color = TaliseColors.fgDim,
                modifier = Modifier.weight(1f),
            )
            Text(
                payrollUsd2(vm.total()),
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
        }

        state.error?.let {
            Text(it, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
        }

        val allFilled = vm.allFilled()
        SlideToConfirm(
            title = if (state.paying) "Paying…" else "Slide to pay ${payrollUsd2(vm.total())}",
            tint = TaliseColors.greenMint,
            reset = sliderReset,
            enabled = allFilled && !state.paying,
            onConfirm = { vm.pay() },
        )

        // -- Gasless note --
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterHorizontally),
        ) {
            Icon(
                Icons.Filled.Bolt,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(10.dp),
            )
            Text(
                "Paid in one transaction, no network fee, Talise sponsors the gas.",
                style = TaliseType.mono(10.sp, FontWeight.Light),
                letterSpacing = 0.2.sp,
                color = TaliseColors.fgDim,
            )
        }

        // Stream instead of paying all at once: fund a pot, equal shares
        // release to the team on a schedule (gasless), until it's empty.
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .background(TaliseColors.surface2, RoundedCornerShape(16.dp))
                .clickable { onStream() }
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                painterResource(R.drawable.hi_stream),
                contentDescription = null,
                tint = TaliseColors.fg,
                modifier = Modifier.size(14.dp),
            )
            Text(
                "Stream over time instead",
                style = TaliseType.body(15.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(14.dp),
            )
        }

        // Subtle, deliberate delete, lives on the team's own screen (not the
        // list), de-emphasized so it's never an accidental tap.
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(enabled = !state.deleting && !state.paying) { confirmDelete = true }
                .padding(top = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        ) {
            if (state.deleting) {
                CircularProgressIndicator(
                    color = TaliseColors.fgDim,
                    strokeWidth = 1.5.dp,
                    modifier = Modifier.size(12.dp),
                )
            }
            Text(
                if (state.deleting) "Removing…" else "Delete team",
                style = TaliseType.body(13.sp),
                color = TaliseColors.fgDim,
            )
        }

        Spacer(Modifier.height(20.dp))
    }
}

// MARK: - Success

@Composable
private fun SuccessCard(paidCount: Int, paidTotal: Double) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.weight(0.4f))
        Box(
            Modifier.size(96.dp).background(TaliseColors.greenMint.copy(alpha = 0.16f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Verified,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(56.dp),
            )
        }
        Text("Team paid", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            "Paid ${payrollPeopleCount(paidCount)} · ${payrollUsd2(paidTotal)}",
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.weight(1f))
    }
}
