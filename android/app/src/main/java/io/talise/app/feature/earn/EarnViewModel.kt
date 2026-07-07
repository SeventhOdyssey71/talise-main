package io.talise.app.feature.earn

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Invest tab pipeline — the Android counterpart of iOS `EarnView` +
 * `EarnManageSheet` state. Screen state (comparison / loading / error) and the
 * manage-sheet action state (depositing / withdrawing / error / success /
 * savedAmountText) mirror the SwiftUI `@State` set 1:1.
 *
 * Money movement is REAL and non-custodial:
 *   prepare (/api/earn/…/prepare → transactionKindB64)
 *   → sponsor (/api/zk/sponsor → sponsor-ready bytes)
 *   → sign LOCALLY with the ephemeral zkLogin key
 *   → execute (/api/zk/sponsor-execute → digest)
 */
class EarnViewModel : ViewModel() {

    // ── Screen state (iOS EarnView) ─────────────────────────────────────────

    private val _comparison = MutableStateFlow<EarnComparisonDTO?>(null)
    val comparison: StateFlow<EarnComparisonDTO?> = _comparison.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    // ── Manage-sheet state (iOS EarnManageSheet) ────────────────────────────

    private val _depositing = MutableStateFlow(false)
    val depositing: StateFlow<Boolean> = _depositing.asStateFlow()

    private val _withdrawing = MutableStateFlow(false)
    val withdrawing: StateFlow<Boolean> = _withdrawing.asStateFlow()

    private val _sheetError = MutableStateFlow<String?>(null)
    val sheetError: StateFlow<String?> = _sheetError.asStateFlow()

    /** Digest of the last successful deposit / withdraw (drives the banner). */
    private val _sheetSuccess = MutableStateFlow<String?>(null)
    val sheetSuccess: StateFlow<String?> = _sheetSuccess.asStateFlow()

    /**
     * Pre-formatted amount for the full-screen piggy success cover.
     * Non-nil presents it — mirrors iOS `savedAmountText`.
     */
    private val _savedAmountText = MutableStateFlow<String?>(null)
    val savedAmountText: StateFlow<String?> = _savedAmountText.asStateFlow()

    /**
     * Increments after a failed deposit so the sheet springs the
     * slide-to-confirm knob home (iOS `slideReset` binding).
     */
    private val _slideResetTick = MutableStateFlow(0)
    val slideResetTick: StateFlow<Int> = _slideResetTick.asStateFlow()

