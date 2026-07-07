package io.talise.app.feature.withdraw

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Nigerian bank transfer — the Android port of iOS `BankWithdrawView` (Linq
 * off-ramp): enter USDsui amount + account + bank → QUOTE (name-check + rate)
 * → slide to confirm (USDsui → Linq deposit wallet) → POLL until completed.
 */
@Composable
fun BankWithdrawScreen(onBack: () -> Unit, vm: BankWithdrawViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var showBankPicker by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        WithdrawTopBar(title = "Withdraw to Bank", onBack = onBack)
        when (state.step) {
            BankWithdrawViewModel.Step.Form -> FormView(
                state = state,
                vm = vm,
                onPickBank = { showBankPicker = true },
            )
            BankWithdrawViewModel.Step.Review -> ReviewView(state = state, vm = vm)
            BankWithdrawViewModel.Step.Sending,
            BankWithdrawViewModel.Step.Done,
            -> StatusView(state = state, vm = vm, onDone = onBack)
        }
    }

    if (showBankPicker) {
        BankPickerSheet(
            banks = offrampBanks,
            selected = state.selectedBank,
            onSelect = { vm.onBankSelected(it) },
            onDismiss = { showBankPicker = false },
        )
    }
}

// ── Form ────────────────────────────────────────────────────────────────────

@Composable
private fun FormView(
    state: BankWithdrawViewModel.UiState,
    vm: BankWithdrawViewModel,
    onPickBank: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 12.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            FieldLabel("Amount in USDsui")
            AmountField(value = state.amount, onChange = vm::onAmountChanged)
            // Live estimate under the amount, display-only.
            val rate = state.displayRate
            if (rate != null && rate > 0 && state.amountValue > 0) {
                Text(
                    "≈ ₦${ngnGrouped(state.amountValue * rate)}",
                    style = TaliseType.mono(12.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier.padding(start = 2.dp),
                )
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            FieldLabel("Bank")
            BankPickerRow(selected = state.selectedBank, onClick = onPickBank)
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FieldLabel("Receiver's account")
            AccountField(value = state.accountNumber, onChange = vm::onAccountChanged)
            ResolvedNameLine(state)
        }

        state.error?.let {
            Text(
                it,
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.danger,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            )
        }

        Spacer(Modifier.height(8.dp))

        // Continue → quote.
        val enabled = state.canContinue && !state.quoting
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 4.dp)
                .height(56.dp)
                .background(
                    if (enabled) TaliseColors.fg else TaliseColors.fg.copy(alpha = 0.35f),
                    CircleShape,
                )
                .clickable(enabled = enabled) { vm.getQuote() },
            contentAlignment = Alignment.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.quoting) {
                    CircularProgressIndicator(
                        color = TaliseColors.bg,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Text(
                    if (state.quoting) "Checking…" else "Continue",
                    style = TaliseType.heading(16.sp, FontWeight.Medium),
                    color = TaliseColors.bg,
                )
            }
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(
        text,
        style = TaliseType.mono(10.sp, FontWeight.Light),
        letterSpacing = 1.3.sp,
        color = TaliseColors.fgDim,
    )
}

