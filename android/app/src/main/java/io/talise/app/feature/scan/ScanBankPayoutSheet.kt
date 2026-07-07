package io.talise.app.feature.scan

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTimeFilled
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * "Send to bank account" sheet, presented over the scanner once we have a
 * `{bank, accountNumber}` (from OCR or manual entry). An exact port of iOS
 * `ScanBankPayoutSheet`: resolve the holder name, enter Naira with a live
 * rate, then run the off-ramp: quote → create → sign+send the EXACT returned
 * USDsui → poll.
 */
@Composable
fun ScanBankPayoutSheet(
    bank: ScanBank,
    accountNumber: String,
    /** Called after the payout lands (Done) so the scanner can tear the whole surface down. */
    onPaid: () -> Unit,
    /** Cancel / Close taps, dismisses this sheet back to the scanner. */
    onCancel: () -> Unit,
    vm: ScanBankPayoutViewModel = viewModel(key = "bankpayout-${bank.code}-$accountNumber"),
) {
    val ui by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.start(bank, accountNumber) }

    Box(Modifier.fillMaxWidth().background(TaliseColors.bg)) {
        when (ui.step) {
            ScanBankPayoutViewModel.Step.Form -> PayoutFormView(
                bank = bank,
                accountNumber = accountNumber,
                ui = ui,
                onContinue = { amountNgn -> vm.getQuote(amountNgn) },
                onCancel = onCancel,
            )
            ScanBankPayoutViewModel.Step.Review -> PayoutReviewView(
                bank = bank,
                accountNumber = accountNumber,
                ui = ui,
                onConfirm = { vm.confirm() },
                onEdit = { vm.edit() },
            )
            ScanBankPayoutViewModel.Step.Sending,
            ScanBankPayoutViewModel.Step.Done,
            -> PayoutStatusView(
                ui = ui,
                onDone = onPaid,
                onTryAgain = { vm.tryAgain() },
                onClose = onCancel,
            )
        }
    }
}

// MARK: - Form

@Composable
private fun PayoutFormView(
    bank: ScanBank,
    accountNumber: String,
    ui: ScanBankPayoutViewModel.UiState,
    onContinue: (Double) -> Unit,
    onCancel: () -> Unit,
) {
    var amount by rememberSaveable { mutableStateOf("") }
    val focusManager = LocalFocusManager.current
    val amountNgn = amount.replace(",", "").toDoubleOrNull() ?: 0.0
    val canContinue = amountNgn > 0 && ui.resolvedName != null && ui.resolveError == null &&
        !ui.resolving && !ui.quoting

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { focusManager.clearFocus() },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        GrabHandle(modifier = Modifier.padding(top = 10.dp))

        Text(
            "Send to bank account",
            style = TaliseType.heading(20.sp, FontWeight.SemiBold),
            letterSpacing = (-0.5).sp,
            color = TaliseColors.fg,
            modifier = Modifier.padding(top = 18.dp),
        )

        PayoutRecipientCard(
            bank = bank,
            accountNumber = accountNumber,
            ui = ui,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 22.dp),
        )

        // Amount to send (₦, whole Naira).
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Amount to send", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("₦", style = TaliseType.heading(38.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
                Box(contentAlignment = Alignment.Center) {
                    if (amount.isEmpty()) {
                        Text("0", style = TaliseType.heading(48.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
                    }
                    BasicTextField(
                        value = amount,
                        onValueChange = { new -> amount = new.filter { it.isDigit() } },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                        textStyle = TextStyle(
                            fontFamily = TaliseType.sansFamily,
                            fontSize = 48.sp,
                            fontWeight = FontWeight.Medium,
                            color = TaliseColors.fg,
                            textAlign = TextAlign.Center,
                        ),
                        cursorBrush = SolidColor(TaliseColors.accent),
                    )
                }
            }
        }

        // Live "≈ $X USDsui" estimate under the amount, display only; the
        // locked debit comes from quote/create.
        val rate = ui.displayRate
        Text(
            if (rate != null && rate > 0 && amountNgn > 0) {
                "≈ ${usd2(amountNgn / rate)} USDsui"
            } else {
                "USDsui"
            },
            style = TaliseType.mono(12.sp),
            color = TaliseColors.fgDim,
            modifier = Modifier.padding(top = 10.dp),
        )

        if (ui.error != null) {
            Text(
                ui.error,
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.danger,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(horizontal = 32.dp)
                    .padding(top = 12.dp),
            )
        }

        Spacer(Modifier.height(24.dp))

        // Continue.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .height(56.dp)
                .clip(CircleShape)
                .background(if (canContinue) TaliseColors.fg else TaliseColors.fg.copy(alpha = 0.35f))
                .clickable(enabled = canContinue) {
                    focusManager.clearFocus()
                    onContinue(amountNgn)
                },
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (ui.quoting) {
                CircularProgressIndicator(color = TaliseColors.bg, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(
                if (ui.quoting) "Checking…" else "Continue",
                style = TaliseType.heading(16.sp, FontWeight.Medium),
                color = TaliseColors.bg,
            )
        }

        // Cancel.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 12.dp, bottom = 18.dp)
                .height(44.dp)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { onCancel() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "Cancel",
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = TaliseColors.fgMuted,
            )
        }
    }
}

