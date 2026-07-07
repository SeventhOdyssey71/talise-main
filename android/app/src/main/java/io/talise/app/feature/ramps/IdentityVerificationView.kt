package io.talise.app.feature.ramps

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Identity verification (Bridge KYC), ported 1:1 from iOS
 * `IdentityVerificationView.swift` (Profile). Lives in the ramps package so the
 * cash-out gate is self-contained on Android.
 *
 * Flow:
 *   1. Load current status (GET /api/kyc/bridge/status).
 *   2. "Verify identity" -> POST /api/kyc/bridge/start, then open the hosted
 *      KYC + Terms-of-Service links in the browser.
 *   3. Poll status while it's in review; flip to a success state on approval.
 *
 * Verifying here unlocks USD/EUR cash-out, one Bridge customer covers both
 * directions. No PII flows through Talise; Bridge runs the whole flow.
 */
class IdentityVerificationViewModel : ViewModel() {

    data class State(
        val loading: Boolean = true,
        val working: Boolean = false,          // start() in flight
        val status: KYCStatus = KYCStatus.Unverified,
        val kycUrl: String? = null,
        val tosUrl: String? = null,
        val error: String? = null,
        val polling: Boolean = false,
        /** One-shot: a URL the screen should open, cleared after consumption. */
        val openUrl: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun consumeOpenUrl() {
        _state.value = _state.value.copy(openUrl = null)
    }

    private fun load() {
        viewModelScope.launch {
            try {
                val s = RampsClient.api.kycStatus()
                val status = KYCStatus.from(s.status)
                _state.value = _state.value.copy(status = status, loading = false)
                if (status.isInFlight) startPolling()
            } catch (t: Throwable) {
                val msg = RampsClient.errorText(t)
                if (msg.contains("503")) {
                    _state.value = _state.value.copy(
                        error = "Cash-out verification isn't switched on yet.",
                        loading = false,
                    )
                } else {
                    // Soft-fail to unverified; the action card lets them start.
                    _state.value = _state.value.copy(status = KYCStatus.Unverified, loading = false)
                }
            }
        }
    }

    /** Kick off (or re-fetch) the hosted KYC + ToS links and open them. */
    fun beginVerification() {
        if (_state.value.working) return
        _state.value = _state.value.copy(working = true, error = null)
        viewModelScope.launch {
            try {
                val r = RampsClient.api.kycStart(RampsEmptyBody())
                // Open the identity flow straight away; the ToS button stays
                // available below for the second step.
                _state.value = _state.value.copy(
                    status = KYCStatus.from(r.status),
                    kycUrl = r.kycUrl,
                    tosUrl = r.tosUrl,
                    openUrl = r.kycUrl ?: r.tosUrl,
                    working = false,
                )
                startPolling()
            } catch (t: Throwable) {
                val msg = RampsClient.errorText(t)
                val error = when {
                    msg.contains("503") -> "Cash-out verification isn't switched on yet. Please try again soon."
                    msg.contains("400") -> "Add an email to your account first, then verify your identity."
                    msg.contains("429") -> "Too many attempts, wait a moment and try again."
                    msg.contains("401") -> "Your session expired. Sign out and back in, then try again."
                    else -> "Couldn't start verification. Please try again."
                }
                _state.value = _state.value.copy(error = error, working = false)
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { RampsClient.api.kycStatus() }.onSuccess { s ->
                _state.value = _state.value.copy(status = KYCStatus.from(s.status))
            }
            // Keep current status on failure.
        }
    }

    /** Poll every 8s while verification is in review; stops on a terminal state
     *  or when the ViewModel is cleared. */
    private fun startPolling() {
        if (_state.value.polling) return
        _state.value = _state.value.copy(polling = true)
        viewModelScope.launch {
            try {
                repeat(60) {            // ~8 minutes max
                    delay(8_000)
                    val s = runCatching { RampsClient.api.kycStatus() }.getOrNull() ?: return@repeat
                    val status = KYCStatus.from(s.status)
                    _state.value = _state.value.copy(status = status)
                    if (status == KYCStatus.Approved || status == KYCStatus.Rejected) return@launch
                }
            } finally {
                _state.value = _state.value.copy(polling = false)
            }
        }
    }
}

@Composable
fun IdentityVerificationView(
    vm: IdentityVerificationViewModel = viewModel { IdentityVerificationViewModel() },
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val uriHandler = LocalUriHandler.current

    // One-shot open of the hosted flow when start() hands links back.
    LaunchedEffect(state.openUrl) {
        state.openUrl?.let { url ->
            uriHandler.openUri(url)
            vm.consumeOpenUrl()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        // -- Header --
        Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Identity verification",
                style = TaliseType.heading(22.sp, FontWeight.Medium),
                letterSpacing = (-0.4).sp,
                color = TaliseColors.fg,
            )
            Text(
                "A one-time check that unlocks cashing out to your bank. Your details go straight to our payments partner, Talise never stores them.",
                style = TaliseType.body(13.5.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        if (state.loading) {
            LoadingCard("Checking your status…")
        } else {
            StatusCard(status = state.status, polling = state.polling)
            when (state.status) {
                KYCStatus.Approved -> ApprovedCard()
                KYCStatus.Pending -> PendingCard(
                    kycUrl = state.kycUrl,
                    tosUrl = state.tosUrl,
                    onOpen = { uriHandler.openUri(it) },
                    onRefresh = { vm.refresh() },
                )
                KYCStatus.Rejected, KYCStatus.Expired -> ActionCard(
                    retry = true,
                    working = state.working,
                    kycUrl = state.kycUrl,
                    tosUrl = state.tosUrl,
                    onOpen = { uriHandler.openUri(it) },
                    onBegin = { vm.beginVerification() },
                )
                KYCStatus.Unverified -> ActionCard(
                    retry = false,
                    working = state.working,
                    kycUrl = state.kycUrl,
                    tosUrl = state.tosUrl,
                    onOpen = { uriHandler.openUri(it) },
                    onBegin = { vm.beginVerification() },
                )
            }
            state.error?.let {
                Text(
                    it,
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.sentRedSoft,
                )
            }
        }
    }
}

// MARK: - Sections

/** A status chip row, always shown once loaded. */
@Composable
private fun StatusCard(status: KYCStatus, polling: Boolean) {
    val (icon, tint) = statusIconTint(status)
    Row(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "STATUS",
                style = TaliseType.mono(10.sp),
                letterSpacing = 1.sp,
                color = TaliseColors.fgDim,
            )
            Text(
                status.label,
                style = TaliseType.heading(17.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
        }
        if (polling) {
            CircularProgressIndicator(
                color = TaliseColors.greenMint,
                strokeWidth = 2.dp,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

private fun statusIconTint(status: KYCStatus): Pair<ImageVector, Color> = when (status) {
    KYCStatus.Approved -> Icons.Filled.Verified to TaliseColors.greenMint
    KYCStatus.Pending -> Icons.Filled.Schedule to TaliseColors.fgMuted
    KYCStatus.Rejected, KYCStatus.Expired -> Icons.Filled.Warning to TaliseColors.sentRedSoft
    KYCStatus.Unverified -> Icons.Filled.PersonSearch to TaliseColors.fgMuted
}

@Composable
private fun ApprovedCard() {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.Verified, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(16.dp))
            Text(
                "You're verified",
                style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                color = TaliseColors.greenMint,
            )
        }
        Text(
            "Cash-out to your bank is unlocked. You can withdraw from any supported corridor.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun PendingCard(
    kycUrl: String?,
    tosUrl: String?,
    onOpen: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "We're reviewing your details. This usually takes a few minutes. You can close this screen, we'll keep checking.",
            style = TaliseType.body(13.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        if (kycUrl != null || tosUrl != null) {
            OpenLinksRow(kycUrl = kycUrl, tosUrl = tosUrl, onOpen = onOpen)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(50.dp)
                .background(TaliseColors.greenMint, CircleShape)
                .clickable { onRefresh() },
            contentAlignment = Alignment.Center,
        ) {
            Text("Refresh status", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = Color.Black)
        }
    }
}

/** The "start (or retry) verification" call-to-action. */
@Composable
private fun ActionCard(
    retry: Boolean,
    working: Boolean,
    kycUrl: String?,
    tosUrl: String?,
    onOpen: (String) -> Unit,
    onBegin: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            if (retry) {
                "Your last attempt didn't go through. You can try again, make sure your name matches your government ID."
            } else {
                "You'll verify your identity and accept the terms with our payments partner. Two quick steps in your browser."
            },
            style = TaliseType.body(13.5.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )

        // If links already exist (start was tapped), surface them.
        if (kycUrl != null || tosUrl != null) {
            OpenLinksRow(kycUrl = kycUrl, tosUrl = tosUrl, onOpen = onOpen)
        }

        Row(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .background(TaliseColors.greenMint.copy(alpha = if (working) 0.7f else 1f), CircleShape)
                .clickable(enabled = !working) { onBegin() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            if (working) {
                CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            }
            Text(
                if (working) "Preparing…" else if (retry) "Try again" else "Verify identity",
                style = TaliseType.body(16.sp, FontWeight.SemiBold),
                color = Color.Black,
            )
        }
    }
}

/** Re-openable KYC + ToS link buttons (shown once `start` returns them). */
@Composable
private fun OpenLinksRow(
    kycUrl: String?,
    tosUrl: String?,
    onOpen: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        kycUrl?.let { LinkButton("Verify identity", Icons.Filled.Badge) { onOpen(it) } }
        tosUrl?.let { LinkButton("Review & accept terms", Icons.Filled.Description) { onOpen(it) } }
    }
}

@Composable
private fun LinkButton(title: String, icon: ImageVector, action: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .background(TaliseColors.surface2, RoundedCornerShape(14.dp))
            .clickable { action() }
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = TaliseColors.fg, modifier = Modifier.size(13.dp))
        Text(
            title,
            style = TaliseType.body(14.5.sp, FontWeight.Medium),
            color = TaliseColors.fg,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.AutoMirrored.Filled.OpenInNew,
            contentDescription = null,
            tint = TaliseColors.fg,
            modifier = Modifier.size(11.dp),
        )
    }
}
