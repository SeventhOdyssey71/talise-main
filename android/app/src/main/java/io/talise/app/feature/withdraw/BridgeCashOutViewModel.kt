package io.talise.app.feature.withdraw

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException

/**
 * Bridge CASH-OUT for a chosen corridor — 1:1 state port of iOS
 * `BridgeCashOutView`. The wallet holds USDsui; Bridge pays out from USDC, so:
 *
 *   Step 1 — swap USDsui → USDC into the "USDC pocket" (sponsored PTB, 1% fee).
 *   Step 2 — plain USDC send from the pocket to the Bridge cash-out address
 *            (resolved server-side; the address is never shown).
 *
 * First-time users (no payout route yet) see a one-time bank-details form;
 * identity must be Bridge-verified (KYC) before anything else.
 */
class BridgeCashOutViewModel : ViewModel() {

    data class UiState(
        val checking: Boolean = true,      // initial reuse-first lookup
        val needsKyc: Boolean = false,     // identity not verified yet → gate
        val hasRoute: Boolean = false,     // a payout route exists for this corridor
        val payoutBank: CashOutResp? = null,
        val balanceUsdsui: Double? = null,
        val usdcPocket: Double = 0.0,
        // Step 1 — swap USDsui → USDC into the pocket
        val swapText: String = "",
        val swapping: Boolean = false,
        val swapError: String? = null,
        // Step 2 — send USDC out to the bank
        val amountText: String = "",
        val sending: Boolean = false,
        val withdrawDone: Boolean = false,
        val withdrawError: String? = null,
        // One-time bank setup form (no route yet)
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
    ) {
        val swapAmount: Double get() = swapText.toDoubleOrNull() ?: 0.0
        val sendAmount: Double get() = amountText.toDoubleOrNull() ?: 0.0
        fun canSwap(): Boolean = swapAmount > 0 && swapAmount <= (balanceUsdsui ?: 0.0) && !swapping
        fun canSend(): Boolean = sendAmount >= MIN_SEND && sendAmount <= usdcPocket && !sending
    }

    companion object {
        /** Bridge won't pay out below $1.00 USDC. */
        const val MIN_SEND = 1.0
    }

    private var corridor: RampCorridor? = null

    val isEur: Boolean get() = corridor?.currencyCode == "EUR"
    val isUsd: Boolean get() = corridor?.currencyCode == "USD"
    val supported: Boolean get() = isUsd || isEur

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val api = WithdrawRail.api

    fun start(corridor: RampCorridor) {
        if (this.corridor != null) return
        this.corridor = corridor
        viewModelScope.launch { lookupExisting() }
    }

    fun canSubmitSetup(): Boolean {
        val s = _state.value
        if (s.ownerName.trim().isEmpty()) return false
        if (isUsd) {
            return s.accountNumber.length >= 4 && s.routingNumber.length >= 6 &&
                s.street.isNotEmpty() && s.city.isNotEmpty() && s.state.length >= 2 && s.zip.length >= 3
        }
        if (isEur) {
            return s.iban.length >= 10 && s.bic.length >= 6 && s.firstName.isNotEmpty() && s.lastName.isNotEmpty()
        }
        return false
    }

    // ── Field updates ──────────────────────────────────────────────────────

    fun onSwapTextChanged(v: String) = _state.update { it.copy(swapText = decimal(v)) }
    fun onAmountTextChanged(v: String) = _state.update { it.copy(amountText = decimal(v)) }
    fun onOwnerNameChanged(v: String) = _state.update { it.copy(ownerName = v) }
    fun onAccountNumberChanged(v: String) = _state.update { it.copy(accountNumber = v.filter { c -> c.isDigit() }) }
    fun onRoutingNumberChanged(v: String) = _state.update { it.copy(routingNumber = v.filter { c -> c.isDigit() }) }
    fun onSavingsChanged(v: Boolean) = _state.update { it.copy(savings = v) }
    fun onStreetChanged(v: String) = _state.update { it.copy(street = v) }
    fun onCityChanged(v: String) = _state.update { it.copy(city = v) }
    fun onStateChanged(v: String) = _state.update { it.copy(state = v) }
    fun onZipChanged(v: String) = _state.update { it.copy(zip = v) }
    fun onIbanChanged(v: String) = _state.update { it.copy(iban = v) }
    fun onBicChanged(v: String) = _state.update { it.copy(bic = v) }
    fun onFirstNameChanged(v: String) = _state.update { it.copy(firstName = v) }
    fun onLastNameChanged(v: String) = _state.update { it.copy(lastName = v) }

    private fun decimal(raw: String): String {
        var cleaned = raw.filter { it.isDigit() || it == '.' }
        val firstDot = cleaned.indexOf('.')
        if (firstDot >= 0) {
            cleaned = cleaned.substring(0, firstDot + 1) + cleaned.substring(firstDot + 1).replace(".", "")
        }
        return cleaned
    }

    // ── Actions ────────────────────────────────────────────────────────────

    /** Re-check after the identity flow closes (mirrors iOS sheet onDismiss). */
    fun recheck() {
        _state.update { it.copy(checking = true) }
        viewModelScope.launch { lookupExisting() }
    }