@Composable
private fun AmountField(value: String, onChange: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().fieldSurface().padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("$", style = TaliseType.heading(20.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            textStyle = TaliseType.heading(20.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
            cursorBrush = SolidColor(TaliseColors.accent),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                if (value.isEmpty()) {
                    Text("0", style = TaliseType.heading(20.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                }
                inner()
            },
        )
    }
}

@Composable
private fun AccountField(value: String, onChange: (String) -> Unit) {
    Box(Modifier.fillMaxWidth().fieldSurface().padding(horizontal = 16.dp, vertical = 16.dp)) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
            cursorBrush = SolidColor(TaliseColors.accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                if (value.isEmpty()) {
                    Text("10-digit account number", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                }
                inner()
            },
        )
    }
}

/** Inline detected-name feedback: resolving → success (check + holder name) → failure. */
@Composable
private fun ResolvedNameLine(state: BankWithdrawViewModel.UiState) {
    when {
        state.resolving -> Row(
            Modifier.padding(start = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            CircularProgressIndicator(
                color = TaliseColors.fgMuted,
                strokeWidth = 1.5.dp,
                modifier = Modifier.size(12.dp),
            )
            Text(
                "Checking account…",
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
        state.resolvedName != null -> Row(
            Modifier.padding(start = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(14.dp),
            )
            Text(
                state.resolvedName,
                style = TaliseType.body(13.sp, FontWeight.Medium),
                color = TaliseColors.accent,
                maxLines = 1,
            )
        }
        state.resolveError != null -> Text(
            state.resolveError,
            style = TaliseType.body(12.sp, FontWeight.Light),
            color = TaliseColors.danger,
            maxLines = 2,
            modifier = Modifier.padding(start = 2.dp),
        )
    }
}

/** Tappable row that opens the searchable bank-picker sheet. */
@Composable
private fun BankPickerRow(selected: OfframpBank?, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .fieldSurface()
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (selected != null) {
            BankAvatar(bankCode = selected.bankCode, bankName = selected.name, size = 34.dp, cornerRadius = 9.dp)
        }
        Text(
            selected?.name ?: "Select bank",
            style = TaliseType.body(15.sp),
            color = if (selected == null) TaliseColors.fgDim else TaliseColors.fg,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.Filled.KeyboardArrowDown,
            contentDescription = null,
            tint = TaliseColors.fgMuted,
            modifier = Modifier.size(16.dp),
        )
    }
}

// ── Review (quote) ──────────────────────────────────────────────────────────

@Composable
private fun ReviewView(state: BankWithdrawViewModel.UiState, vm: BankWithdrawViewModel) {
    val q = state.quote ?: return
    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text(
                "Review withdrawal",
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.5).sp,
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            )

            // Summary card — headline receive amount, then details.
            Column(Modifier.fillMaxWidth().fieldSurface(cornerRadius = 22.dp)) {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Eyebrow("You receive")
                    Text(
                        "₦${ngnGrouped(q.amountNgn)}",
                        style = TaliseType.heading(40.sp, FontWeight.Medium),
                        letterSpacing = (-1).sp,
                        color = TaliseColors.fg,
                        maxLines = 1,
                    )
                }
                ReviewDivider()
                Column(Modifier.padding(horizontal = 16.dp)) {
                    ReviewRow("To", q.accountName)
                    ReviewDivider()
                    ReviewRow("Bank", q.bankName.ifEmpty { state.selectedBank?.name ?: "-" })
                    ReviewDivider()
                    ReviewRow("Account", maskAccount(state.accountNumber))
                    ReviewDivider()
                    ReviewRow("You send", "${usd2(q.amountUsdsui)} USDsui")
                    ReviewDivider()
                    ReviewRow("Rate", "$1 = ₦${ngnGrouped(q.rate)}")
                }
            }

            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
            ) {
                Icon(
                    Icons.Filled.Verified,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    "No network fee, sponsored by Talise.",
                    style = TaliseType.mono(11.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            state.error?.let {
                Text(
                    it,
                    style = TaliseType.body(12.sp),
                    color = TaliseColors.danger,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.fillMaxWidth().alpha(if (state.confirming) 0.5f else 1f)) {
                SlideToConfirm(
                    title = "Slide to withdraw",
                    tint = TaliseColors.greenMint,
                    enabled = !state.confirming,
                    reset = state.error != null,
                    onConfirm = { vm.confirm() },
                )
            }
            Text(
                "Edit",
                style = TaliseType.body(14.sp),
                color = TaliseColors.fgMuted,
                modifier = Modifier.clickable(enabled = !state.confirming) { vm.edit() },
            )
        }
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        Spacer(Modifier.weight(1f))
        Text(
            value,
            style = TaliseType.body(14.sp, FontWeight.Medium),
            color = TaliseColors.fg,
            textAlign = TextAlign.End,
        )
    }
}

@Composable
private fun ReviewDivider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
}

// ── Status (sending / done) ─────────────────────────────────────────────────

@Composable
private fun StatusView(
    state: BankWithdrawViewModel.UiState,
    vm: BankWithdrawViewModel,
    onDone: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Spacer(Modifier.weight(1f))

        // Icon: comet-tail ring while sending; seal/clock on success; triangle on failure.
        when {
            state.step == BankWithdrawViewModel.Step.Sending -> TaliseLoadingRing(size = 64.dp, lineWidth = 3.5.dp)
            state.finalStatus == "completed" -> Box(
                Modifier.size(96.dp).background(TaliseColors.greenMint.copy(alpha = 0.16f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (state.paidOut) Icons.Filled.Verified else Icons.Filled.Schedule,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(if (state.paidOut) 56.dp else 50.dp),
                )
            }
            else -> Box(
                Modifier.size(96.dp).background(TaliseColors.danger.copy(alpha = 0.16f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Warning,
                    contentDescription = null,
                    tint = TaliseColors.danger,
                    modifier = Modifier.size(52.dp),
                )
            }
        }

        Text(
            state.statusHeadline,
            style = TaliseType.heading(24.sp, FontWeight.Medium),
            letterSpacing = (-0.5).sp,
            color = TaliseColors.fg,
        )
        Text(
            state.statusText,
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 30.dp),
        )

        Spacer(Modifier.weight(1f))

        if (state.step == BankWithdrawViewModel.Step.Done) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.finalStatus == "failed") {
                    FilledCapsuleButton("Try again") { vm.tryAgain() }
                    Text(
                        "Close",
                        style = TaliseType.body(14.sp),
                        color = TaliseColors.fgMuted,
                        modifier = Modifier.clickable { onDone() },
                    )
                } else {
                    FilledCapsuleButton("Done") { onDone() }
                }
            }
        }
    }
}

