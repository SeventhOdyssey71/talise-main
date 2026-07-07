package io.talise.app.feature.receive

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.model.UserDTO
import io.talise.app.core.session.AppSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * State for [ReceiveScreen] — mirrors iOS `ReceiveView`, which reads the user
 * from the session environment and keeps `amountText` / `copied` as view state.
 */
class ReceiveViewModel : ViewModel() {

    /** The signed-in user, present only in the ready phase (iOS `if case .ready`). */
    val user: StateFlow<UserDTO?> = AppSession.phase
        .map { (it as? AppSession.Phase.Ready)?.user }
        .stateIn(
            viewModelScope,
            SharingStarted.Eagerly,
            (AppSession.phase.value as? AppSession.Phase.Ready)?.user,
        )

    private val _amountText = MutableStateFlow("")
    val amountText: StateFlow<String> = _amountText.asStateFlow()

    private val _copied = MutableStateFlow(false)
    val copied: StateFlow<Boolean> = _copied.asStateFlow()

    fun onAmountChange(value: String) {
        _amountText.value = value
    }

    fun clearAmount() {
        _amountText.value = ""
    }

    /** Flip the copy button to "Copied" for 1.5s, mirroring iOS. */
    fun markCopied() {
        viewModelScope.launch {
            _copied.value = true
            delay(1_500)
            _copied.value = false
        }
    }
}