/** To {name} {acct} • {bank}, the destination card with inline name-enquiry. */
@Composable
private fun PayoutRecipientCard(
    bank: ScanBank,
    accountNumber: String,
    ui: ScanBankPayoutViewModel.UiState,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(22.dp))
            .background(TaliseColors.surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ScanBankAvatar(bankCode = bank.code, bankName = bank.name, size = 46.dp, cornerRadius = 13.dp)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            when {
                ui.resolving -> Row(
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
                        style = TaliseType.body(14.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }
                ui.resolvedName != null -> Text(
                    ui.resolvedName,
                    style = TaliseType.heading(16.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    maxLines = 1,
                )
                ui.resolveError != null -> Text(
                    ui.resolveError,
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.danger,
                    maxLines = 2,
                )
            }
            Text(
                "$accountNumber • ${bank.name}",
                style = TaliseType.mono(11.sp),
                color = TaliseColors.fgDim,
                maxLines = 1,
            )
        }
    }
}

// MARK: - Review

@Composable
private fun PayoutReviewView(
    bank: ScanBank,
    accountNumber: String,
    ui: ScanBankPayoutViewModel.UiState,
    onConfirm: () -> Unit,
    onEdit: () -> Unit,
) {
    val q = ui.quote ?: return
    var slideReset by remember { mutableStateOf(false) }

    // Spring the knob back after a failed attempt.
    LaunchedEffect(ui.resetTick) {
        if (ui.resetTick > 0) {
            slideReset = true
            delay(60)
            slideReset = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text(
                "Review payment",
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.5).sp,
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            )

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(22.dp))
                    .background(TaliseColors.surface)
                    .padding(horizontal = 16.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "They receive",
                        style = TaliseType.mono(10.sp),
                        letterSpacing = 1.3.sp,
                        color = TaliseColors.fgDim,
                    )
                    Text(
                        "₦${ScanBankPayoutViewModel.ngnGrouped(q.amountNgn)}",
                        style = TaliseType.heading(40.sp, FontWeight.Medium),
                        letterSpacing = (-1).sp,
                        color = TaliseColors.fg,
                        maxLines = 1,
                    )
                }

                ReviewDivider()
                ReviewRow("To", q.accountName)
                ReviewDivider()
                ReviewRow("Bank", q.bankName.ifEmpty { bank.name })
                ReviewDivider()
                ReviewRow("Account", maskAccount(accountNumber))
                ReviewDivider()
                ReviewRow("You send", "${usd2(q.amountUsdsui)} USDsui")
                ReviewDivider()
                ReviewRow("Rate", "$1 = ₦${ScanBankPayoutViewModel.ngnGrouped(q.rate)}")
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Verified, null, tint = TaliseColors.greenMint, modifier = Modifier.size(11.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    "No network fee, sponsored by Talise.",
                    style = TaliseType.mono(11.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            if (ui.error != null) {
                Text(
                    ui.error,
                    style = TaliseType.body(12.sp),
                    color = TaliseColors.danger,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SlideToConfirm(
                title = "Slide to send",
                tint = TaliseColors.accent,
                enabled = !ui.confirming,
                reset = slideReset,
                onConfirm = { onConfirm() },
            )
            Box(
                modifier = Modifier
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        enabled = !ui.confirming,
                    ) { onEdit() }
                    .padding(4.dp),
            ) {
                Text("Edit", style = TaliseType.body(14.sp), color = TaliseColors.fgMuted)
            }
        }
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
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
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(TaliseColors.line),
    )
}

// MARK: - Status

