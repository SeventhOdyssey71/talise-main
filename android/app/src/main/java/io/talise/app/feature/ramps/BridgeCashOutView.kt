package io.talise.app.feature.ramps

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.MonetizationOn
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Bridge CASH-OUT screen for a chosen corridor, ported 1:1 from iOS
 * `BridgeCashOutView.swift`.
 *
 * The wallet holds USDsui; Bridge pays out from USDC, so cashing out is a
 * single Onara-sponsored PTB (swap USDsui->USDC, 1% fee to treasury, send the
 * rest to the user's Bridge address) built server-side. The Bridge address is
 * abstracted away entirely, the user just enters an amount and taps Withdraw.
 *
 * First-time users (no payout route yet) see a one-time bank-details form;
 * once a route exists, the screen is purely "enter amount -> Withdraw".
 */
class BridgeCashOutViewModel(private val corridor: RampCorridor) : ViewModel() {

    data class State(
        // -- Withdraw (route already exists) --
        val checking: Boolean = true,          // initial reuse-first lookup
        val needsKyc: Boolean = false,         // identity not verified yet -> gate
        val hasRoute: Boolean = false,         // a payout route exists for this corridor
        val payoutBank: CashOutResponse? = null, // destination bank + USDC pocket
        val balanceUsdsui: Double? = null,
        val usdcPocket: Double = 0.0,          // USDC pocket balance
        // Step 1 -- swap USDsui -> USDC into the pocket
        val swapText: String = "",
        val swapping: Boolean = false,
        val swapError: String? = null,
        // Step 2 -- send USDC out to the bank
        val amountText: String = "",
        val sending: Boolean = false,
        val withdrawDone: Boolean = false,
        val withdrawError: String? = null,
        // -- One-time bank setup form (no route yet) --
        val ownerName: String = "",
        val accountNumber: String = "",
        val routingNumber: String = "",
        val savings: Boolean = false,
        val street: String = "",
        val city: String = "",
        val state: String = "",
        val zip: String = "",
        // EUR / SEPA
        val iban: String = "",
        val bic: String = "",
        val firstName: String = "",
        val lastName: String = "",
        val submitting: Boolean = false,
        val setupError: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    val isEur: Boolean get() = corridor.currencyCode == "EUR"
    val isUsd: Boolean get() = corridor.currencyCode == "USD"
    val supported: Boolean get() = isUsd || isEur

    /** Bridge won't pay out below $1.00 USDC. */
    val minSend: Double = 1.0

    fun update(transform: (State) -> State) {
        _state.value = transform(_state.value)
    }

    init {
        lookupExisting()
    }

    private fun probe(): CashOutRequest = if (isUsd) {
        CashOutRequest(rail = "wire", currency = "usd", accountOwnerName = "")
    } else {
        CashOutRequest(rail = "sepa", currency = "eur", accountOwnerName = "")
    }

    /**
     * Reuse-first: does a payout route already exist for this corridor? If so,
     * go straight to the amount entry. Also loads the spendable USDsui balance.
     */
    fun lookupExisting() {
        if (!supported) {
            _state.value = _state.value.copy(checking = false)
            return
        }
        viewModelScope.launch {
            try {
                // Gate on identity verification first, cash-out needs an approved
                // Bridge customer. Avoids letting the user fill the bank form only
                // to be blocked server-side (409 KYC_NOT_APPROVED).
                val s = runCatching { RampsClient.api.kycStatus() }.getOrNull()
                if (s != null) {
                    val needsKyc = KYCStatus.from(s.status) != KYCStatus.Approved
                    _state.value = _state.value.copy(needsKyc = needsKyc)
                    if (needsKyc) return@launch
                }
                val res = runCatching { RampsClient.api.cashOutAddress(probe()) }.getOrNull()
                if (res != null) {
                    _state.value = _state.value.copy(
                        hasRoute = true,
                        payoutBank = res,
                        usdcPocket = (res.usdcMicros?.toDoubleOrNull() ?: 0.0) / 1_000_000,
                    )
                }
                val bal = runCatching { ApiClient.api.balances() }.getOrNull()
                _state.value = _state.value.copy(balanceUsdsui = bal?.usdsui)
            } finally {
                _state.value = _state.value.copy(checking = false)
            }
        }
    }

    /** Re-read the route + USDC pocket balance (e.g. after a swap fills it). */
    private suspend fun refreshPocket() {
        val res = runCatching { RampsClient.api.cashOutAddress(probe()) }.getOrNull()
        if (res != null) {
            _state.value = _state.value.copy(
                payoutBank = res,
                usdcPocket = (res.usdcMicros?.toDoubleOrNull() ?: 0.0) / 1_000_000,
            )
        }
        val bal = runCatching { ApiClient.api.balances() }.getOrNull()
        _state.value = _state.value.copy(balanceUsdsui = bal?.usdsui)
    }

    /**
     * First-time bank registration -> creates the persistent payout route, then
     * flips into the amount-entry withdraw UI (address never shown).
     */
    fun setupRoute() {
        val s = _state.value
        _state.value = s.copy(submitting = true, setupError = null)
        viewModelScope.launch {
            try {
                val req = if (isUsd) {
                    CashOutRequest(
                        rail = "wire", currency = "usd", accountOwnerName = s.ownerName,
                        accountNumber = s.accountNumber, routingNumber = s.routingNumber,
                        checkingOrSavings = if (s.savings) "savings" else "checking",
                        country = "USA",
                        street = s.street, city = s.city, state = s.state, postalCode = s.zip,
                    )
                } else {
                    CashOutRequest(
                        rail = "sepa", currency = "eur", accountOwnerName = s.ownerName,
                        firstName = s.firstName, lastName = s.lastName,
                        iban = s.iban, bic = s.bic, country = "DEU",
                    )
                }
                RampsClient.api.cashOutAddress(req)
                if (_state.value.balanceUsdsui == null) {
                    val bal = runCatching { ApiClient.api.balances() }.getOrNull()
                    _state.value = _state.value.copy(balanceUsdsui = bal?.usdsui)
                }
                _state.value = _state.value.copy(hasRoute = true, submitting = false)
            } catch (t: Throwable) {
                val msg = RampsClient.errorText(t)
                val next = when {
                    msg.contains("503") || msg.contains("disabled") ->
                        "Cash-out isn't switched on yet. Please try again soon."
                    msg.contains("KYC_NOT_APPROVED") || msg.contains("409") || msg.contains("CUSTOMER") -> {
                        _state.value = _state.value.copy(needsKyc = true)
                        "Verify your identity first, then cash out."
                    }
                    else -> "We couldn't save your bank. Check your details and try again."
                }
                _state.value = _state.value.copy(setupError = next, submitting = false)
            }
        }
    }

    /** Step 1 -- swap USDsui -> USDC into the pocket (1% fee), then refresh. */
    fun doSwapToUsdc() {
        val s = _state.value
        val swapAmount = s.swapText.toDoubleOrNull() ?: 0.0
        val canSwap = swapAmount > 0 && swapAmount <= (s.balanceUsdsui ?: 0.0) && !s.swapping
        if (!canSwap) return
        _state.value = s.copy(swapping = true, swapError = null)
        viewModelScope.launch {
            try {
                val prep = RampsClient.api.swapToUsdc(SwapToUsdcRequest(amountUsdsui = swapAmount))
                RampsClient.signAndExecuteRaw(
                    bytesB64 = prep.bytes,
                    meta = RampsTxMeta(kind = "swap", amountUsd = swapAmount),
                )
                _state.value = _state.value.copy(swapText = "")
                refreshPocket()
                _state.value = _state.value.copy(swapping = false)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(
                    swapError = "Couldn't swap to USDC. Please try again.",
                    swapping = false,
                )
            }
        }
    }

    /** Step 2 -- plain USDC send from the pocket to the Bridge address. */
    fun doSendUsdc() {
        val s = _state.value
        val sendAmount = s.amountText.toDoubleOrNull() ?: 0.0
        val canSend = sendAmount >= minSend && sendAmount <= s.usdcPocket && !s.sending
        if (!canSend) return
        _state.value = s.copy(sending = true, withdrawError = null)
        viewModelScope.launch {
            try {
                val prep = RampsClient.api.sendUsdc(
                    SendUsdcRequest(amountUsdc = sendAmount, currency = corridor.currencyCode.lowercase()),
                )
                RampsClient.signAndExecuteRaw(
                    bytesB64 = prep.bytes,
                    meta = RampsTxMeta(kind = "withdraw", amountUsd = sendAmount),
                )
                _state.value = _state.value.copy(withdrawDone = true, sending = false)
            } catch (t: Throwable) {
                val msg = RampsClient.errorText(t)
                val next = when {
                    msg.contains("NO_ROUTE") -> {
                        _state.value = _state.value.copy(hasRoute = false)
                        "Set up your bank first, then withdraw."
                    }
                    msg.contains("BELOW_BRIDGE_MIN") ->
                        "Bridge's minimum is $1.00, send at least $1.00 in USDC."
                    msg.contains("INSUFFICIENT_USDC") ->
                        "Not enough USDC in your pocket, swap USDsui → USDC first."
                    else -> "We couldn't complete your withdrawal. Please try again."
                }
                _state.value = _state.value.copy(withdrawError = next, sending = false)
            }
        }
    }
}

@Composable
fun BridgeCashOutView(
    corridor: RampCorridor,
    vm: BridgeCashOutViewModel = viewModel(key = "cashout-${corridor.code}") { BridgeCashOutViewModel(corridor) },
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var showIdentity by remember { mutableStateOf(false) }

    // The identity-verification "sheet"; dismissing re-runs the reuse-first
    // lookup (mirrors iOS `.sheet(onDismiss:)`).
    if (showIdentity) {
        Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                Text(
                    "Done",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    color = TaliseColors.accent,
                    modifier = Modifier.clickable {
                        showIdentity = false
                        vm.update { it.copy(checking = true) }
                        vm.lookupExisting()
                    },
                )
            }
            IdentityVerificationView()
        }
        return
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        // -- Header --
        Row(
            Modifier.padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            RoundedFlag(code = corridor.code, size = 46.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
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

        when {
            state.checking -> LoadingCard("Checking your cash-out details…")

            !vm.supported -> RampMessageCard(
                title = "Cash-out coming soon",
                body = "Direct bank cash-out for ${corridor.name} is on the way. USD is supported today.",
            )

            state.needsKyc -> VerifyGateCard(onVerify = { showIdentity = true })

            state.withdrawDone -> SuccessCard(isEur = vm.isEur, currencyCode = corridor.currencyCode)

            state.hasRoute -> {
                PocketCard(vm = vm, state = state)
                SendCard(vm = vm, state = state)
            }

            else -> {
                SetupForm(vm = vm, state = state, currencyCode = corridor.currencyCode)
                state.setupError?.let {
                    Text(it, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.sentRedSoft)
                }
                SubmitButton(vm = vm, state = state)
            }
        }
    }
}

// MARK: - Cards

/**
 * Identity-not-verified gate. Cash-out requires a verified Bridge customer;
 * rather than let the user fill the bank form and fail, we surface this and
 * route them straight into verification (also reachable from Profile).
 */
@Composable
private fun VerifyGateCard(onVerify: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                Icons.Outlined.VerifiedUser,
                contentDescription = null,
                tint = TaliseColors.fg,
                modifier = Modifier.size(16.dp),
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
            Text("Verify identity", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = Color.Black)
        }
    }
}

