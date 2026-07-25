package io.talise.app.feature.ramps

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
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
import retrofit2.HttpException

/**
 * Bridge ADD-MONEY screen for a chosen corridor, ported 1:1 from iOS
 * `BridgeOnrampView.swift`. Fetches the funding session and renders one of:
 *   - Verify-identity step (hosted Bridge KYC + ToS opened in the browser), or
 *   - Bank deposit instructions (the virtual account to send fiat to), or
 *   - a clean "not available yet" state when funding isn't switched on.
 *
 * Funds land on the user's OWN Sui address as USDC (Bridge's Sui asset), so
 * when the server reports `requiresSwapToUsdsui` we say so plainly rather than
 * promising USDsui the user would then not find.
 */
class BridgeOnrampViewModel(private val corridor: RampCorridor) : ViewModel() {

    data class State(
        val session: OnrampSessionResponse? = null,
        val loading: Boolean = true,
        val unavailable: Boolean = false,
        val errorText: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, errorText = null, unavailable = false)
        viewModelScope.launch {
            try {
                // Amount is nominal, a virtual account accepts any deposit; the
                // route just requires a positive value. Currency = the corridor's
                // so a EUR user funds a SEPA account, not USD.
                val session = RampsClient.api.onrampSession(
                    OnrampSessionRequest(
                        amountCents = 10_000,
                        provider = "bridge",
                        sourceCurrency = corridor.currencyCode.lowercase(),
                    ),
                )
                _state.value = _state.value.copy(session = session, loading = false)
            } catch (t: Throwable) {
                val msg = RampsClient.errorText(t)
                // 404 = the ONRAMP_ENABLED switch is off; 503 = switch on but the
                // provider has no credentials. Both mean "closed", not "broken".
                val code = (t as? HttpException)?.code()
                if (code == 404 || code == 503 || msg.contains("404") || msg.contains("503")) {
                    _state.value = _state.value.copy(unavailable = true, loading = false)
                } else {
                    _state.value = _state.value.copy(
                        errorText = "We couldn't set up funding right now. Please try again.",
                        loading = false,
                    )
                }
            }
        }
    }
}

@Composable
fun BridgeOnrampView(
    corridor: RampCorridor,
    vm: BridgeOnrampViewModel = viewModel(key = "onramp-${corridor.code}") { BridgeOnrampViewModel(corridor) },
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current
    val uriHandler = LocalUriHandler.current

    var copied by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(copied) {
        if (copied != null) {
            delay(1_600)
            copied = null
        }
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // -- Header --
            Row(
                Modifier.padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                RoundedFlag(code = corridor.code, size = 46.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        "Add money · ${corridor.name}",
                        style = TaliseType.heading(20.sp, FontWeight.Medium),
                        letterSpacing = (-0.4).sp,
                        color = TaliseColors.fg,
                    )
                    Text(
                        "Fund in ${corridor.currencyCode}, lands in your Talise wallet.",
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }
            }

            when {
                state.loading -> LoadingCard("Setting up your funding details…")

                state.unavailable -> RampMessageCard(
                    title = "Not available just yet",
                    body = "Bank funding for ${corridor.name} isn't switched on yet. In the meantime you can fund Talise by receiving dollars to your own address, go back and choose Crypto.",
                )

                state.errorText != null -> RampMessageCard(
                    title = "Something went wrong",
                    body = state.errorText!!,
                )

                // Identity first: Bridge won't issue an account until KYC clears,
                // so this is a real next step rather than an error.
                state.session?.kycRequired == true || (state.session != null && state.session!!.depositInstructions == null && state.session!!.kycUrl != null) ->
                    VerifyCard(
                        pending = state.session?.status == "pending",
                        kycUrl = state.session?.kycUrl,
                        tosUrl = state.session?.tosUrl,
                        onOpen = { uriHandler.openUri(it) },
                        onRecheck = { vm.load() },
                    )

                state.session?.depositInstructions != null -> DepositCard(
                    di = state.session!!.depositInstructions!!,
                    needsSwap = state.session!!.requiresSwapToUsdsui != false,
                    onCopy = { label, value ->
                        clipboard.setText(AnnotatedString(value))
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        copied = label
                    },
                )

                state.session != null -> RampMessageCard(
                    title = "Couldn't load your funding details",
                    body = "Nothing has been charged. Please try again in a moment.",
                )
            }
        }

        // -- Copied toast --
        AnimatedVisibility(
            visible = copied != null,
            enter = slideInVertically(initialOffsetY = { it / 2 }) + fadeIn(),
            exit = slideOutVertically(targetOffsetY = { it / 2 }) + fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp),
        ) {
            Text(
                "${copied ?: ""} copied",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fg,
                modifier = Modifier
                    .background(TaliseColors.surface2, CircleShape)
                    .padding(horizontal = 18.dp, vertical = 12.dp),
            )
        }
    }
}

