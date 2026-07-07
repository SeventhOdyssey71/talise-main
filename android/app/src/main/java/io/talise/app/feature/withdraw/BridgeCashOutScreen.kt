package io.talise.app.feature.withdraw

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.MonetizationOn
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import io.talise.app.feature.kyc.KycScreen
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Bridge CASH-OUT screen for a chosen corridor — the Android port of iOS
 * `BridgeCashOutView`. First-time users see a one-time bank-details form; once
 * a route exists it's "swap USDsui → USDC pocket, then Withdraw". The Bridge
 * address is abstracted away entirely.
 */
@Composable
fun BridgeCashOutScreen(
    corridor: RampCorridor,
    onBack: () -> Unit,
    vm: BridgeCashOutViewModel = viewModel(),
) {
    LaunchedEffect(corridor) { vm.start(corridor) }
    val state by vm.state.collectAsStateWithLifecycle()
    var showIdentity by remember { mutableStateOf(false) }

    // Identity verification — iOS presents IdentityVerificationView as a
    // sheet; re-check the route when it closes.
    if (showIdentity) {
        KycScreen(onClose = {
            showIdentity = false
            vm.recheck()
        })
        return
    }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        WithdrawTopBar(title = null, onBack = onBack)
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Header(corridor)
            when {
                state.checking -> LookupCard()
                !vm.supported -> UnsupportedCard(corridor)
                state.needsKyc -> VerifyCard(onVerify = { showIdentity = true })
                state.withdrawDone -> SuccessCard(corridor, vm.isEur)
                state.hasRoute -> {
                    PocketCard(state, vm)
                    SendCard(state, vm)
                }
                else -> {
                    SetupForm(corridor, state, vm)
                    state.setupError?.let {
                        Text(
                            it,
                            style = TaliseType.body(13.sp, FontWeight.Light),
                            color = TaliseColors.sentRedSoft,
                        )
                    }
                    SubmitButton(state, vm)
                }
            }
        }
    }
}

// ── Pieces ──────────────────────────────────────────────────────────────────

@Composable
private fun Header(corridor: RampCorridor) {
    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RoundedFlag(code = corridor.code, size = 46.dp)
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                "Cash out · ${corridor.name}",
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                letterSpacing = (-0.4).sp,
                color = TaliseColors.fg,
            )
            Text(
                "Pay out to your ${corridor.currencyCode} bank account.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
    }
}

@Composable
private fun LookupCard() {
    Row(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircularProgressIndicator(
            color = TaliseColors.greenMint,
            strokeWidth = 2.dp,
            modifier = Modifier.size(18.dp),
        )
        Text(
            "Checking your cash-out details…",
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

/** Identity-not-verified gate — routes straight into verification. */
@Composable
private fun VerifyCard(onVerify: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                Icons.Outlined.VerifiedUser,
                contentDescription = null,
                tint = TaliseColors.fg,
                modifier = Modifier.size(17.dp),
            )
            Text(
                "Verify your identity to cash out",
                style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                color = TaliseColors.fg,
            )
        }
        Text(
            "A quick one-time check unlocks bank cash-out. It takes a couple of minutes with our payments partner.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        Box(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(TaliseColors.greenMint, CircleShape)
                .clickable { onVerify() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "Verify identity",
                style = TaliseType.body(16.sp, FontWeight.SemiBold),
                color = TaliseColors.inkOnGreen,
            )
        }
    }
}

