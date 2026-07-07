package io.talise.app.feature.scan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.RecipientResolution
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Pay pipeline for the scan confirm sheet. Reuses the EXACT proven gasless send
 * pattern from `feature/send/SendViewModel` (the recipient is already resolved
 * by the scanner, so the resolve step is skipped): `/api/send/sponsor-prepare`
 * → local zkLogin sign → `/api/send/gasless-submit`. Non-custodial: the
 * ephemeral key never leaves the device.
 */
class ConfirmPaymentViewModel : ViewModel() {

    /** A landed payment, drives the success celebration. */
    data class Success(val digest: String, val usdsui: Double)

    data class UiState(
        val balance: BalancesDTO? = null,
        val sending: Boolean = false,
        val errorMessage: String? = null,
        val success: Success? = null,
        /** Bumped after a failed attempt so the sheet springs the knob back. */
        val resetTick: Int = 0,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        loadBalance()
    }

    private fun loadBalance() {
        viewModelScope.launch {
            runCatching { ApiClient.api.balances() }
                .onSuccess { b -> _state.update { it.copy(balance = b) } }
            // Silent on failure: "Available $0.00" + the exceeds-balance guard
            // keep the slide disabled rather than letting an unfunded send through.
        }
    }

    fun pay(amountUsd: Double, recipient: RecipientResolution) {
        if (amountUsd <= 0 || _state.value.sending) return
        _state.update { it.copy(sending = true, errorMessage = null) }

        viewModelScope.launch {
            runCatching {
                // 1. Prepare, the server builds the gasless PTB and returns signable bytes.
                val prep = ApiClient.api.sponsorPrepare(
                    SponsorPrepareRequest(to = recipient.address.lowercase(), amount = amountUsd),
                )
                val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the send")

                // 2. Sign the bytes locally with the ephemeral key (non-custodial).
                val userSignature = ZkLoginCoordinator.signTransaction(bytes)
                val randomness = SecureStore.jwtRandomness
                    ?: error("session needs a refresh, sign in again")

                // 3. Submit, the server assembles the zkLogin proof and broadcasts.
                val res = ApiClient.api.gaslessSubmit(
                    GaslessSubmitRequest(
                        bytesB64 = bytes,
                        ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                        maxEpoch = SecureStore.maxEpoch,
                        randomness = randomness,
                        userSignature = userSignature,
                        meta = SendMeta(kind = "send", amountUsd = amountUsd),
                    ),
                )
                val digest = res.digest ?: error(res.error ?: "the send did not go through")
                // Defense in depth, an empty digest means it never landed.
                if (digest.isEmpty()) error("Payment didn't land on chain. No funds moved.")
                digest
            }.onSuccess { digest ->
                // Fire the canonical tx event so Home's optimistic-balance path
                // updates, identical to the Send flow's post.
                TaliseEvents.emit(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "sent",
                        amountUsdsui = amountUsd,
                        counterpartyName = recipient.displayName,
                    ),
                )
                _state.update { it.copy(sending = false, success = Success(digest, amountUsd)) }
            }.onFailure { t ->
                // Spring the knob back so the user can correct + retry without
                // re-scanning.
                _state.update {
                    it.copy(
                        sending = false,
                        errorMessage = t.message ?: "send failed",
                        resetTick = it.resetTick + 1,
                    )
                }
            }
        }
    }
}
