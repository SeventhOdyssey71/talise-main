package io.talise.app.feature.scan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.model.RecipientResolution
import io.talise.app.core.net.ApiClient
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * State + routing for the Scan-to-Pay surface, mirroring the `@State` set of
 * iOS `ScanToPayView` one for one (cameraState, mode, flash, unrecognized pill,
 * didRoute latch, resumeToken, resolving/scanned beats, pendingPayment,
 * pendingBank, OCR debounce, manual entry).
 */
class ScanViewModel : ViewModel() {

    /** Camera authorization gate. Drives which surface we paint. */
    enum class CameraState {
        /** Resolving permission / requesting. */
        Checking,

        /** Authorized + camera present → live preview. */
        Scanning,

        /** Denied → Settings prompt. */
        Denied,

        /** No capture device (emulator, no back camera). */
        Unavailable,
    }

    /** Top toggle: scan with the camera vs. type a bank account by hand. */
    enum class Mode { Scan, Manual }

    /** A resolved scan ready to confirm, drives the ConfirmPaymentSheet. */
    data class PendingPayment(val recipient: RecipientResolution, val amount: Double?)

    /** A detected/entered bank account ready to pay out, drives ScanBankPayoutSheet. */
    data class PendingBankPayout(val bank: ScanBank, val accountNumber: String)

