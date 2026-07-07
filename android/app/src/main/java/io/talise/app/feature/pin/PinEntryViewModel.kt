package io.talise.app.feature.pin

import io.talise.app.core.store.PinService

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.session.AppSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal const val PIN_LENGTH = 4

/**
 * State + handlers for [PinEntryScreen] — mirrors iOS `PinEntrySheet` +
 * `PinGate` 1:1.
 *
 * Two modes, resolved from stored state exactly like `PinGate.requireUserPresence`:
 *   - Create: no PIN yet for the signed-in user. Prompt for 4 digits, then
 *     prompt again to confirm. Matching pair -> persist via [PinService] -> success.
 *   - Verify: existing PIN. 4 digits match -> success; mismatch -> shake + clear.
 *     "Forgot PIN" clears the stored PIN and signs the user out (iOS
 *     `onForgot` -> `PinError.forgotSignOut`).
 */
class PinEntryViewModel(app: Application) : AndroidViewModel(app) {

    enum class Mode { Create, Verify }

    data class UiState(
        val mode: Mode,
        val entry: String = "",
        val firstPin: String? = null,
        val failureMessage: String? = null,
        val shakeTrigger: Int = 0,
    )

    sealed interface Event {
        data class Success(val pin: String) : Event
        data object ForgotSignOut : Event
    }

    private val userId: String = AppSession.currentUser?.id ?: ""

    private val _state = MutableStateFlow(
        UiState(
            mode = if (PinService.hasPin(app, userId)) Mode.Verify else Mode.Create,
        )
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 4)
    val events: SharedFlow<Event> = _events.asSharedFlow()

    fun tapDigit(d: String) {
        val current = _state.value
        if (current.entry.length >= PIN_LENGTH) return
        val entry = current.entry + d
        _state.update { it.copy(entry = entry, failureMessage = null) }
        if (entry.length == PIN_LENGTH) {
            // Defer one tick so the final dot animates in before the screen
            // either resolves or transitions to "confirm" (iOS: 120ms).
            viewModelScope.launch {
                delay(120)
                completeAttempt()
            }
        }
    }

    fun tapDelete() {
        val current = _state.value
        if (current.entry.isEmpty()) return
        _state.update { it.copy(entry = it.entry.dropLast(1), failureMessage = null) }
    }

    fun forgotPin() {
        PinService.clearPin(getApplication<Application>(), userId)
        AppSession.signOut()
        _events.tryEmit(Event.ForgotSignOut)
    }

    private fun completeAttempt() {
        val current = _state.value
        val pin = current.entry
        when (current.mode) {
            Mode.Verify -> {
                if (PinService.verifyPin(getApplication<Application>(), pin, userId)) {
                    _events.tryEmit(Event.Success(pin))
                } else {
                    failVerify()
                }
            }
            Mode.Create -> {
                val first = current.firstPin
                if (first != null) {
                    if (first == pin) {
                        try {
                            PinService.setPin(getApplication<Application>(), pin, userId)
                            _events.tryEmit(Event.Success(pin))
                        } catch (_: Exception) {
                            _state.update {
                                it.copy(
                                    entry = "",
                                    firstPin = null,
                                    failureMessage = "Couldn't save PIN. Try again.",
                                )
                            }
                        }
                    } else {
                        _state.update {
                            it.copy(
                                entry = "",
                                firstPin = null,
                                failureMessage = "PINs didn't match. Try again.",
                                shakeTrigger = it.shakeTrigger + 1,
                            )
                        }
                    }
                } else {
                    _state.update { it.copy(firstPin = pin, entry = "") }
                }
            }
        }
    }

    private fun failVerify() {
        _state.update {
            it.copy(
                entry = "",
                failureMessage = "Wrong PIN. Try again.",
                shakeTrigger = it.shakeTrigger + 1,
            )
        }
    }
}
