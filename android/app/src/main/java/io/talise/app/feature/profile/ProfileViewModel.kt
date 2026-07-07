package io.talise.app.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.AppSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Profile tab state — mirrors the `@State` set on iOS `ProfileView` 1:1:
 * rewards summary (stats strip), live KYC status (gated), account-deletion
 * in-flight flag + failure message.
 */
internal data class ProfileUiState(
    /** Fetched on appear so the stats strip can show Bronze/Silver/etc. Soft-fails to null. */
    val rewards: ProfileRewardsSummary? = null,
    /** Latest Bridge KYC status for the row chip + the stats-strip KYC cell. */
    val kyc: KycStatus? = null,
    val deletingAccount: Boolean = false,
    val deleteError: String? = null,
)

internal class ProfileViewModel : ViewModel() {
    private val _state = MutableStateFlow(ProfileUiState())
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    init {
        loadRewards()
        if (PROFILE_KYC_ENABLED) loadKyc()
    }

    fun loadRewards() {
        viewModelScope.launch {
            // Soft-fail — stats strip degrades to "Bronze" default.
            runCatching { profileApi.rewardsSummary() }
                .onSuccess { r -> _state.update { it.copy(rewards = r) } }
        }
    }

    /** Soft-fails (leaves `kyc` null → "Not verified") so the row always renders something. */
    fun loadKyc() {
        viewModelScope.launch {
            runCatching { profileApi.kycStatus() }
                .onSuccess { s -> _state.update { it.copy(kyc = KycStatus.from(s.status)) } }
        }
    }

    /** Re-fetch `/api/me` so a new handle / avatar shows immediately (iOS `session.bootstrap()`). */
    fun refreshUser() {
        viewModelScope.launch {
            runCatching { ApiClient.api.me() }.onSuccess { AppSession.handleSignedIn(it) }
        }
    }

    /**
     * POST /api/account/delete → server redacts the profile, releases the @handle mapping,
     * deletes linked bank accounts / push tokens, and revokes every mobile bearer. On success
     * we run the same local wipe as sign-out and land on the sign-in screen.
     */
    fun deleteAccount() {
        if (_state.value.deletingAccount) return
        _state.update { it.copy(deletingAccount = true) }
        viewModelScope.launch {
            try {
                val resp = profileApi.deleteAccount(EmptyBody())
                if (!resp.ok) {
                    _state.update {
                        it.copy(
                            deletingAccount = false,
                            deleteError = "The server couldn't delete your account. Please try again.",
                        )
                    }
                    return@launch
                }
                AppSession.signOut()
                _state.update { it.copy(deletingAccount = false) }
            } catch (t: Throwable) {
                if (httpCode(t) == 401) {
                    // Session already dead server-side — finish the sign-out so
                    // the user isn't stuck.
                    AppSession.signOut()
                    _state.update { it.copy(deletingAccount = false) }
                    return@launch
                }
                _state.update {
                    it.copy(
                        deletingAccount = false,
                        deleteError = "Couldn't reach Talise to delete your account. Check your connection and try again.",
                    )
                }
            }
        }
    }

    fun clearDeleteError() {
        _state.update { it.copy(deleteError = null) }
    }
}