    /**
     * Reuse-first: does a payout route already exist for this corridor? If so,
     * go straight to amount entry. Also loads the spendable USDsui balance.
     */
    private suspend fun lookupExisting() {
        if (!supported) {
            _state.update { it.copy(checking = false) }
            return
        }
        // Gate on identity verification first — cash-out needs an approved
        // Bridge customer.
        var needsKyc = _state.value.needsKyc
        runCatching { api.bridgeKycStatus() }.onSuccess { needsKyc = it.status != "approved" }
        if (needsKyc) {
            _state.update { it.copy(needsKyc = true, checking = false) }
            return
        }
        _state.update { it.copy(needsKyc = false) }
        val probe = probeRequest()
        runCatching { api.cashOutAddress(probe) }.onSuccess { res ->
            _state.update {
                it.copy(
                    hasRoute = true,
                    payoutBank = res,
                    usdcPocket = (res.usdcMicros?.toDoubleOrNull() ?: 0.0) / 1_000_000.0,
                )
            }
        }
        runCatching { ApiClient.api.balances() }.onSuccess { bal ->
            _state.update { it.copy(balanceUsdsui = bal.usdsui) }
        }
        _state.update { it.copy(checking = false) }
    }

    /** Re-read the route + USDC pocket balance (e.g. after a swap fills it). */
    private suspend fun refreshPocket() {
        runCatching { api.cashOutAddress(probeRequest()) }.onSuccess { res ->
            _state.update {
                it.copy(
                    payoutBank = res,
                    usdcPocket = (res.usdcMicros?.toDoubleOrNull() ?: 0.0) / 1_000_000.0,
                )
            }
        }
        runCatching { ApiClient.api.balances() }.onSuccess { bal ->
            _state.update { it.copy(balanceUsdsui = bal.usdsui) }
        }
    }

    private fun probeRequest(): CashOutRequest =
        if (isUsd) CashOutRequest(rail = "wire", currency = "usd", accountOwnerName = "")
        else CashOutRequest(rail = "sepa", currency = "eur", accountOwnerName = "")

    /** First-time bank registration → creates the persistent payout route. */
    fun setupRoute() {
        if (!canSubmitSetup() || _state.value.submitting) return
        _state.update { it.copy(submitting = true, setupError = null) }
        viewModelScope.launch {
            val s = _state.value
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
            try {
                api.cashOutAddress(req)
                if (_state.value.balanceUsdsui == null) {
                    runCatching { ApiClient.api.balances() }.onSuccess { bal ->
                        _state.update { it.copy(balanceUsdsui = bal.usdsui) }
                    }
                }
                _state.update { it.copy(hasRoute = true, submitting = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = errText(e)
                val setupError = when {
                    msg.contains("503") || msg.contains("disabled") ->
                        "Cash-out isn't switched on yet. Please try again soon."
                    msg.contains("KYC_NOT_APPROVED") || msg.contains("409") || msg.contains("CUSTOMER") -> {
                        _state.update { it.copy(needsKyc = true) }
                        "Verify your identity first, then cash out."
                    }
                    else -> "We couldn't save your bank. Check your details and try again."
                }
                _state.update { it.copy(setupError = setupError, submitting = false) }
            }
        }
    }

    /** Step 1 — swap USDsui → USDC into the pocket (1% fee), then refresh. */
    fun doSwapToUsdc() {
        if (!_state.value.canSwap()) return
        _state.update { it.copy(swapping = true, swapError = null) }
        viewModelScope.launch {
            val amount = _state.value.swapAmount
            try {
                val prep = api.swapToUsdcPrepare(SwapToUsdcRequest(amountUsdsui = amount))
                WithdrawRail.signAndExecuteRaw(
                    bytesB64 = prep.bytes,
                    meta = WithdrawMeta(kind = "swap", amountUsd = amount),
                )
                _state.update { it.copy(swapText = "", swapping = false) }
                refreshPocket()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(swapError = "Couldn't swap to USDC. Please try again.", swapping = false) }
            }
        }
    }

    /** Step 2 — plain USDC send from the pocket to the Bridge address. */
    fun doSendUsdc() {
        if (!_state.value.canSend()) return
        _state.update { it.copy(sending = true, withdrawError = null) }
        viewModelScope.launch {
            val amount = _state.value.sendAmount
            val currencyCode = corridor?.currencyCode?.lowercase() ?: return@launch
            try {
                val prep = api.sendUsdcPrepare(
                    SendUsdcRequest(amountUsdc = amount, currency = currencyCode),
                )
                WithdrawRail.signAndExecuteRaw(
                    bytesB64 = prep.bytes,
                    meta = WithdrawMeta(kind = "withdraw", amountUsd = amount),
                )
                _state.update { it.copy(withdrawDone = true, sending = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = errText(e)
                val err: String
                var hasRoute = _state.value.hasRoute
                when {
                    msg.contains("NO_ROUTE") -> {
                        err = "Set up your bank first, then withdraw."
                        hasRoute = false
                    }
                    msg.contains("BELOW_BRIDGE_MIN") ->
                        err = "Bridge's minimum is $1.00, send at least $1.00 in USDC."
                    msg.contains("INSUFFICIENT_USDC") ->
                        err = "Not enough USDC in your pocket. Swap USDsui → USDC first."
                    else -> err = "We couldn't complete your withdrawal. Please try again."
                }
                _state.update { it.copy(withdrawError = err, hasRoute = hasRoute, sending = false) }
            }
        }
    }

    private fun errText(e: Exception): String = when (e) {
        is HttpException -> "${e.code()} ${WithdrawRail.httpBody(e) ?: ""}"
        else -> e.message ?: ""
    }
}