@Composable
private fun FilledCapsuleButton(title: String, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(TaliseColors.fg, CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(title, style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.bg)
    }
}

// ── Searchable bank picker ──────────────────────────────────────────────────

/**
 * Clean, searchable bank list presented as a sheet — iOS `BankPickerSheet`.
 * Each row = brand/letter avatar + the bank name, checkmark on the selected
 * one. Tapping a row selects it and dismisses.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BankPickerSheet(
    banks: List<OfframpBank>,
    selected: OfframpBank?,
    onSelect: (OfframpBank) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    val filtered = remember(query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) banks else banks.filter { it.name.lowercase().contains(q) }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = TaliseColors.bg,
    ) {
        Column(Modifier.fillMaxWidth()) {
            // Title.
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 2.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Select bank",
                    style = TaliseType.heading(18.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .size(30.dp)
                        .background(TaliseColors.surface2, CircleShape)
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Close",
                        tint = TaliseColors.fg,
                        modifier = Modifier.size(13.dp),
                    )
                }
            }

            // Search field.
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .fieldSurface()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Filled.Search,
                    contentDescription = null,
                    tint = TaliseColors.fgMuted,
                    modifier = Modifier.size(15.dp),
                )
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (query.isEmpty()) {
                            Text("Search banks", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                        }
                        inner()
                    },
                )
            }
            Spacer(Modifier.height(8.dp))

            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false).padding(top = 4.dp)) {
                items(filtered, key = { it.id }) { bank ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                onSelect(bank)
                                onDismiss()
                            }
                            .padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        BankAvatar(bankCode = bank.bankCode, bankName = bank.name, size = 36.dp, cornerRadius = 10.dp)
                        Text(
                            bank.name,
                            style = TaliseType.body(15.sp),
                            color = TaliseColors.fg,
                            modifier = Modifier.weight(1f),
                        )
                        if (bank.bankCode == selected?.bankCode) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = null,
                                tint = TaliseColors.accent,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
