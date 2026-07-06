package io.talise.app.feature.send

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Send pipeline, the Android counterpart of the CLI's executeSend and iOS's
 * SendFlow: resolve the recipient, ask the server to build the gasless PTB
 * (`/api/send/sponsor-prepare`), sign the bytes LOCALLY with the ephemeral
 * zkLogin key ([ZkLoginCoordinator.signTransaction]), then broadcast via
 * `/api/send/gasless-submit`. Non-custodial: the key never leaves the device;
 * the server assembles the zkLogin proof from its stored JWT+salt.
 */
class SendViewModel : ViewModel() {

    sealed interface State {
        data object Idle : State
        data class Working(val step: String) : State
        data class Success(val digest: String, val amount: Double, val recipient: String) : State
        data class Error(val message: String) : State

        val suiscan: String? get() = (this as? Success)?.let { "https://suiscan.xyz/mainnet/tx/${it.digest}" }
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val addressRe = Regex("^0x[a-fA-F0-9]{64}$")

    fun reset() {
        _state.value = State.Idle
    }

    fun send(amount: Double, recipientInput: String) {
        if (amount <= 0 || recipientInput.isBlank()) return
        if (_state.value is State.Working) return
        _state.value = State.Working("resolving")

        viewModelScope.launch {
            runCatching {
                // 1. Resolve the recipient (verbatim) to a 0x address.
                val recipient = recipientInput.trim()
                val toAddress =
                    if (addressRe.matches(recipient)) recipient.lowercase()
                    else ApiClient.api.resolveRecipient(recipient).address.lowercase()

                // 2. Prepare, server builds the gasless PTB, returns signable bytes.
                _state.value = State.Working("preparing")
                val prep = ApiClient.api.sponsorPrepare(SponsorPrepareRequest(to = toAddress, amount = amount))
                val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the send")

                // 3. Sign the bytes locally with the ephemeral key (non-custodial).
                _state.value = State.Working("signing")
                val userSignature = ZkLoginCoordinator.signTransaction(bytes)
                val randomness = SecureStore.jwtRandomness ?: error("session needs a refresh, sign in again")

                // 4. Submit, server assembles the zkLogin proof and broadcasts.
                _state.value = State.Working("sending")
                val res = ApiClient.api.gaslessSubmit(
                    GaslessSubmitRequest(
                        bytesB64 = bytes,
                        ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                        maxEpoch = SecureStore.maxEpoch,
                        randomness = randomness,
                        userSignature = userSignature,
                        meta = SendMeta(kind = "send", amountUsd = amount),
                    ),
                )
                val digest = res.digest ?: error(res.error ?: "the send did not go through")
                Triple(digest, amount, recipient)
            }.onSuccess { (digest, amt, recipient) ->
                _state.value = State.Success(digest, amt, recipient)
                // Nudge Home to refresh balance + activity.
                TaliseEvents.emit(TaliseEvents.Event.TxCompleted(digest = digest, direction = "sent", amountUsdsui = amt))
            }.onFailure { t ->
                _state.value = State.Error(t.message ?: "send failed")
            }
        }
    }
}
