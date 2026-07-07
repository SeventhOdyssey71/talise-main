package io.talise.app.feature.profile

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.ArrowOutward
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.PermIdentity
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Identity verification (Bridge KYC), surfaced from Profile. A 1:1 port of iOS
 * IdentityVerificationView.
 *
 * Flow: load current status (GET /api/kyc/bridge/status), "Verify identity"
 * (POST /api/kyc/bridge/start) then open the hosted KYC + Terms links in the
 * browser, and poll status while it's in review, flipping to a success state on
 * approval. Verifying unlocks USD/EUR cash-out; no PII flows through Talise.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun IdentityVerificationSheet(onDismiss: () -> Unit) {
    val context = LocalContext.current
    var loading by remember { mutableStateOf(true) }
    var working by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf(KycStatus.UNVERIFIED) }
    var kycUrl by remember { mutableStateOf<String?>(null) }
    var tosUrl by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var polling by remember { mutableStateOf(false) }

    fun open(url: String) = context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))

    // load()
    LaunchedEffect(Unit) {
        loading = true
        runCatching { profileApi.kycStatus() }
            .onSuccess { status = KycStatus.from(it.status); if (status.isInFlight) polling = true }
            .onFailure { status = if (httpCode(it) == 503) status else KycStatus.UNVERIFIED }
        loading = false
    }

    // poll while in review, every 8s, up to ~8 minutes
    LaunchedEffect(polling) {
        if (!polling) return@LaunchedEffect
        repeat(60) {
            delay(8_000)
            val next = runCatching { profileApi.kycStatus() }.getOrNull() ?: return@repeat
            status = KycStatus.from(next.status)
            if (status == KycStatus.APPROVED || status == KycStatus.REJECTED) { polling = false; return@LaunchedEffect }
        }
        polling = false
    }

    suspend fun beginVerification() {
        if (working) return
        working = true
        error = null
        try {
            val r = profileApi.kycStart(EmptyBody())
            status = KycStatus.from(r.status)
            kycUrl = r.kycUrl
            tosUrl = r.tosUrl
            (r.kycUrl ?: r.tosUrl)?.let { open(it) }
            polling = true
        } catch (e: Exception) {
            error = when (httpCode(e)) {
                503 -> "Cash-out verification isn't switched on yet. Please try again soon."
                400 -> "Add an email to your account first, then verify your identity."
                429 -> "Too many attempts, wait a moment and try again."
                401 -> "Your session expired. Sign out and back in, then try again."
                else -> "Couldn't start verification. Please try again."
            }
        } finally {
            working = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = TaliseColors.bg,
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp).padding(top = 8.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // Header
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Identity verification", style = TaliseType.heading(22.sp, FontWeight.Medium), letterSpacing = (-0.4).sp, color = TaliseColors.fg)
                Text(
                    "A one-time check that unlocks cashing out to your bank. Your details go straight to our payments partner, Talise never stores them.",
                    style = TaliseType.body(13.5.sp, FontWeight.Light), color = TaliseColors.fgMuted,
                )
            }

            if (loading) {
                Row(
                    Modifier.fillMaxWidth().rampCard().padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CircularProgressIndicator(color = TaliseColors.greenMint, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text("Checking your status…", style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                }
            } else {
                StatusCard(status, polling)
                when (status) {
                    KycStatus.APPROVED -> ApprovedCard()
                    KycStatus.PENDING -> PendingCard(kycUrl, tosUrl, ::open) {
                        // Refresh status once.
                        runCatching { profileApi.kycStatus() }.getOrNull()?.let { status = KycStatus.from(it.status) }
                    }
                    KycStatus.REJECTED, KycStatus.EXPIRED -> ActionCard(true, working, kycUrl, tosUrl, ::open) { beginVerification() }
                    KycStatus.UNVERIFIED -> ActionCard(false, working, kycUrl, tosUrl, ::open) { beginVerification() }
                }
                error?.let {
                    Text(it, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
                }
            }
        }
    }
}

@Composable
private fun StatusCard(status: KycStatus, polling: Boolean) {
    Row(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(statusIcon(status), null, tint = statusColor(status), modifier = Modifier.size(20.dp))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("STATUS", style = TaliseType.mono(10.sp), letterSpacing = 1.sp, color = TaliseColors.fgDim)
            Text(status.label, style = TaliseType.heading(17.sp, FontWeight.Medium), color = TaliseColors.fg)
        }
        Spacer(Modifier.weight(1f))
        if (polling) CircularProgressIndicator(color = TaliseColors.greenMint, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
    }
}

@Composable
private fun ApprovedCard() {
    Column(Modifier.fillMaxWidth().rampCard().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.VerifiedUser, null, tint = TaliseColors.greenMint, modifier = Modifier.size(18.dp))
            Text("You're verified", style = TaliseType.heading(16.sp, FontWeight.SemiBold), color = TaliseColors.greenMint)
        }
        Text(
            "Cash-out to your bank is unlocked. You can withdraw from any supported corridor.",
            style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun PendingCard(kycUrl: String?, tosUrl: String?, open: (String) -> Unit, onRefresh: suspend () -> Unit) {
    var refreshing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().rampCard().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(
            "We're reviewing your details. This usually takes a few minutes. You can close this screen, we'll keep checking.",
            style = TaliseType.body(13.5.sp, FontWeight.Light), color = TaliseColors.fgMuted,
        )
        if (kycUrl != null || tosUrl != null) OpenLinksRow(kycUrl, tosUrl, open)
        GreenPillButton(if (refreshing) "Refreshing…" else "Refresh status") {
            if (!refreshing) { refreshing = true; onRefresh(); refreshing = false }
        }
    }
}

@Composable
private fun ActionCard(
    retry: Boolean,
    working: Boolean,
    kycUrl: String?,
    tosUrl: String?,
    open: (String) -> Unit,
    onStart: suspend () -> Unit,
) {
    Column(Modifier.fillMaxWidth().rampCard().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(
            if (retry) "Your last attempt didn't go through. You can try again, make sure your name matches your government ID."
            else "You'll verify your identity and accept the terms with our payments partner. Two quick steps in your browser.",
            style = TaliseType.body(13.5.sp, FontWeight.Light), color = TaliseColors.fgMuted,
        )
        if (kycUrl != null || tosUrl != null) OpenLinksRow(kycUrl, tosUrl, open)
        GreenPillButton(
            if (working) "Preparing…" else if (retry) "Try again" else "Verify identity",
            enabled = !working,
            leading = if (working) ({ CircularProgressIndicator(color = TaliseColors.inkOnGreen, modifier = Modifier.size(16.dp), strokeWidth = 2.dp) }) else null,
        ) { onStart() }
    }
}

@Composable
private fun OpenLinksRow(kycUrl: String?, tosUrl: String?, open: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        kycUrl?.let { LinkButton("Verify identity", Icons.Filled.PermIdentity) { open(it) } }
        tosUrl?.let { LinkButton("Review & accept terms", Icons.Filled.Description) { open(it) } }
    }
}