@Composable
private fun PayoutStatusView(
    ui: ScanBankPayoutViewModel.UiState,
    onDone: () -> Unit,
    onTryAgain: () -> Unit,
    onClose: () -> Unit,
) {
    val sending = ui.step == ScanBankPayoutViewModel.Step.Sending

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(520.dp)
            .navigationBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Spacer(Modifier.weight(1f))

        // Status icon.
        when {
            sending -> Box(Modifier.size(96.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    color = TaliseColors.greenMint,
                    strokeWidth = 3.5.dp,
                    modifier = Modifier.size(64.dp),
                )
            }
            ui.finalStatus == "completed" -> Box(
                Modifier
                    .size(96.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.greenMint.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (ui.paidOut) Icons.Filled.Verified else Icons.Filled.AccessTimeFilled,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(if (ui.paidOut) 56.dp else 50.dp),
                )
            }
            else -> Box(
                Modifier
                    .size(96.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.danger.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Warning, contentDescription = null, tint = TaliseColors.danger, modifier = Modifier.size(52.dp))
            }
        }

        Text(
            when {
                sending -> "Paying the bank…"
                ui.finalStatus == "failed" -> "Payment failed"
                ui.paidOut -> "Paid out"
                else -> "On its way"
            },
            style = TaliseType.heading(24.sp, FontWeight.Medium),
            letterSpacing = (-0.5).sp,
            color = TaliseColors.fg,
        )
        Text(
            ui.statusText,
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 30.dp),
        )

        Spacer(Modifier.weight(1f))

        if (ui.step == ScanBankPayoutViewModel.Step.Done) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (ui.finalStatus == "failed") {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .clip(CircleShape)
                            .background(TaliseColors.fg)
                            .clickable { onTryAgain() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Try again",
                            style = TaliseType.heading(16.sp, FontWeight.Medium),
                            color = TaliseColors.bg,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) { onClose() }
                            .padding(4.dp),
                    ) {
                        Text("Close", style = TaliseType.body(14.sp), color = TaliseColors.fgMuted)
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .clip(CircleShape)
                            .background(TaliseColors.fg)
                            .clickable { onDone() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Done",
                            style = TaliseType.heading(16.sp, FontWeight.Medium),
                            color = TaliseColors.bg,
                        )
                    }
                }
            }
        }
    }
}

// MARK: - Manual-entry bank picker (scan path)

/**
 * Searchable bank list presented as a sheet for the "Type it in" path, ported
 * from iOS `ScanBankPickerSheet` over [ScanBank.all].
 */
@Composable
fun ScanBankPickerSheet(
    selected: ScanBank?,
    onSelect: (ScanBank) -> Unit,
    onClose: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val filtered = remember(query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) {
            ScanBank.all
        } else {
            ScanBank.all.filter { bank ->
                bank.name.lowercase().contains(q) || bank.aliases.any { it.contains(q) }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.92f)
            .background(TaliseColors.bg),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 18.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Select bank",
                style = TaliseType.heading(18.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
            Spacer(Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2)
                    .clickable { onClose() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = null, tint = TaliseColors.fg, modifier = Modifier.size(12.dp))
            }
        }

        // Search field.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 8.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(TaliseColors.surface)
                .border(1.dp, TaliseColors.line, RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Filled.Search, contentDescription = null, tint = TaliseColors.fgMuted, modifier = Modifier.size(13.dp))
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) {
                    Text("Search banks", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                }
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = TextStyle(
                        fontFamily = TaliseType.sansFamily,
                        fontSize = 15.sp,
                        color = TaliseColors.fg,
                    ),
                    cursorBrush = SolidColor(TaliseColors.greenMint),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        LazyColumn(modifier = Modifier.fillMaxWidth()) {
            items(filtered, key = { it.code }) { bank ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(bank) }
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ScanBankAvatar(bankCode = bank.code, bankName = bank.name, size = 36.dp, cornerRadius = 10.dp)
                    Text(bank.name, style = TaliseType.body(15.sp), color = TaliseColors.fg)
                    Spacer(Modifier.weight(1f))
                    if (bank.code == selected?.code) {
                        Icon(Icons.Filled.Check, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(14.dp))
                    }
                }
            }
        }
    }
}

// MARK: - Helpers

/** "****1234" masked account tail, iOS `maskAccount`. */
private fun maskAccount(a: String): String =
    if (a.length <= 4) "****" else "****${a.takeLast(4)}"
