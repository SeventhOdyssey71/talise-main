package io.talise.app.feature.withdraw

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.session.TaliseEvents
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException

/**
 * Nigerian bank transfer, wired to the live Linq off-ramp. 1:1 state port of
 * iOS `BankWithdrawView`:
 *
 *   form (amount + bank + account, debounced name enquiry) → QUOTE → review
 *   (slide to confirm: create order → sign a USDsui transfer to Linq's deposit
 *   wallet on the sponsored rail) → POLL status until completed/failed.
 *
 * Android has no display-currency setting yet (iOS `CurrencySettings`), so the
 * amount field is always denominated in USDsui (the iOS non-NGN input path).
 */
class BankWithdrawViewModel : ViewModel() {

    enum class Step { Form, Review, Sending, Done }

    data class UiState(
        val step: Step = Step.Form,
        val amount: String = "",
        val accountNumber: String = "",
        val selectedBank: OfframpBank? = null,
        // Live display rate (1 USDsui = `rate` NGN) for the "≈ ₦X" estimate.
        val displayRate: Double? = null,
        // Inline account-name resolution.
        val resolving: Boolean = false,
        val resolvedName: String? = null,
        val resolveError: String? = null,
        val quoting: Boolean = false,
        val quote: LinqQuoteResp? = null,
        val confirming: Boolean = false,
        val statusText: String = "",
        val finalStatus: String? = null,   // completed | failed
        val paidOut: Boolean = false,
        val error: String? = null,
    ) {
        val amountValue: Double get() = amount.toDoubleOrNull() ?: 0.0

        /** The account must be NAME-RESOLVED before the user can move on. */
        val canContinue: Boolean
            get() = amountValue > 0 &&
                selectedBank != null &&
                accountNumber.length == 10 &&
                resolvedName != null &&
                resolveError == null &&
                !resolving

        val statusHeadline: String
            get() = when {
                step == Step.Sending -> "Paying your bank…"
                finalStatus == "failed" -> "Withdrawal failed"
                paidOut -> "Paid out"
                else -> "On its way"
            }
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val api = WithdrawRail.api
    private var resolveJob: Job? = null

    init {
        loadRate()
    }

    // ── Field input ────────────────────────────────────────────────────────

    fun onAmountChanged(raw: String) {
        // Decimal keypad semantics: digits plus at most one dot.
        var cleaned = raw.filter { it.isDigit() || it == '.' }
        val firstDot = cleaned.indexOf('.')
        if (firstDot >= 0) {
            cleaned = cleaned.substring(0, firstDot + 1) +
                cleaned.substring(firstDot + 1).replace(".", "")
        }
        _state.update { it.copy(amount = cleaned) }
    }

    fun onAccountChanged(raw: String) {
        val trimmed = raw.filter { it.isDigit() }.take(10)
        if (trimmed == _state.value.accountNumber) return
        _state.update { it.copy(accountNumber = trimmed) }
        scheduleResolve()
    }

    fun onBankSelected(bank: OfframpBank) {
        _state.update { it.copy(selectedBank = bank) }
        scheduleResolve()
    }

    /** "Edit" from review: back to the form, keeping the fields. */
    fun edit() {
        _state.update { it.copy(step = Step.Form, quote = null, error = null) }
    }

    /** "Try again" after a failed payout: back to review. */
    fun tryAgain() {
        _state.update { it.copy(step = Step.Review, error = null) }
    }

    // ── Networking ─────────────────────────────────────────────────────────

    /** Load the public display rate for the live "≈ ₦X" estimate. Silent on failure. */
    private fun loadRate() {
        if (_state.value.displayRate != null) return
        viewModelScope.launch {
            runCatching { api.linqRate() }.onSuccess { r ->
                _state.update { it.copy(displayRate = r.rate) }
            }
            // display-only — ignore failures
        }
    }

    /**
     * Debounce (~0.4s) then resolve the account name whenever the bank or
     * account number changes. Cancels any in-flight resolve first so only the
     * latest (bank, account) pair is name-enquired.
     */
    private fun scheduleResolve() {
        resolveJob?.cancel()
        // Clear stale state immediately so a changed field never shows a name
        // that belongs to the previous input.
        _state.update { it.copy(resolvedName = null, resolveError = null) }

        val s = _state.value
        val bank = s.selectedBank
        if (bank == null || s.accountNumber.length != 10) {
            _state.update { it.copy(resolving = false) }
            return
        }

        _state.update { it.copy(resolving = true) }
        val bankCode = bank.bankCode
        val account = s.accountNumber
        resolveJob = viewModelScope.launch {
            delay(400)
            resolveAccount(bankCode, account)
        }
    }

    private suspend fun resolveAccount(bankCode: String, accountNumber: String) {
        // Guard against a late response landing after the user edited the field.
        fun stillCurrent(): Boolean {
            val s = _state.value
            return s.accountNumber == accountNumber && s.selectedBank?.bankCode == bankCode
        }
        try {
            val r = api.linqResolve(LinqResolveRequest(bankCode = bankCode, accountNumber = accountNumber))
            if (!stillCurrent()) return
            _state.update { it.copy(resolvedName = r.accountName, resolveError = null, resolving = false) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            if (!stillCurrent()) return
            val msg = when {
                e.code() == 401 -> "Sign in to continue."
                e.code() == 422 -> "We couldn't verify that account. Check the number and bank."
                else -> friendlyOfframpError(e.code(), WithdrawRail.httpBody(e))
            }
            _state.update { it.copy(resolveError = msg, resolvedName = null, resolving = false) }
        } catch (e: Exception) {
            if (!stillCurrent()) return
            _state.update {
                it.copy(resolveError = "Couldn't check that account right now.", resolvedName = null, resolving = false)
            }
        }
    }

    fun getQuote() {
        val s = _state.value
        if (!s.canContinue || s.quoting) return
        val bank = s.selectedBank ?: return
        _state.update { it.copy(quoting = true, error = null) }
        viewModelScope.launch {
            try {
                val q = api.linqQuote(
                    LinqQuoteRequest(
                        amountUsdsui = s.amountValue,
                        bankCode = bank.bankCode,
                        accountNumber = s.accountNumber,
                    ),
                )
                _state.update { it.copy(quote = q, step = Step.Review, quoting = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: HttpException) {
                _state.update {
                    it.copy(error = friendlyOfframpError(e.code(), WithdrawRail.httpBody(e)), quoting = false)
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = "Couldn't get a quote right now.", quoting = false) }
            }
        }
    }

    /** Slide-to-confirm: create the Linq order, fund its deposit wallet, poll. */
    suspend fun confirm() {
        val s = _state.value
        val q = s.quote ?: return
        val bank = s.selectedBank ?: return
        _state.update { it.copy(confirming = true, error = null) }
        try {
            // 1. Create the Linq order — returns the deposit wallet to fund.
            val order = api.linqCreate(
                LinqCreateRequest(
                    amountUsdsui = q.amountUsdsui,
                    bankCode = bank.bankCode,
                    accountNumber = s.accountNumber,
                    accountName = q.accountName,
                    bankName = q.bankName.ifEmpty { bank.name },
                ),
            )

            // 2. Send exactly the quoted USDsui to Linq's deposit wallet on the
            //    sponsored/gasless rail — fee-free to the user.
            val digest = WithdrawRail.signAndSubmitSend(
                to = order.walletAddress,
                amountUsd = order.amountUsdsui,
            )
            TaliseEvents.emit(
                TaliseEvents.Event.TxCompleted(
                    digest = digest,
                    direction = "sent",
                    amountUsdsui = order.amountUsdsui,
                    counterpartyName = "Bank withdrawal",
                ),
            )

            val payee = q.accountName.ifEmpty { s.resolvedName ?: "your bank" }
            val statusText = if (order.amountNgn > 0) {
                "Sending ₦${ngnGrouped(order.amountNgn)} to $payee…"
            } else {
                "Sending the money to $payee…"
            }
            _state.update { it.copy(statusText = statusText, step = Step.Sending, confirming = false) }
            pollStatus(order.orderId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            val msg = if (e.code() == 401) "Please sign in again."
            else friendlyOfframpError(e.code(), WithdrawRail.httpBody(e))
            _state.update { it.copy(error = msg, confirming = false) }
        } catch (e: Exception) {
            _state.update {
                it.copy(error = e.message ?: "Couldn't complete the withdrawal right now.", confirming = false)
            }
        }
    }

    /**
     * Poll the Linq order until it completes or fails. GENEROUS window (~3 min):
     * only a real failed/reject ends this red; a timeout finishes on the
     * reassuring "On its way" (the payout completes server-side).
     */
    private suspend fun pollStatus(id: String) {
        for (i in 0 until 45) {
            try {
                val st = api.linqStatus(id)
                when (st.phase) {
                    "completed" -> {
                        _state.update {
                            it.copy(
                                finalStatus = "completed",
                                paidOut = true,
                                statusText = "₦${ngnGrouped(st.amountNgn)} has landed in the bank account.",
                                step = Step.Done,
                            )
                        }
                        return
                    }
                    "failed" -> {
                        _state.update {
                            it.copy(
                                finalStatus = "failed",
                                statusText = "The payout couldn't be completed. Your USDsui has been returned.",
                                step = Step.Done,
                            )
                        }
                        return
                    }
                    else -> Unit // initiated / processing — keep polling
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // transient — keep polling
            }
            // Poll quicker early (catch fast completions), then ease off to
            // stay well under the status route's rate limit.
            delay(if (i < 10) 3_000L else 5_000L)
        }
        // Still in flight after the window — NOT a failure.
        _state.update {
            it.copy(
                finalStatus = "completed",
                paidOut = false,
                statusText = "Your transfer is on its way. It can take a few minutes to land in the bank account.",
                step = Step.Done,
            )
        }
    }
}