    /**
     * Flips true after a successful WITHDRAW so the sheet can give the user a
     * beat to see the success banner, then dismiss (iOS sleeps 1.2s → dismiss).
     */
    private val _withdrawDone = MutableStateFlow(false)
    val withdrawDone: StateFlow<Boolean> = _withdrawDone.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            try {
                _comparison.value = EarnBackend.api.comparison()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Refresh-during-refresh cancels aren't real failures; anything
                // else surfaces on the inline error label like iOS.
                _error.value = serverErrorMessage(e) ?: e.message
            } finally {
                _loading.value = false
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _refreshing.value = true
            try {
                _comparison.value = EarnBackend.api.comparison()
                _error.value = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _error.value = serverErrorMessage(e) ?: e.message
            } finally {
                _refreshing.value = false
            }
        }
    }

    /** Clear the sheet's action state when a new venue sheet opens / closes. */
    fun resetSheet() {
        _depositing.value = false
        _withdrawing.value = false
        _sheetError.value = null
        _sheetSuccess.value = null
        _withdrawDone.value = false
    }

    /** The piggy cover was dismissed — clear it and refresh the venue cards. */
    fun consumeSavedAmount() {
        _savedAmountText.value = null
        load()
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    /**
     * Supply into the venue — iOS `EarnManageSheet.deposit()`. Mirrors the
     * flow: prepare → sponsor → sign → execute → optimistic activity event →
     * full-screen piggy celebration.
     */
    fun deposit(venueCode: String, usd: Double) {
        if (usd <= 0 || _depositing.value) return
        viewModelScope.launch {
            _depositing.value = true
            _sheetError.value = null
            _sheetSuccess.value = null
            runCatching {
                val built = EarnBackend.api.supplyPrepare(SupplyPrepareBody(venueCode, usd))
                val kind = built.transactionKindB64
                    ?: error(built.error ?: "could not prepare the deposit")
                signAndSubmitKind(kind, ZkExecuteMeta(kind = "invest", amountUsd = usd, venue = venueCode))
            }.onSuccess { digest ->
                _sheetSuccess.value = digest
                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "invest",
                        amountUsdsui = usd,
                        venue = venueCode,
                    ),
                )
                // Full-screen piggy celebration — dismissing it closes the sheet.
                _savedAmountText.value = earnUsd2(usd)
                load()
            }.onFailure { t ->
                if (t is CancellationException) throw t
                _sheetError.value = serverErrorMessage(t) ?: t.message ?: "could not add to earnings"
                // Spring the slide-to-complete knob back so the user can retry
                // without reopening the sheet.
                _slideResetTick.value += 1
            }
            _depositing.value = false
        }
    }

    /**
     * Withdraw from the venue — iOS `EarnManageSheet.withdraw(all:)`. A null
     * [amountUsd] means "withdraw everything" (the backend treats a missing
     * amount as a full redemption).
     */
    fun withdraw(venueCode: String, amountUsd: Double?, suppliedSnapshot: Double) {
        if (_withdrawing.value) return
        viewModelScope.launch {
            _withdrawing.value = true
            _sheetError.value = null
            _sheetSuccess.value = null
            runCatching {
                val built = EarnBackend.api.withdrawPrepare(WithdrawPrepareBody(venueCode, amountUsd))
                val kind = built.transactionKindB64
                    ?: error(built.error ?: "could not prepare the withdrawal")
                val rewardsAmount = amountUsd ?: suppliedSnapshot
                signAndSubmitKind(kind, ZkExecuteMeta(kind = "withdraw", amountUsd = rewardsAmount, venue = venueCode))
            }.onSuccess { digest ->
                _sheetSuccess.value = digest
                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "withdraw",
                        amountUsdsui = amountUsd ?: suppliedSnapshot,
                        venue = venueCode,
                    ),
                )
                load()
                _withdrawDone.value = true
            }.onFailure { t ->
                if (t is CancellationException) throw t
                _sheetError.value = serverErrorMessage(t) ?: t.message ?: "could not withdraw right now"
            }
            _withdrawing.value = false
        }
    }

    /**
     * Withdraw ONLY the accrued yield, leaving the principal earning — iOS
     * `EarnManageSheet.withdrawEarned()`. No amount goes over the wire; the
     * server computes the exact earned USDsui at request time.
     */
    fun withdrawEarned(venueCode: String, earnedSnapshot: Double) {
        if (_withdrawing.value) return
        viewModelScope.launch {
            _withdrawing.value = true
            _sheetError.value = null
            _sheetSuccess.value = null
            runCatching {
                val built = EarnBackend.api.withdrawEarnedPrepare(WithdrawEarnedPrepareBody(venueCode))
                val kind = built.transactionKindB64
                    ?: error(built.error ?: "could not prepare the withdrawal")
                signAndSubmitKind(kind, ZkExecuteMeta(kind = "withdraw", amountUsd = earnedSnapshot, venue = venueCode))
            }.onSuccess { digest ->
                _sheetSuccess.value = digest
                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "withdraw",
                        amountUsdsui = earnedSnapshot,
                        venue = venueCode,
                    ),
                )
                load()
                _withdrawDone.value = true
            }.onFailure { t ->
                if (t is CancellationException) throw t
                _sheetError.value = serverErrorMessage(t) ?: t.message ?: "could not withdraw right now"
            }
            _withdrawing.value = false
        }
    }

    // ── Signing pipeline ────────────────────────────────────────────────────

    /**
     * Android port of iOS `ZkLoginCoordinator.signAndSubmit(transactionKindB64:)`:
     * sponsor the kind bytes (Onara as gas owner), sign the sponsored
     * TransactionData LOCALLY with the ephemeral zkLogin key, then execute.
     * A 401 (session rebind) is emitted app-wide by the OkHttp interceptor,
     * which routes to the clean re-auth path — same outcome as iOS's
     * `SessionError.rebindRequired → session.signOut()`.
     */
    private suspend fun signAndSubmitKind(kindB64: String, meta: ZkExecuteMeta): String {
        val sponsored = EarnBackend.api.sponsor(ZkSponsorBody(kindB64))
        val bytes = sponsored.bytes ?: error(sponsored.error ?: "could not sponsor the transaction")
        val userSignature = ZkLoginCoordinator.signTransaction(bytes)
        val randomness = SecureStore.jwtRandomness
            ?: error("Sign in again, your session needs a refresh.")
        val res = EarnBackend.api.sponsorExecute(
            ZkExecuteBody(
                bytesB64 = bytes,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = meta,
            ),
        )
        res.error?.let { error(it) }
        return res.digest?.takeIf { it.isNotEmpty() } ?: error("no digest in response")
    }
}
