package io.talise.app.feature.scan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import java.text.NumberFormat
import java.util.Locale

/**
 * State + networking for the "Send to bank account" sheet, ported 1:1 from the
 * iOS `ScanBankPayoutSheet` logic: resolve the holder name → NGN amount + live
 * rate → quote → create → sign+send the EXACT returned USDsui → poll status.
 * Reuses the live Linq off-ramp endpoints verbatim (the same rail iOS's
 * BankWithdrawView runs) and the proven gasless send pipeline for the debit.
 */
class ScanBankPayoutViewModel : ViewModel() {

    enum class Step { Form, Review, Sending, Done }

    data class UiState(
        // Name enquiry.
        val resolving: Boolean = true,
        val resolvedName: String? = null,
        val resolveError: String? = null,
        // Rate (display only; the locked debit comes from quote/create).
        val displayRate: Double? = null,
        // Off-ramp execution.
        val step: Step = Step.Form,
        val quote: ScanQuoteResponse? = null,
        val quoting: Boolean = false,
        val confirming: Boolean = false,
        val statusText: String = "",
        /** "completed" | "failed", set once polling settles. */
        val finalStatus: String? = null,
        val paidOut: Boolean = false,
        val error: String? = null,
        /** Bumped after a failed attempt so the sheet springs the knob back. */
        val resetTick: Int = 0,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private lateinit var bank: ScanBank
    private lateinit var accountNumber: String
    private var started = false

    /** Kick off the name enquiry + display rate for this {bank, account}. */
    fun start(bank: ScanBank, accountNumber: String) {
        if (started) return
        started = true
        this.bank = bank
        this.accountNumber = accountNumber
        viewModelScope.launch { resolveAccount() }
        viewModelScope.launch { loadRate() }
    }

    // MARK: - Networking

    private suspend fun resolveAccount() {
        runCatching {
            ScanApi.offramp.resolve(ScanResolveRequest(bankCode = bank.code, accountNumber = accountNumber))
        }.onSuccess { r ->
            _state.update { it.copy(resolvedName = r.accountName, resolveError = null, resolving = false) }
        }.onFailure { t ->
            val message = when {
                (t as? HttpException)?.code() == 401 -> "Sign in to continue."
                t is HttpException && t.code() == 422 ->
                    "We couldn't verify that account. Check the number and bank."
                t is HttpException -> friendlyOfframpError(t.code(), httpBody(t))
                else -> "Couldn't check that account right now."
            }
            _state.update { it.copy(resolveError = message, resolving = false) }
        }
    }

    private suspend fun loadRate() {
        if (_state.value.displayRate != null) return
        runCatching { ScanApi.offramp.rate() }
            .onSuccess { r -> _state.update { it.copy(displayRate = r.rate) } }
        // Display-only, failures are silent.
    }

    fun getQuote(amountNgn: Double) {
        val s = _state.value
        val canContinue = amountNgn > 0 && s.resolvedName != null && s.resolveError == null &&
            !s.resolving && !s.quoting
        if (!canContinue) return
        _state.update { it.copy(quoting = true, error = null) }

        viewModelScope.launch {
            runCatching {
                ScanApi.offramp.quote(
                    ScanQuoteRequest(amountNgn = amountNgn, bankCode = bank.code, accountNumber = accountNumber),
                )
            }.onSuccess { q ->
                _state.update { it.copy(quoting = false, quote = q, step = Step.Review) }
            }.onFailure { t ->
                val message = if (t is HttpException) {
                    friendlyOfframpError(t.code(), httpBody(t))
                } else {
                    "Couldn't get a quote right now."
                }
                _state.update { it.copy(quoting = false, error = message) }
            }
        }
    }

    /** Back to the form to change the amount. */
    fun edit() {
        _state.update { it.copy(step = Step.Form, quote = null, error = null) }
    }

    /** After a failed payout, back to review for another attempt. */
    fun tryAgain() {
        _state.update { it.copy(step = Step.Review, error = null) }
    }

    fun confirm() {
        val q = _state.value.quote ?: return
        if (_state.value.confirming) return
        _state.update { it.copy(confirming = true, error = null) }

        viewModelScope.launch {
            try {
                // 1. Create the Linq order, send amountNgn (the exact credit) and
                //    trust the response's amountUsdsui as the EXACT amount to debit.
                val order = ScanApi.offramp.create(
                    ScanCreateRequest(
                        amountNgn = q.amountNgn,
                        bankCode = bank.code,
                        accountNumber = accountNumber,
                        accountName = q.accountName,
                        bankName = q.bankName.ifEmpty { bank.name },
                    ),
                )

                // 2. Send EXACTLY the returned USDsui to Linq's deposit wallet,
                //    over the proven gasless pipeline (sponsor-prepare → local
                //    zkLogin sign → gasless-submit).
                val prep = ApiClient.api.sponsorPrepare(
                    SponsorPrepareRequest(to = order.walletAddress.lowercase(), amount = order.amountUsdsui),
                )
                val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the send")
                val userSignature = ZkLoginCoordinator.signTransaction(bytes)
                val randomness = SecureStore.jwtRandomness
                    ?: error("session needs a refresh, sign in again")
                val res = ApiClient.api.gaslessSubmit(
                    GaslessSubmitRequest(
                        bytesB64 = bytes,
                        ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                        maxEpoch = SecureStore.maxEpoch,
                        randomness = randomness,
                        userSignature = userSignature,
                        meta = SendMeta(kind = "send", amountUsd = order.amountUsdsui),
                    ),
                )
                val digest = res.digest ?: error(res.error ?: "the send did not go through")
                if (digest.isEmpty()) {
                    _state.update {
                        it.copy(
                            confirming = false,
                            error = "Payment didn't land on chain. No funds moved.",
                            resetTick = it.resetTick + 1,
                        )
                    }
                    return@launch
                }

                TaliseEvents.emit(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "sent",
                        amountUsdsui = order.amountUsdsui,
                        counterpartyName = "Bank payout",
                    ),
                )

                _state.update {
                    it.copy(
                        confirming = false,
                        statusText = "Sending ₦${ngnGrouped(order.amountNgn)} to ${q.accountName}…",
                        step = Step.Sending,
                    )
                }
                pollStatus(order.orderId)
            } catch (t: Throwable) {
                val message = when {
                    (t as? HttpException)?.code() == 401 -> "Please sign in again."
                    t is HttpException -> friendlyOfframpError(t.code(), httpBody(t))
                    else -> t.message ?: "Couldn't complete the payment right now."
                }
                _state.update {
                    it.copy(confirming = false, error = message, resetTick = it.resetTick + 1)
                }
            }
        }
    }

