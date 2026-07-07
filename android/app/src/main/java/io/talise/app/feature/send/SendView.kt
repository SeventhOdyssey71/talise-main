package io.talise.app.feature.send

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.util.Locale

/**
 * Shared shapes for the multi-page Send flow — the Android counterpart of
 * iOS `SendView.swift` (SendStep / SendDraft / SendSuccess + the flat
 * "glass" chrome building blocks used across every Send screen).
 */

/** State-machine cursor for the multi-page send flow. */
enum class SendStep {
    Amount,
    Recipient,
    Review,
    Sending,
    Complete,

    /**
     * Terminal failure state. Reached when sponsor-prepare, gasless-submit
     * or the sign step throws. The success screen must NEVER render here.
     */
    Failure,
}

/**
 * Mutable draft passed through the SendFlow pages — mirrors the iOS
 * `@Observable SendDraft`. Holds everything the flow accumulates before
 * hitting the backend.
 */
class SendDraft(
    /**
     * Snapshot of the display currency at the moment the user typed the
     * amount. Android renders USD today; the field keeps the iOS shape so
     * the cross-border helpers work identically.
     */
    val currency: SendCurrency,
) {
    /** User-entered string in the display currency (e.g. "1235" or "12.50"). */
    var rawAmount by mutableStateOf("")

    /** Recipient text from the input field. */
    var recipientInput by mutableStateOf("")

    /** Server-resolved recipient (handle or 0x lookup result). */
    var resolved by mutableStateOf<SendResolvedRecipient?>(null)

    /** USDsui-equivalent of `rawAmount`, filled right before review. */
    var amountUsdsui by mutableStateOf(0.0)

    /** Submission outcome — surfaces in SendCompleteView. */
    var success by mutableStateOf<SendSuccess?>(null)

    /** Error to surface inside the failure page. */
    var errorMessage by mutableStateOf<String?>(null)

    /** Historical sent-count between the user and this recipient, when known. */
    var previousSendsToRecipient by mutableStateOf<Int?>(null)

    /** Optional ISO code of the recipient's home/payout currency. */
    var recipientCurrencyCode by mutableStateOf<String?>(null)
}

/** Snapshot of a successful send — persists across sending → complete. */
data class SendSuccess(
    val digest: String,
    /** User-entered amount string (raw, no symbol). */
    val displayAmount: String,
    /** Currency the user typed in. */
    val currency: SendCurrency,
    /** USDsui-equivalent posted on chain. */
    val usdsui: Double,
    /** Resolved recipient address (0x...). */
    val recipientAddress: String,
    /** Display name (handle or short address) for the recipient. */
    val recipientDisplay: String,
    /** Round-up & Save amount auto-set-aside with this send (USD). */
    val savedUsd: Double = 0.0,
)

// ── Formatting helpers (iOS TaliseFormat subset, feature-local) ─────────────

/** "0x648712…9fe2a1" style middle truncation. */
internal fun shortAddress(a: String): String {
    if (a.length <= 14) return a
    return a.take(8) + "…" + a.takeLast(6)
}

/** Grouped decimal figure, en_US locale ("1,234.50"). */
internal fun sendFmt(v: Double, decimals: Int = 2): String =
    String.format(Locale.US, "%,.${decimals}f", v)

/** "$1,234.50" style symbolic amount for any currency. */
internal fun sendSymbolic(amount: Double, currency: SendCurrency, fixed: Int = 2): String =
    "${currency.symbol}${sendFmt(amount, fixed)}"

/** USD display of a USDsui figure — Android's display currency is USD. */
internal fun sendLocal2(usd: Double): String = sendSymbolic(usd, SendCurrencies.usd, 2)

/** Insert thousands-separator commas into a pure-digit integer string. */
internal fun groupDigits(s: String): String {
    if (s.length <= 3 || !s.all { it.isDigit() }) return s
    val out = StringBuilder()
    s.reversed().forEachIndexed { i, ch ->
        if (i > 0 && i % 3 == 0) out.append(',')
        out.append(ch)
    }
    return out.reverse().toString()
}

/**
 * What the big number renders: groups the integer part while preserving
 * the raw decimal the user typed ("12." stays "12.", "1234.5" → "1,234.5").
 */
internal fun displayAmountString(raw: String): String {
    if (raw.isEmpty()) return "0"
    val dot = raw.indexOf('.')
    if (dot >= 0) return "${groupDigits(raw.substring(0, dot))}.${raw.substring(dot + 1)}"
    return groupDigits(raw)
}

// ── Flat chrome building blocks (shared across the Send flow) ───────────────

/** A flat solid capsule for status pills — iOS `glassCapsule()`. */
internal fun Modifier.glassCapsule(): Modifier = this
    .background(TaliseColors.surface2, CircleShape)
    .border(1.dp, TaliseColors.line, CircleShape)

/** A flat disc for circular chrome buttons — iOS `glassCircle()`. */
@Composable
internal fun GlassCircleButton(
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 38.dp,
    iconSize: Dp = 16.dp,
    tint: Color = TaliseColors.fgMuted,
) {
    Box(
        modifier
            .size(size)
            .background(TaliseColors.surface2, CircleShape)
            .border(1.dp, TaliseColors.line, CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
    }
}

/** Bright-green primary capsule with dark ink — iOS Review/Next buttons. */
@Composable
internal fun CapsuleButton(
    title: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(if (enabled) TaliseColors.greenMint else TaliseColors.surface2, CircleShape)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            style = TaliseType.heading(16.sp, FontWeight.Medium),
            color = if (enabled) TaliseColors.inkOnGreen else TaliseColors.fgDim,
        )
    }
}

/** Secondary "Done" capsule, surface2 + hairline — iOS `glassCapsule`. */
@Composable
internal fun GlassCapsuleButton(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(56.dp)
            .glassCapsule()
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(title, style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.fg)
    }
}

/** Solid dark capsule (fg fill, bg ink) — iOS "Try again"/"Pay" buttons. */
@Composable
internal fun SolidCapsuleButton(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(
                if (enabled) TaliseColors.fg else TaliseColors.fg.copy(alpha = 0.35f),
                CircleShape,
            )
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(title, style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.bg)
    }
}

/** Hairline divider — iOS `LiquidGlassDivider` (white @ 8%, 1px). */
@Composable
internal fun LiquidGlassDivider(modifier: Modifier = Modifier, inset: Dp = 0.dp) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = inset)
            .height(1.dp)
            .background(TaliseColors.line),
    )
}

/** Tracked mono micro label — iOS `MicroLabel(...).kerning(n)`. */
@Composable
internal fun SendMicroLabel(
    text: String,
    color: Color,
    kerning: Double = 1.5,
    modifier: Modifier = Modifier,
) {
    Text(
        text.uppercase(),
        style = TaliseType.mono(10.sp),
        letterSpacing = kerning.sp,
        color = color,
        modifier = modifier,
    )
}
