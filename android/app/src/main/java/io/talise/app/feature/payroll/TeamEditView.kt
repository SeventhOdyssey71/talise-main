package io.talise.app.feature.payroll

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircleOutline
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.core.model.RecipientResolution
import io.talise.app.core.model.TeamDTO
import io.talise.app.core.model.TeamMemberDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Create (team == null) or edit a reusable payout team, ported 1:1 from iOS
 * `TeamEditView.swift`. A team is a name plus a list of members; each member is
 * a recipient (@handle, name.talise.sui or 0x address) with an OPTIONAL default
 * amount + label. Amounts are confirmed (and editable) later on the pay screen,
 * so they're optional here.
 *
 * On save we drop blank-recipient rows, persist via the payroll prepare/record
 * pair, then dismiss. The Payroll list reloads on appearance, so popping back
 * reflects the change without an explicit callback.
 */

/** A locally-editable member row. `id` keeps Compose identity stable as rows
 *  are added/removed; the text fields are plain strings (amount is parsed only
 *  at save time). Mirrors iOS `MemberRow`. */
data class MemberRow(
    val id: String = UUID.randomUUID().toString(),
    val recipient: String = "",
    val amount: String = "",
    val label: String = "",
)

class TeamEditViewModel(private val team: TeamDTO?) : ViewModel() {

    data class State(
        val name: String = "",
        val rows: List<MemberRow> = emptyList(),
        val saving: Boolean = false,
        val error: String? = null,
        /** One-shot: flips true after a successful save so the screen pops. */
        val saved: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        // Seed the editor from the existing team once (a fresh team gets one
        // blank row so the form never looks empty). Mirrors iOS `hydrateOnce`.
        val rows = team?.members?.map {
            MemberRow(
                recipient = it.recipient,
                amount = it.amount?.let { a -> payrollAmountG(a) } ?: "",
                label = it.label ?: "",
            )
        }.orEmpty()
        _state.value = State(
            name = team?.name ?: "",
            rows = rows.ifEmpty { listOf(MemberRow()) },
        )
    }

    fun setName(name: String) {
        _state.value = _state.value.copy(name = name)
    }

    fun updateRow(row: MemberRow) {
        _state.value = _state.value.copy(
            rows = _state.value.rows.map { if (it.id == row.id) row else it },
        )
    }

    fun addRow() {
        _state.value = _state.value.copy(rows = _state.value.rows + MemberRow())
    }

    fun removeRow(id: String) {
        _state.value = _state.value.copy(rows = _state.value.rows.filterNot { it.id == id })
    }

    private fun namedRows(): List<MemberRow> =
        _state.value.rows.filter { it.recipient.trim().isNotEmpty() }

    fun canSave(): Boolean {
        val s = _state.value
        return s.name.trim().isNotEmpty() && namedRows().isNotEmpty() && !s.saving
    }

    fun save() {
        if (!canSave()) return
        val trimmedName = _state.value.name.trim()
        _state.value = _state.value.copy(saving = true, error = null)
        viewModelScope.launch {
            try {
                val members = namedRows().map { row ->
                    val amt = row.amount.trim().toDoubleOrNull()
                    val lbl = row.label.trim()
                    TeamMemberDTO(
                        recipient = row.recipient.trim(),
                        amount = if ((amt ?: 0.0) > 0) amt else null,
                        label = lbl.ifEmpty { null },
                    )
                }
                // Prepare: the server either persists immediately (DB mode) or hands
                // back sponsor-ready bytes for an on-chain create/edit.
                val prep = PayrollApi.service.prepareSaveTeam(SaveTeamBody(name = trimmedName, members = members))
                if (prep.mode == "onchain" && prep.bytes != null) {
                    val digest = PayrollApi.signAndExecuteRaw(prep.bytes, PayrollTxMeta())
                    PayrollApi.service.recordSaveTeam(
                        RecordSaveBody(
                            digest = digest,
                            name = prep.name ?: trimmedName,
                            members = members,
                            chainObjectId = prep.chainObjectId,
                        ),
                    )
                }
                // DB mode: already saved by the prepare call, nothing more to do.
                _state.value = _state.value.copy(saving = false, saved = true)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    saving = false,
                    error = PayrollApi.friendlyPayoutError(t, "Couldn't save your team. Please try again."),
                )
            }
        }
    }
}