    private suspend fun pollStatus(id: String) {
        repeat(20) {
            runCatching { ScanApi.offramp.status(id) }.onSuccess { s ->
                when (s.phase) {
                    "completed" -> {
                        _state.update {
                            it.copy(
                                finalStatus = "completed",
                                paidOut = true,
                                statusText = "₦${ngnGrouped(s.amountNgn)} has landed in the bank account.",
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
                }
            }
            delay(3_000)
        }
        _state.update {
            it.copy(
                finalStatus = "completed",
                paidOut = false,
                statusText = "Your transfer is on its way. It can take a few minutes to land in the bank account.",
                step = Step.Done,
            )
        }
    }

    // MARK: - Helpers

    private fun httpBody(e: HttpException): String? =
        runCatching { e.response()?.errorBody()?.string() }.getOrNull()

    /** Friendly off-ramp error copy, port of iOS `friendlyOfframpError`. */
    private fun friendlyOfframpError(code: Int, message: String?): String {
        val lower = (message ?: "").lowercase()
        if (code == 503 || lower.contains("not configured") || lower.contains("fx_unavailable")) {
            return "Bank payouts are rolling out, check back soon."
        }
        if (code == 422 && lower.contains("verify")) {
            return "We couldn't verify that bank account. Check the number and bank."
        }
        if (lower.contains("\"error\"")) {
            runCatching {
                ApiClient.json.parseToJsonElement(message!!).jsonObject["error"]?.jsonPrimitive?.content
            }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { return it }
        }
        if (code == 404) return "Bank payouts aren't available yet."
        if (!message.isNullOrEmpty() && message.length <= 120 &&
            !lower.contains("<html") && !lower.contains("<!doctype")
        ) {
            return message
        }
        return "Something went wrong. Please try again."
    }

    companion object {
        /** Grouped Naira figure, iOS `ngnGrouped` (2dp under 100, whole above). */
        fun ngnGrouped(v: Double): String {
            val fmt = NumberFormat.getNumberInstance(Locale.US)
            fmt.minimumFractionDigits = 0
            fmt.maximumFractionDigits = if (v < 100) 2 else 0
            return fmt.format(v)
        }
    }
}

private fun ngnGrouped(v: Double): String = ScanBankPayoutViewModel.ngnGrouped(v)
