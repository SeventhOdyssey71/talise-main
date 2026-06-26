package io.talise.app.core.session

import io.talise.app.core.model.UserDTO
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Global session state machine — mirrors iOS `AppSession.Phase`.
 *   launching → signedOut → onboarding(user) → ready(user)
 * The phase router ([TaliseRoot]) renders off [phase]; this also listens for
 * [TaliseEvents.Event.SessionExpired] to drop to `signedOut`.
 */
object AppSession {
    sealed interface Phase {
        data object Launching : Phase
        data object SignedOut : Phase
        data class Onboarding(val user: UserDTO) : Phase
        data class Ready(val user: UserDTO) : Phase
    }

    private val scope = CoroutineScope(SupervisorJob())
    private val _phase = MutableStateFlow<Phase>(Phase.Launching)
    val phase: StateFlow<Phase> = _phase.asStateFlow()

    val currentUser: UserDTO?
        get() = when (val p = _phase.value) {
            is Phase.Onboarding -> p.user
            is Phase.Ready -> p.user
            else -> null
        }

    init {
        scope.launch {
            TaliseEvents.events.collect { if (it is TaliseEvents.Event.SessionExpired) signOut() }
        }
    }

    /**
     * Cold-start policy mirrors iOS: we do NOT silently restore a session on launch.
     * (Phase 1 may relax this to validate the stored bearer with `/api/me`.)
     */
    fun bootstrap() {
        _phase.value = Phase.SignedOut
    }

    fun handleSignedIn(user: UserDTO) {
        _phase.value = if (user.accountType.isNullOrBlank()) Phase.Onboarding(user) else Phase.Ready(user)
    }

    /** Mark onboarding complete (handle claimed / tier chosen) → enter the app. */
    fun completeOnboarding(user: UserDTO) {
        _phase.value = Phase.Ready(user)
    }

    fun signOut() {
        SecureStore.clear()
        _phase.value = Phase.SignedOut
    }
}