    data class UiState(
        val cameraState: CameraState = CameraState.Checking,
        val mode: Mode = Mode.Scan,
        val flashOn: Boolean = false,
        /** Hides the flash toggle when the device has no torch. */
        val hasTorch: Boolean = false,
        /** Brief "Not a Talise payment code" pill, auto-dismissed. */
        val showUnrecognized: Boolean = false,
        /** True while we resolve the scanned recipient, drives the "Finding who to pay…" veil. */
        val resolving: Boolean = false,
        /** Brief "Scanned successfully" interstitial between a locked scan and the sheet. */
        val scanned: Boolean = false,
        /** Bumped to re-arm the capture layer's debounce so the next code is read. */
        val resumeToken: Int = 0,
        val pendingPayment: PendingPayment? = null,
        val pendingBank: PendingBankPayout? = null,
        val balance: BalancesDTO? = null,
        // Manual entry.
        val manualBank: ScanBank? = null,
        val manualAccount: String = "",
        val showBankPicker: Boolean = false,
    ) {
        val manualReady: Boolean get() = manualBank != null && manualAccount.length == 10
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Latches once we've handed a valid scan off so a second frame can't double-route. */
    private var didRoute = false

    /**
     * OCR lock debounce. We require the SAME {bank, account} candidate on a few
     * consecutive frames before routing, so a half-read placard doesn't fire a
     * wrong account at the off-ramp.
     */
    private var ocrCandidate: BankAccountExtractor.Candidate? = null
    private var ocrStreak = 0
    private val ocrLockThreshold = 2

    private var unrecognizedJob: Job? = null

    init {
        loadBalance()
    }

    // MARK: - Data

    private fun loadBalance() {
        viewModelScope.launch {
            runCatching { ApiClient.api.balances() }
                .onSuccess { b -> _state.update { it.copy(balance = b) } }
            // Failure is silent, the pill falls back to "$0.00" which is the
            // design's empty state anyway.
        }
    }

    // MARK: - Camera gate

    fun onPermissionGranted() {
        _state.update { it.copy(cameraState = CameraState.Scanning) }
    }

    fun onPermissionDenied() {
        _state.update { it.copy(cameraState = CameraState.Denied) }
    }

    /** The capture layer resolved availability after we optimistically entered scanning. */
    fun onCameraAvailability(available: Boolean) {
        if (!available) _state.update { it.copy(cameraState = CameraState.Unavailable) }
    }

    fun onTorchAvailability(hasTorch: Boolean) {
        _state.update { it.copy(hasTorch = hasTorch) }
    }

    fun toggleFlash() {
        _state.update { it.copy(flashOn = !it.flashOn) }
    }

    fun setMode(mode: Mode) {
        _state.update {
            // Switching to manual stops feeding the camera and kills the torch.
            if (mode == Mode.Manual) it.copy(mode = mode, flashOn = false) else it.copy(mode = mode)
        }
    }

    // MARK: - Manual entry

    fun setManualBank(bank: ScanBank) {
        _state.update { it.copy(manualBank = bank) }
    }

    fun setManualAccount(value: String) {
        val trimmed = value.filter { it.isDigit() }.take(10)
        _state.update { it.copy(manualAccount = trimmed) }
    }

    fun setShowBankPicker(show: Boolean) {
        _state.update { it.copy(showBankPicker = show) }
    }

    /** Route the manually-entered bank + account to the payout sheet. */
    fun routeManual() {
        val s = _state.value
        val bank = s.manualBank ?: return
        if (s.manualAccount.length != 10) return
        _state.update { it.copy(pendingBank = PendingBankPayout(bank, s.manualAccount)) }
    }

    // MARK: - Re-arm

    /**
     * After the bank sheet is dismissed without paying out, re-arm the
     * scanner + clear the OCR debounce so a fresh placard can lock.
     */
    fun rearmAfterBank() {
        didRoute = false
        ocrCandidate = null
        ocrStreak = 0
        _state.update { it.copy(pendingBank = null, resumeToken = it.resumeToken + 1) }
    }

    /**
     * After the confirm sheet is dismissed WITHOUT a completed payment (the
     * user tapped Cancel or swiped down), re-arm the scanner so they can
     * scan again instead of staring at a latched viewfinder.
     */
    fun rearmAfterConfirm() {
        didRoute = false
        ocrCandidate = null
        ocrStreak = 0
        _state.update { it.copy(pendingPayment = null, resumeToken = it.resumeToken + 1) }
    }

    // MARK: - Scan routing

    /**
     * Called once per detected QR (the capture layer debounces). Valid codes
     * resolve the recipient to a display identity and present the confirm
     * sheet; unrecognized codes flash a pill and keep scanning.
     */
    fun handleScan(raw: String) {
        if (didRoute) return

        val parsed = ScanPayload.parse(raw)
        if (parsed == null) {
            // Unrecognized code, flash the pill (auto-dismisses) and re-arm
            // the scanner so the next code is read. We deliberately do NOT
            // set didRoute.
            flashUnrecognized()
            _state.update { it.copy(resumeToken = it.resumeToken + 1) }
            return
        }

        // Latch so a second frame can't double-route while we resolve.
        didRoute = true
        _state.update { it.copy(resolving = true) }
        viewModelScope.launch { resolveAndPresent(parsed) }
    }

    /**
     * Called per processed frame with the recognized OCR strings. We extract a
     * {bank, 10-digit account} candidate and debounce: the SAME candidate must
     * appear on `ocrLockThreshold + 1` consecutive frames before we lock +
     * present the payout sheet.
     */
    fun handleOcr(strings: List<String>) {
        val s = _state.value
        if (didRoute || s.mode != Mode.Scan || s.pendingPayment != null || s.pendingBank != null) return
        val candidate = BankAccountExtractor.extract(strings) ?: return
        if (candidate == ocrCandidate) {
            ocrStreak += 1
        } else {
            ocrCandidate = candidate
            ocrStreak = 0
        }
        if (ocrStreak < ocrLockThreshold) return

        // Locked, route to the off-ramp via the success beat. Latch so QR
        // frames + further OCR can't double-route.
        didRoute = true
        showScannedThen {
            _state.update { it.copy(pendingBank = PendingBankPayout(candidate.bank, candidate.accountNumber)) }
        }
    }

    /**
     * Resolve the scanned recipient token to a display identity, then present
     * the confirm sheet. Reuses the SAME resolution the Send flow uses: a bare
     * 0x address decodes locally; everything else (SuiNS names, Talise handles)
     * goes through `/api/recipient/resolve`. A resolution miss re-arms the
     * scanner with the "Not a Talise code" pill rather than presenting a
     * confirm sheet for an unroutable target.
     */
    private suspend fun resolveAndPresent(parsed: ScanPayload.Recipient) {
        // 1. Local address decode, no network hop for a bare 0x scan.
        ScanSuiAddress.normalize(parsed.recipient)?.let { addr ->
            val resolution = RecipientResolution(
                address = addr,
                displayName = ScanSuiAddress.short(addr),
                display = null,
                source = "address",
            )
            present(resolution, parsed.amount)
            return
        }

        // 2. SuiNS name / Talise handle → server resolver (same endpoint the
        //    Send flow hits).
        runCatching { ApiClient.api.resolveRecipient(parsed.recipient) }
            .onSuccess { resolution -> present(resolution, parsed.amount) }
            .onFailure { failResolve() }
    }

    /** Hand a resolved recipient to the confirm sheet, via the success beat. */
    private fun present(resolution: RecipientResolution, amount: Double?) {
        _state.update { it.copy(resolving = false) }
        showScannedThen {
            _state.update { it.copy(pendingPayment = PendingPayment(resolution, amount)) }
        }
    }

    /**
     * Resolution failed (no SuiNS / handle match, or network error). Drop the
     * resolving veil, flash the unrecognized pill, and re-arm scanning.
     */
    private fun failResolve() {
        didRoute = false
        _state.update { it.copy(resolving = false, resumeToken = it.resumeToken + 1) }
        flashUnrecognized()
    }

    /**
     * Show the "Scanned successfully" beat, then run [andThen] (presenting
     * whichever sheet the scan routed to). ~0.9s total: long enough to
     * register, short enough to keep the flow fast. One place so the QR and
     * bank-OCR paths feel identical.
     */
    private fun showScannedThen(andThen: () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(scanned = true) }
            delay(900)
            _state.update { it.copy(scanned = false) }
            // Let the veil fade before the sheet slides, no overlap jank.
            delay(150)
            andThen()
        }
    }

    /** Transient "not a Talise code" feedback, auto-dismissed after 1.6s. */
    private fun flashUnrecognized() {
        unrecognizedJob?.cancel()
        unrecognizedJob = viewModelScope.launch {
            _state.update { it.copy(showUnrecognized = true) }
            delay(1_600)
            _state.update { it.copy(showUnrecognized = false) }
        }
    }
}