@Composable
private fun LinkButton(title: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(48.dp).background(TaliseColors.surface2, RoundedCornerShape(14.dp))
            .clickable { onClick() }.padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, null, tint = TaliseColors.fg, modifier = Modifier.size(15.dp))
        Text(title, style = TaliseType.body(14.5.sp, FontWeight.Medium), color = TaliseColors.fg)
        Spacer(Modifier.weight(1f))
        Icon(Icons.Filled.ArrowOutward, null, tint = TaliseColors.fg, modifier = Modifier.size(12.dp))
    }
}

@Composable
private fun GreenPillButton(
    title: String,
    enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null,
    onClick: suspend () -> Unit,
) {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().height(if (leading != null) 54.dp else 50.dp)
            .background(TaliseColors.greenMint, RoundedCornerShape(27.dp))
            .clickable(enabled = enabled) { scope.launch { onClick() } }
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        leading?.let { it(); Spacer(Modifier.size(8.dp)) }
        Text(title, style = TaliseType.body(if (leading != null) 16.sp else 15.sp, FontWeight.SemiBold), color = TaliseColors.inkOnGreen)
    }
}

private fun statusIcon(status: KycStatus): ImageVector = when (status) {
    KycStatus.APPROVED -> Icons.Filled.VerifiedUser
    KycStatus.PENDING -> Icons.Filled.Schedule
    KycStatus.REJECTED, KycStatus.EXPIRED -> Icons.Filled.Warning
    KycStatus.UNVERIFIED -> Icons.AutoMirrored.Filled.HelpOutline
}

private fun statusColor(status: KycStatus): Color = when (status) {
    KycStatus.APPROVED -> TaliseColors.greenMint
    KycStatus.REJECTED, KycStatus.EXPIRED -> TaliseColors.danger
    else -> TaliseColors.fgMuted
}
