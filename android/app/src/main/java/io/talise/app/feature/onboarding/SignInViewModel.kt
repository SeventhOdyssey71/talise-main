package io.talise.app.feature.onboarding

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import io.talise.app.core.auth.GoogleSignInService
import io.talise.app.core.auth.ZkLoginCoordinator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Drives the native zkLogin sign-in: prepare (epoch → randomness → nonce) →
 * Google ID token (nonce-bound, via Credential Manager) → exchange for a bearer.
 * On success [io.talise.app.core.session.AppSession] advances and the root routes
 * away from this screen.
 */
class SignInViewModel : ViewModel() {
    data class UiState(val loading: Boolean = false, val error: String? = null)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun signInWithGoogle(context: Context) {
        if (_state.value.loading) return
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val prep = ZkLoginCoordinator.prepareGoogle()
                val idToken = GoogleSignInService.getIdToken(context, prep.nonce)
                ZkLoginCoordinator.exchangeGoogle(idToken, prep.maxEpoch, prep.randomness)
            }.onSuccess {
                // Remember this device has signed in at least once so the next visit
                // greets returning users with "Welcome back" (iOS `hasSignedInBeforeKey`).
                OnboardingPrefs.of(context)
                    .edit()
                    .putBoolean(OnboardingPrefs.KEY_HAS_SIGNED_IN_BEFORE, true)
                    .apply()
                _state.update { it.copy(loading = false) }
            }.onFailure { t ->
                // User dismissing the Google sheet isn't an error, just stop the spinner.
                if (t is GetCredentialCancellationException) {
                    _state.update { it.copy(loading = false, error = null) }
                } else {
                    _state.update { it.copy(loading = false, error = friendly(t)) }
                }
            }
        }
    }

    private fun friendly(t: Throwable): String = when (t) {
        is GoogleSignInService.NotConfigured ->
            "Sign-in isn't configured yet, set GOOGLE_WEB_CLIENT_ID."
        is NoCredentialException ->
            "No Google account available on this device. Add one in Settings and try again."
        else -> t.message ?: "Couldn't sign in. Please try again."
    }
}