@Composable
fun TeamEditView(
    team: TeamDTO?,
    onDismiss: () -> Unit,
    vm: TeamEditViewModel = viewModel(key = "team-edit-${team?.id ?: "new"}") { TeamEditViewModel(team) },
) {
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(state.saved) {
        if (state.saved) onDismiss()
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
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                if (team == null) "NEW TEAM" else "EDIT TEAM",
                style = TaliseType.mono(10.sp),
                letterSpacing = 1.4.sp,
                color = TaliseColors.fgDim,
            )
            Text(
                if (team == null) "Create a team" else team.name,
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.5).sp,
                color = TaliseColors.fg,
            )
            Text(
                "Add the people you pay together. You'll set or confirm amounts when you pay.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        // -- Team name --
        Column(
            Modifier.fillMaxWidth().rampCard().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "TEAM NAME",
                style = TaliseType.mono(10.sp),
                letterSpacing = 0.6.sp,
                color = TaliseColors.fgDim,
            )
            PayrollField(
                value = state.name,
                onValue = { vm.setName(it) },
                placeholder = "e.g. Design team",
                height = 48.dp,
                radius = 14.dp,
                textSize = 16.sp,
            )
        }

        // -- Members --
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "PEOPLE",
                style = TaliseType.mono(10.sp),
                letterSpacing = 0.6.sp,
                color = TaliseColors.fgDim,
            )
            if (state.rows.isEmpty()) {
                Text(
                    "No one added yet, tap “Add person” to start.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            } else {
                state.rows.forEach { row ->
                    MemberRowView(
                        row = row,
                        onChange = { vm.updateRow(it) },
                        onRemove = { vm.removeRow(row.id) },
                    )
                }
            }
        }

        // -- Add person --
        Row(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(TaliseColors.surface2, RoundedCornerShape(16.dp))
                .clickable { vm.addRow() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            Icon(
                Icons.Filled.AddCircleOutline,
                contentDescription = null,
                tint = TaliseColors.fg,
                modifier = Modifier.size(14.dp),
            )
            Text("Add person", style = TaliseType.body(15.sp, FontWeight.Medium), color = TaliseColors.fg)
        }

        state.error?.let {
            Text(it, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
        }

        // -- Save --
        val canSave = vm.canSave()
        Row(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(if (canSave) TaliseColors.greenMint else TaliseColors.surface2, CircleShape)
                .clickable(enabled = canSave) { vm.save() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            if (state.saving) {
                CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            }
            Text(
                if (state.saving) "Saving…" else "Save team",
                style = TaliseType.body(16.sp, FontWeight.SemiBold),
                color = if (canSave || state.saving) Color.Black else TaliseColors.fgDim,
            )
        }

        Spacer(Modifier.height(24.dp))
    }
}

/**
 * One person in the team editor, ported from iOS `MemberRowView`. Owns its own
 * live recipient resolution: as you type a @handle / name.talise.sui / 0x
 * address, it debounces (~0.4s) then hits `/api/recipient/resolve` (the same
 * path Send + Stream use) and shows the matched identity, so a typo is caught
 * here, not at pay time.
 */
@Composable
private fun MemberRowView(
    row: MemberRow,
    onChange: (MemberRow) -> Unit,
    onRemove: () -> Unit,
) {
    var resolved by remember { mutableStateOf<RecipientResolution?>(null) }
    var resolving by remember { mutableStateOf(false) }
    var resolveFailed by remember { mutableStateOf(false) }

    val trimmedRecipient = row.recipient.trim()

    // Re-resolve whenever the typed recipient changes (debounced).
    LaunchedEffect(trimmedRecipient) {
        if (trimmedRecipient.isEmpty()) {
            resolved = null
            resolveFailed = false
            resolving = false
            return@LaunchedEffect
        }
        // Debounce, coalesce fast typing into one request.
        delay(400)
        resolving = true
        resolveFailed = false
        try {
            val r = ApiClient.api.resolveRecipient(trimmedRecipient)
            resolved = r
            resolveFailed = false
        } catch (t: Throwable) {
            resolved = null
            resolveFailed = true
        } finally {
            resolving = false
        }
    }

    Column(
        Modifier.fillMaxWidth().rampCard().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.weight(1f)) {
                PayrollField(
                    value = row.recipient,
                    onValue = { onChange(row.copy(recipient = it)) },
                    placeholder = "@handle, name.talise.sui or 0x…",
                    height = 46.dp,
                    radius = 12.dp,
                    textSize = 15.sp,
                )
            }
            Box(
                Modifier.size(34.dp).background(TaliseColors.surface2, CircleShape).clickable { onRemove() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Remove",
                    tint = TaliseColors.fgMuted,
                    modifier = Modifier.size(12.dp),
                )
            }
        }

        // -- Resolution line --
        if (resolving) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CircularProgressIndicator(
                    color = TaliseColors.fgMuted,
                    strokeWidth = 1.5.dp,
                    modifier = Modifier.size(12.dp),
                )
                Text("Finding…", style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            }
        } else if (resolved != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    resolved!!.label,
                    style = TaliseType.body(12.5.sp),
                    color = TaliseColors.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        } else if (resolveFailed) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(
                    Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    tint = TaliseColors.danger,
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    "No one found by that name",
                    style = TaliseType.body(12.sp, FontWeight.Light),
                    color = TaliseColors.danger,
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                Modifier
                    .weight(1f)
                    .height(46.dp)
                    .background(TaliseColors.surface2, RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("$", style = TaliseType.body(15.sp), color = TaliseColors.fgMuted)
                BasicTextField(
                    value = row.amount,
                    onValueChange = { text -> onChange(row.copy(amount = text.filter { ch -> ch.isDigit() || ch == '.' })) },
                    textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    cursorBrush = SolidColor(TaliseColors.greenMint),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (row.amount.isEmpty()) {
                                Text("Amount", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                            }
                            inner()
                        }
                    },
                )
            }
            Box(Modifier.weight(1f)) {
                PayrollField(
                    value = row.label,
                    onValue = { onChange(row.copy(label = it)) },
                    placeholder = "Label (optional)",
                    height = 46.dp,
                    radius = 12.dp,
                    textSize = 15.sp,
                )
            }
        }
    }
}

/** Flat surface2 text field matching the SwiftUI originals. */
@Composable
internal fun PayrollField(
    value: String,
    onValue: (String) -> Unit,
    placeholder: String,
    height: androidx.compose.ui.unit.Dp,
    radius: androidx.compose.ui.unit.Dp,
    textSize: androidx.compose.ui.unit.TextUnit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(height)
            .background(TaliseColors.surface2, RoundedCornerShape(radius))
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValue,
            textStyle = TaliseType.body(textSize).copy(color = TaliseColors.fg),
            singleLine = true,
            cursorBrush = SolidColor(TaliseColors.greenMint),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(placeholder, style = TaliseType.body(textSize), color = TaliseColors.fgDim, maxLines = 1)
                    }
                    inner()
                }
            },
        )
    }
}