// -- Step 1: USDC pocket, swap USDsui -> USDC ---------------------------------
@Composable
private fun PocketCard(vm: BridgeCashOutViewModel, state: BridgeCashOutViewModel.State) {
    val swapAmount = state.swapText.toDoubleOrNull() ?: 0.0
    val canSwap = swapAmount > 0 && swapAmount <= (state.balanceUsdsui ?: 0.0) && !state.swapping

    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
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
            Icon(
                Icons.Filled.MonetizationOn,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(30.dp),
            )
        }
        HorizontalDivider(color = TaliseColors.line)
        Text(
            "Top up your pocket by swapping USDsui → USDC.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
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
                BasicTextField(
                    value = state.swapText,
                    onValueChange = { text -> vm.update { it.copy(swapText = text.filter { ch -> ch.isDigit() || ch == '.' }) } },
                    textStyle = TaliseType.body(16.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    cursorBrush = SolidColor(TaliseColors.greenMint),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (state.swapText.isEmpty()) {
                                Text("0", style = TaliseType.body(16.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                            }
                            inner()
                        }
                    },
                )
                Text("USDsui", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
            }
            Row(
                Modifier
                    .height(46.dp)
                    .background(
                        if (canSwap) TaliseColors.greenMint else TaliseColors.surface2,
                        CircleShape,
                    )
                    .clickable(enabled = canSwap) { vm.doSwapToUsdc() }
                    .padding(horizontal = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (state.swapping) {
                    CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
                }
                Text(
                    if (state.swapping) "Swapping…" else "Swap",
                    style = TaliseType.body(15.sp, FontWeight.SemiBold),
                    color = if (canSwap || state.swapping) Color.Black else TaliseColors.fgDim,
                )
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

// -- Step 2: send USDC -> bank -------------------------------------------------
@Composable
private fun SendCard(vm: BridgeCashOutViewModel, state: BridgeCashOutViewModel.State) {
    val sendAmount = state.amountText.toDoubleOrNull() ?: 0.0
    val canSend = sendAmount >= vm.minSend && sendAmount <= state.usdcPocket && !state.sending

    val sendLine = when {
        sendAmount > state.usdcPocket -> "Over your ${"%.2f".format(state.usdcPocket)} USDC pocket"
        sendAmount > 0 && sendAmount < vm.minSend -> "Minimum is $1.00"
        else -> "${"%.2f".format(state.usdcPocket)} USDC in pocket · min $1.00"
    }
    // USD -> Wire; EUR -> SEPA. Honest, non-committal timing language.
    val wireTimingText = if (vm.isEur) {
        "Paid out by SEPA, typically arrives within a business day."
    } else {
        "Paid out by wire, typically arrives within a business day."
    }

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
                    onValueChange = { text -> vm.update { it.copy(amountText = text.filter { ch -> ch.isDigit() || ch == '.' }) } },
                    textStyle = TaliseType.heading(44.sp, FontWeight.Medium)
                        .copy(color = TaliseColors.fg, textAlign = TextAlign.Center),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    cursorBrush = SolidColor(TaliseColors.greenMint),
                    modifier = Modifier.width(140.dp),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.Center) {
                            if (state.amountText.isEmpty()) {
                                Text("0", style = TaliseType.heading(44.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                            }
                            inner()
                        }
                    },
                )
                Text(
                    "USDC",
                    style = TaliseType.mono(13.sp),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            Text(
                sendLine,
                style = TaliseType.body(12.5.sp, FontWeight.Light),
                color = if (sendAmount > state.usdcPocket) TaliseColors.sentRedSoft else TaliseColors.fgMuted,
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
                    modifier = Modifier.size(12.dp),
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
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

        Row(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(if (canSend) TaliseColors.greenMint else TaliseColors.surface2, CircleShape)
                .clickable(enabled = canSend) { vm.doSendUsdc() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            if (state.sending) {
                CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            }
            Text(
                if (state.sending) "Sending…" else "Withdraw",
                style = TaliseType.body(16.sp, FontWeight.SemiBold),
                color = if (canSend || state.sending) Color.Black else TaliseColors.fgDim,
            )
        }

        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterHorizontally),
        ) {
            Icon(
                Icons.Filled.AccountBalance,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(10.dp),
            )
            Text(
                wireTimingText,
                style = TaliseType.mono(10.sp, FontWeight.Light),
                letterSpacing = 0.2.sp,
                color = TaliseColors.fgDim,
            )
        }
    }
}

@Composable
private fun SuccessCard(isEur: Boolean, currencyCode: String) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(16.dp),
            )
            Text(
                "Withdrawal on its way",
                style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                color = TaliseColors.greenMint,
            )
        }
        Text(
            "Your USDC was sent for payout. The ${if (isEur) "SEPA" else "wire"} transfer to your $currencyCode bank typically arrives within a business day.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

// -- One-time bank setup form ---------------------------------------------------
@Composable
private fun SetupForm(vm: BridgeCashOutViewModel, state: BridgeCashOutViewModel.State, currencyCode: String) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Add your $currencyCode bank",
            style = TaliseType.heading(15.sp, FontWeight.SemiBold),
            color = TaliseColors.fg,
        )
        Text(
            "One-time setup. After this you'll just enter an amount to withdraw.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        FormField("Account holder name", state.ownerName) { v -> vm.update { it.copy(ownerName = v) } }
        if (vm.isUsd) {
            FormField("Account number", state.accountNumber, KeyboardType.Number) { v -> vm.update { it.copy(accountNumber = v) } }
            FormField("Routing number", state.routingNumber, KeyboardType.Number) { v -> vm.update { it.copy(routingNumber = v) } }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Savings account",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier.weight(1f),
                )
                Switch(
                    checked = state.savings,
                    onCheckedChange = { v -> vm.update { it.copy(savings = v) } },
                    colors = SwitchDefaults.colors(
                        checkedTrackColor = TaliseColors.greenDeep,
                        checkedThumbColor = Color.White,
                    ),
                )
            }
            FormField("Street address", state.street) { v -> vm.update { it.copy(street = v) } }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f)) { FormField("City", state.city) { v -> vm.update { it.copy(city = v) } } }
                Box(Modifier.weight(1f)) { FormField("State", state.state) { v -> vm.update { it.copy(state = v) } } }
            }
            FormField("ZIP code", state.zip, KeyboardType.Ascii) { v -> vm.update { it.copy(zip = v) } }
        } else if (vm.isEur) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f)) { FormField("First name", state.firstName) { v -> vm.update { it.copy(firstName = v) } } }
                Box(Modifier.weight(1f)) { FormField("Last name", state.lastName) { v -> vm.update { it.copy(lastName = v) } } }
            }
            FormField("IBAN", state.iban) { v -> vm.update { it.copy(iban = v) } }
            FormField("BIC / SWIFT", state.bic) { v -> vm.update { it.copy(bic = v) } }
        }
    }
}