// MARK: - Cards

@Composable
internal fun LoadingCard(text: String) {
    Row(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircularProgressIndicator(
            color = TaliseColors.greenMint,
            strokeWidth = 2.dp,
            modifier = Modifier.size(20.dp),
        )
        Text(
            text,
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun VerifyCard(
    pending: Boolean,
    kycUrl: String?,
    tosUrl: String?,
    onOpen: (String) -> Unit,
    onRecheck: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                Icons.Filled.VerifiedUser,
                contentDescription = null,
                tint = TaliseColors.fg,
                modifier = Modifier.size(16.dp),
            )
            Text(
                "Verify your identity",
                style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                color = TaliseColors.fg,
            )
        }
        Text(
            if (pending) {
                "Your check is being reviewed by our banking partner. This usually takes a few minutes, we'll open your funding account as soon as it clears."
            } else {
                "A quick, secure check (handled by our banking partner) before your bank funding goes live. Takes a couple of minutes."
            },
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        if (kycUrl != null) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .background(TaliseColors.greenMint, CircleShape)
                    .clickable { onOpen(kycUrl) },
                contentAlignment = Alignment.Center,
            ) {
                Text("Continue", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = Color.Black)
            }
        }
        if (tosUrl != null) {
            Text(
                "Review and accept the terms",
                style = TaliseType.body(13.sp),
                color = TaliseColors.fgMuted,
                modifier = Modifier.clickable { onOpen(tosUrl) },
            )
        }
        Text(
            "I've finished, check again",
            style = TaliseType.body(13.sp),
            color = TaliseColors.fgMuted,
            modifier = Modifier.clickable { onRecheck() },
        )
    }
}

@Composable
private fun DepositCard(
    di: BridgeDepositInstructions,
    needsSwap: Boolean,
    onCopy: (String, String) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            "Send ${di.currency.uppercase()} to this account",
            style = TaliseType.heading(16.sp, FontWeight.SemiBold),
            color = TaliseColors.fg,
        )
        Text(
            "Transfer from your bank. This account is yours permanently, reuse it any time you top up.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        Column(
            Modifier
                .fillMaxWidth()
                .background(TaliseColors.surface2.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                .padding(vertical = 4.dp),
        ) {
            di.beneficiaryName?.let { CopyRow("Beneficiary", it, onCopy) }
            di.bankName?.let { CopyRow("Bank", it, onCopy) }
            di.accountNumber?.let { CopyRow("Account number", it, onCopy) }
            di.routingNumber?.let { CopyRow("Routing number", it, onCopy) }
            di.iban?.let { CopyRow("IBAN", it, onCopy) }
            di.bic?.let { CopyRow("BIC", it, onCopy) }
            di.depositMessage?.let { CopyRow("Reference", it, onCopy) }
        }
        if (di.depositMessage != null) {
            Text(
                "Include the reference exactly as shown, or your bank may not be able to match the deposit.",
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
        Text(
            if (needsSwap) {
                "Funds arrive on Sui as USDC, usually within minutes. One tap on your home screen converts them to USDsui, free."
            } else {
                "Funds arrive as USDsui in your wallet, usually within minutes."
            },
            style = TaliseType.body(12.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun CopyRow(
    label: String,
    value: String,
    onCopy: (String, String) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onCopy(label, value) }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                label,
                style = TaliseType.mono(10.sp),
                letterSpacing = 0.4.sp,
                color = TaliseColors.fgDim,
            )
            Text(value, style = TaliseType.body(15.sp), color = TaliseColors.fg)
        }
        Icon(
            Icons.Filled.ContentCopy,
            contentDescription = "Copy",
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(13.dp),
        )
    }
}
