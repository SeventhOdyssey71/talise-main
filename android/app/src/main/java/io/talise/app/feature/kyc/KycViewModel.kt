package io.talise.app.feature.kyc

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.model.UserDTO
import io.talise.app.core.net.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException
import kotlin.random.Random

/**
 * iOS shows an optional "get paid in Naira" bank-link step for country == "NG"
 * after the onboarding post (`OnboardingBankLinkView`). Its add-flow
 * (`AddBankAccountView`: bank picker → /link/prepare → sign consent →
 * /link/confirm) has no Android port yet, so the step is gated off and Nigeria
 * bootstraps straight through like every other country. The screen itself is
 * ported ([OnboardingBankLink]); flip this once the bank flow lands.
 */
private const val BANK_LINK_STEP_AVAILABLE = false

/** Personal vs. business, iOS `AccountType`. */
enum class AccountType(val raw: String) {
    Personal("personal"),
    Business("business"),
}

/**
 * State + submit pipeline for the onboarding verify step, ported 1:1 from iOS
 * `KYCView`: POST /api/onboarding, then (Nigeria only) the optional bank-link
 * step, then the sponsored SuiNS handle claim before handing control back so
 * the session can bootstrap into the authenticated app.
 */
class KycViewModel : ViewModel() {

    data class UiState(
        val country: String = "NG",
        val accountType: AccountType = AccountType.Personal,
        val submitting: Boolean = false,
        val error: String? = null,
        val showBankLink: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val kycApi = ApiClient.create(KycService::class.java)

    fun selectCountry(code: String) {
        _state.update { it.copy(country = code) }
    }

    fun selectAccountType(type: AccountType) {
        _state.update { it.copy(accountType = type) }
    }

    fun submit(onFinished: () -> Unit) {
        if (_state.value.submitting) return
        _state.update { it.copy(submitting = true) }
        viewModelScope.launch {
            try {
                kycApi.onboarding(
                    OnboardRequest(
                        country = _state.value.country,
                        accountType = _state.value.accountType.raw,
                    ),
                )

                // Nigeria → offer the optional "get paid in Naira" bank-link
                // step before finishing. Every other country bootstraps straight
                // through, exactly as before.
                if (_state.value.country == "NG" && BANK_LINK_STEP_AVAILABLE) {
                    _state.update { it.copy(showBankLink = true) }
                    return@launch
                }
                finishOnboarding()
                onFinished()
            } catch (t: Throwable) {
                _state.update { it.copy(error = t.message ?: "Something went wrong") }
            } finally {
                _state.update { it.copy(submitting = false) }
            }
        }
    }

    /** iOS bank-link cover's `onContinue`: dismiss, then finish like the non-NG path. */
    fun continueFromBankLink(onFinished: () -> Unit) {
        _state.update { it.copy(showBankLink = false) }
        viewModelScope.launch {
            finishOnboarding()
            onFinished()
        }
    }

    /**
     * Claims the sponsored SuiNS handle. The talise.sui operator wallet signs +
     * pays gas, so the user is never asked to fund or sign this transaction.
     * Best-effort: if the handle is taken or the operator is misconfigured, we
     * still proceed to the dashboard (the user can claim later from settings).
     */
    private suspend fun finishOnboarding() {
        claimTaliseHandle()
    }

    /**
     * Derives a candidate handle from the user's Google name (falling back to
     * the email local-part), then POSTs /api/username/claim. On a collision
     * (HTTP 409), we append a 4-digit suffix and retry up to three times.
     */
    private suspend fun claimTaliseHandle() {
        val user = runCatching { ApiClient.api.me() }.getOrNull() ?: return
        val base = candidateHandle(user)
        if (base.isEmpty()) return

        var attempt = 0
        var handle = base
        while (attempt < 3) {
            try {
                kycApi.claimUsername(UsernameClaimRequest(username = handle))
                return
            } catch (e: HttpException) {
                if (e.code() == 409) {
                    // Taken — append a short numeric suffix and try again.
                    val suffix = Random.nextInt(100, 10000).toString()
                    handle = (base + suffix).take(20)
                    attempt += 1
                } else {
                    // Operator down / RPC flake — fail silently. User keeps
                    // the wallet, just no on-chain handle yet.
                    return
                }
            } catch (t: Throwable) {
                return
            }
        }
    }

    private fun candidateHandle(user: UserDTO): String {
        // Prefer first word of display name; fall back to the email local-part.
        // NEVER suggest from a hide-my-email relay address — Apple sign-in
        // users get `c7zh9mf9zz@privaterelay.appleid.com` shapes, and the
        // gibberish local-part autotyped into the field read as a bug (and
        // got CLAIMED on-chain by one tester). Empty is better than noise.
        val name = user.name?.trim().orEmpty()
        val email = user.email.orEmpty()
        val source = when {
            name.isNotEmpty() -> name.split(" ").first()
            !email.lowercase().endsWith("@privaterelay.appleid.com") && email.contains("@") ->
                email.substringBefore("@")
            else -> ""
        }
        // Normalize to what SuiNS accepts: [a-z0-9_] 3-20 chars.
        val normalized = source.lowercase().filter { it in "abcdefghijklmnopqrstuvwxyz0123456789_" }
        return normalized.take(20)
    }
}