@Composable
private fun FormField(
    label: String,
    value: String,
    keyboard: KeyboardType = KeyboardType.Text,
    onValue: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
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
                onValueChange = onValue,
                textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                keyboardOptions = KeyboardOptions(keyboardType = keyboard),
                singleLine = true,
                cursorBrush = SolidColor(TaliseColors.greenMint),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun SubmitButton(vm: BridgeCashOutViewModel, state: BridgeCashOutViewModel.State) {
    val canSubmitSetup = run {
        if (state.ownerName.trim().isEmpty()) {
            false
        } else if (vm.isUsd) {
            state.accountNumber.length >= 4 && state.routingNumber.length >= 6 &&
                state.street.isNotEmpty() && state.city.isNotEmpty() &&
                state.state.length >= 2 && state.zip.length >= 3
        } else if (vm.isEur) {
            state.iban.length >= 10 && state.bic.length >= 6 &&
                state.firstName.isNotEmpty() && state.lastName.isNotEmpty()
        } else {
            false
        }
    }
    val enabled = canSubmitSetup && !state.submitting

    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .background(if (canSubmitSetup) TaliseColors.greenMint else TaliseColors.surface2, CircleShape)
            .clickable(enabled = enabled) { vm.setupRoute() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
    ) {
        if (state.submitting) {
            CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        }
        Text(
            if (state.submitting) "Setting up…" else "Save bank",
            style = TaliseType.body(15.sp, FontWeight.SemiBold),
            color = if (canSubmitSetup) Color.Black else TaliseColors.fgDim,
        )
    }
}