/** Step 1: USDC pocket — swap USDsui → USDC. */
@Composable
private fun PocketCard(state: BridgeCashOutViewModel.UiState, vm: BridgeCashOutViewModel) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    "USDC POCKET",
                    style = TaliseType.mono(10.sp),
                    letterSpacing = 1.sp,
                    color = TaliseColors.fgDim,
                )
                Text(
                    "${"%.2f".format(state.usdcPocket)} USDC",
                    style = TaliseType.heading(28.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
            }
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Filled.MonetizationOn,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(30.dp),
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
        Text(
            "Top up your pocket by swapping USDsui → USDC.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier
                    .weight(1f)
                    .height(46.dp)
                    .background(TaliseColors.surface2, RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                BasicTextField(
                    value = state.swapText,
                    onValueChange = vm::onSwapTextChanged,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TaliseType.body(16.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (state.swapText.isEmpty()) {
                            Text("0", style = TaliseType.body(16.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                        }
                        inner()
                    },
                )
                Text("USDsui", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
            }
            val canSwap = state.canSwap()
            Box(
                Modifier
                    .height(46.dp)
                    .background(if (canSwap) TaliseColors.greenMint else TaliseColors.surface2, CircleShape)
                    .clickable(enabled = canSwap) { vm.doSwapToUsdc() }
                    .alpha(if (canSwap) 1f else 0.6f)
                    .padding(horizontal = 22.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (state.swapping) {
                        CircularProgressIndicator(
                            color = TaliseColors.inkOnGreen,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                    Text(
                        if (state.swapping) "Swapping…" else "Swap",
                        style = TaliseType.body(15.sp, FontWeight.SemiBold),
                        color = TaliseColors.inkOnGreen,
                    )
                }
            }
        }
        Text(
            state.balanceUsdsui?.let { "${"%.2f".format(it)} USDsui available" } ?: "Loading…",
            style = TaliseType.body(11.5.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
        )
        state.swapError?.let {
            Text(it, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.sentRedSoft)
        }
    }
}

/** Step 2: send USDC → bank. */
@Composable
private fun SendCard(state: BridgeCashOutViewModel.UiState, vm: BridgeCashOutViewModel) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "WITHDRAW TO BANK",
                style = TaliseType.mono(10.sp),
                letterSpacing = 1.sp,
                color = TaliseColors.fgDim,
            )
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                BasicTextField(
                    value = state.amountText,
                    onValueChange = vm::onAmountTextChanged,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TaliseType.heading(44.sp, FontWeight.Medium)
                        .copy(color = TaliseColors.fg, textAlign = TextAlign.Center),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.width(IntrinsicSize.Min).widthIn(min = 40.dp),
                    decorationBox = { inner ->
                        if (state.amountText.isEmpty()) {
                            Text(
                                "0",
                                style = TaliseType.heading(44.sp, FontWeight.Medium),
                                color = TaliseColors.fgDim,
                            )
                        }
                        inner()
                    },
                )
                Text(
                    "USDC",
                    style = TaliseType.mono(13.sp),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            val over = state.sendAmount > state.usdcPocket
            val sendLine = when {
                over -> "Over your ${"%.2f".format(state.usdcPocket)} USDC pocket"
                state.sendAmount > 0 && state.sendAmount < BridgeCashOutViewModel.MIN_SEND -> "Minimum is $1.00"
                else -> "${"%.2f".format(state.usdcPocket)} USDC in pocket · min $1.00"
            }
            Text(
                sendLine,
                style = TaliseType.body(12.5.sp, FontWeight.Light),
                color = if (over) TaliseColors.sentRedSoft else TaliseColors.fgMuted,
            )
        }

        val b = state.payoutBank
        if (b?.bankName != null && b.accountLast4 != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(TaliseColors.surface2.copy(alpha = 0.6f), RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Filled.AccountBalance,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(14.dp),
                )
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        "Paying out to ${b.bankName} ••${b.accountLast4}",
                        style = TaliseType.body(13.5.sp),
                        color = TaliseColors.fg,
                    )
                    b.accountOwnerName?.let { owner ->
                        Text(
                            "$owner · ${(b.accountType ?: "").replaceFirstChar { it.uppercase() }} · ${b.destinationPaymentRail.uppercase()}",
                            style = TaliseType.mono(10.sp),
                            color = TaliseColors.fgDim,
                        )
                    }
                }
            }
        }

        state.withdrawError?.let {
            Text(
                it,
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.sentRedSoft,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        val canSend = state.canSend()
        Box(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(if (canSend) TaliseColors.greenMint else TaliseColors.surface2, CircleShape)
                .clickable(enabled = canSend) { vm.doSendUsdc() }
                .alpha(if (canSend) 1f else 0.6f),
            contentAlignment = Alignment.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.sending) {
                    CircularProgressIndicator(
                        color = TaliseColors.inkOnGreen,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                    )
                }
                Text(
                    if (state.sending) "Sending…" else "Withdraw",
                    style = TaliseType.body(16.sp, FontWeight.SemiBold),
                    color = TaliseColors.inkOnGreen,
                )
            }
        }

        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterHorizontally),
        ) {
            Icon(
                Icons.Outlined.AccountBalance,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(11.dp),
            )
            Text(
                if (vm.isEur) {
                    "Paid out by SEPA. Typically arrives within a business day."
                } else {
                    "Paid out by wire. Typically arrives within a business day."
                },
                style = TaliseType.mono(10.sp, FontWeight.Light),
                letterSpacing = 0.2.sp,
                color = TaliseColors.fgDim,
            )
        }
    }
}

@Composable
private fun SuccessCard(corridor: RampCorridor, isEur: Boolean) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(17.dp),
            )
            Text(
                "Withdrawal on its way",
                style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                color = TaliseColors.greenMint,
            )
        }
        Text(
            "Your USDC was sent for payout. The ${if (isEur) "SEPA" else "wire"} transfer to your ${corridor.currencyCode} bank typically arrives within a business day.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun UnsupportedCard(corridor: RampCorridor) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "Cash-out coming soon",
            style = TaliseType.heading(16.sp, FontWeight.SemiBold),
            color = TaliseColors.fg,
        )
        Text(
            "Direct bank cash-out for ${corridor.name} is on the way. USD is supported today.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

// ── One-time bank setup form ────────────────────────────────────────────────

@Composable
private fun SetupForm(
    corridor: RampCorridor,
    state: BridgeCashOutViewModel.UiState,
    vm: BridgeCashOutViewModel,
) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Add your ${corridor.currencyCode} bank",
            style = TaliseType.heading(15.sp, FontWeight.SemiBold),
            color = TaliseColors.fg,
        )
        Text(
            "One-time setup. After this you'll just enter an amount to withdraw.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        SetupField("Account holder name", state.ownerName, vm::onOwnerNameChanged)
        if (vm.isUsd) {
            SetupField("Account number", state.accountNumber, vm::onAccountNumberChanged, KeyboardType.Number)
            SetupField("Routing number", state.routingNumber, vm::onRoutingNumberChanged, KeyboardType.Number)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Savings account",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier.weight(1f),
                )
                Switch(
                    checked = state.savings,
                    onCheckedChange = vm::onSavingsChanged,
                    colors = SwitchDefaults.colors(
                        checkedTrackColor = TaliseColors.greenDeep,
                        checkedThumbColor = TaliseColors.fg,
                    ),
                )
            }
            SetupField("Street address", state.street, vm::onStreetChanged)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f)) { SetupField("City", state.city, vm::onCityChanged) }
                Box(Modifier.weight(1f)) { SetupField("State", state.state, vm::onStateChanged) }
            }
            SetupField("ZIP code", state.zip, vm::onZipChanged, KeyboardType.Number)
        } else if (vm.isEur) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f)) { SetupField("First name", state.firstName, vm::onFirstNameChanged) }
                Box(Modifier.weight(1f)) { SetupField("Last name", state.lastName, vm::onLastNameChanged) }
            }
            SetupField("IBAN", state.iban, vm::onIbanChanged)
            SetupField("BIC / SWIFT", state.bic, vm::onBicChanged)
        }
    }
}

@Composable
private fun SetupField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            label,
            style = TaliseType.mono(10.sp),
            letterSpacing = 0.4.sp,
            color = TaliseColors.fgDim,
        )
        Box(
            Modifier
                .fillMaxWidth()
                .height(44.dp)
                .background(TaliseColors.surface2, RoundedCornerShape(12.dp))
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun SubmitButton(state: BridgeCashOutViewModel.UiState, vm: BridgeCashOutViewModel) {
    val can = vm.canSubmitSetup() && !state.submitting
    Box(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .background(if (can) TaliseColors.greenMint else TaliseColors.surface2, CircleShape)
            .clickable(enabled = can) { vm.setupRoute() }
            .alpha(if (vm.canSubmitSetup()) 1f else 0.6f),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.submitting) {
                CircularProgressIndicator(
                    color = TaliseColors.inkOnGreen,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(16.dp),
                )
            }
            Text(
                if (state.submitting) "Setting up…" else "Save bank",
                style = TaliseType.body(15.sp, FontWeight.SemiBold),
                color = TaliseColors.inkOnGreen,
            )
        }
    }
}
