package io.talise.app.feature.send

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.R
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** Mint-green celebration accent (iOS SuccessfulTxView / #B1F49A). */
private val Mint = Color(0xFFB1F49A)

/** Dark ink used on bright-green CTAs (iOS `Color(hex: 0x0A140C)`). */
private val InkOnGreen = Color(0xFF0A140C)

/**
 * Send flow, a pixel port of iOS `SendFlowView`: amount keypad → recipient →
 * review (slide to send) → in-flight → success/failure. Wired to [SendViewModel]:
 * resolve → sponsor-prepare → local zkLogin sign → gasless-submit → digest.
 * Only the visual composition changed; the pipeline and its state handling are
 * preserved.
 */
@Composable
fun SendFlow(onClose: () -> Unit, vm: SendViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    when (val s = state) {
        is SendViewModel.State.Success -> SendCompleteScreen(
            amountUsd = s.amount,
            suiscan = s.suiscan,
            onDone = onClose,
        )
        is SendViewModel.State.Error -> SendFailureScreen(
            message = s.message,
            onTryAgain = { vm.reset() },
            onDone = onClose,
        )
        else -> SendFormFlow(
            working = s as? SendViewModel.State.Working,
            onClose = onClose,
            onSend = { amount, recipient -> vm.send(amount, recipient) },
        )
    }
}

private enum class Step { Amount, Recipient, Review }

@Composable
private fun SendFormFlow(
    working: SendViewModel.State.Working?,
    onClose: () -> Unit,
    onSend: (Double, String) -> Unit,
) {
    var step by remember { mutableStateOf(Step.Amount) }
    var amountRaw by remember { mutableStateOf("") }
    var recipient by remember { mutableStateOf("") }
    var slideReset by remember { mutableStateOf(false) }

    // Once the pipeline is in flight the ViewModel reports Working, hold on the
    // in-flight screen regardless of which step launched it.
    if (working != null) {
        SendInProgressScreen(onDone = onClose)
        return
    }

    when (step) {
        Step.Amount -> SendAmountScreen(
            amountRaw = amountRaw,
            onKey = { amountRaw = applyKey(amountRaw, it) },
            onClose = onClose,
            onNext = { step = Step.Recipient },
        )
        Step.Recipient -> SendRecipientScreen(
            recipient = recipient,
            onValue = { recipient = it },
            onBack = { step = Step.Amount },
            onNext = { step = Step.Review },
        )
        Step.Review -> SendReviewScreen(
            amountRaw = amountRaw,
            recipient = recipient,
            slideReset = slideReset,
            onBack = { step = Step.Recipient },
            onConfirm = {
                val amt = amountRaw.toDoubleOrNull()
                if (amt != null && amt > 0 && recipient.isNotBlank()) onSend(amt, recipient.trim())
                slideReset = !slideReset
            },
        )
    }
}

// MARK: - Keypad string handling (iOS SendNumpad)

private fun applyKey(input: String, key: String): String = when (key) {
    "<" -> if (input.isEmpty()) input else input.dropLast(1)
    "." -> when {
        input.contains(".") -> input
        input.isEmpty() -> "0."
        else -> "$input."
    }
    else -> when {
        input == "0" -> key
        input.contains(".") -> {
            val frac = input.length - input.indexOf('.') - 1
            if (frac >= 2) input else input + key
        }
        input.length >= 9 -> input
        else -> input + key
    }
}

private fun groupDigits(s: String): String {
    if (s.length <= 3 || !s.all { it.isDigit() }) return s
    val out = StringBuilder()
    s.reversed().forEachIndexed { i, ch ->
        if (i > 0 && i % 3 == 0) out.append(',')
        out.append(ch)
    }
    return out.reverse().toString()
}

private fun displayAmount(raw: String): String {
    if (raw.isEmpty()) return "0"
    val dot = raw.indexOf('.')
    if (dot >= 0) return "${groupDigits(raw.substring(0, dot))}.${raw.substring(dot + 1)}"
    return groupDigits(raw)
}

private fun usdsuiSecondary(raw: String): String {
    val amt = raw.toDoubleOrNull() ?: 0.0
    return "%,.2f USDsui".format(amt)
}

// MARK: - Step 1: amount

@Composable
private fun SendAmountScreen(
    amountRaw: String,
    onKey: (String) -> Unit,
    onClose: () -> Unit,
    onNext: () -> Unit,
) {
    val canAdvance = (amountRaw.toDoubleOrNull() ?: 0.0) > 0.0

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Header
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlassCircleButton(Icons.Filled.Close, onClick = onClose)
            Spacer(Modifier.weight(1f))
            Text("SEND", style = TaliseType.mono(8.sp), letterSpacing = 2.0.sp, color = TaliseColors.fgMuted)
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.size(38.dp))
        }

        Spacer(Modifier.weight(1f))

        // Amount block
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
            val amountText = buildAnnotatedString {
                withStyle(SpanStyle(fontSize = 56.sp, fontWeight = FontWeight.Thin, color = TaliseColors.fgMuted)) { append("$") }
                withStyle(SpanStyle(fontSize = 56.sp, fontWeight = FontWeight.Thin)) { append(" ") }
                withStyle(SpanStyle(fontSize = 72.sp, fontWeight = FontWeight.Medium, color = TaliseColors.fg, letterSpacing = (-2).sp)) {
                    append(displayAmount(amountRaw))
                }
            }
            Text(amountText, style = TaliseType.heading(72.sp, FontWeight.Medium), maxLines = 1)
            Spacer(Modifier.height(10.dp))
            Text(usdsuiSecondary(amountRaw), style = TaliseType.mono(13.sp, FontWeight.Light), color = TaliseColors.fgDim)
        }

        Spacer(Modifier.weight(1f))

        // Wallet pill
        Row(
            Modifier.padding(bottom = 18.dp)
                .background(TaliseColors.surface2, CircleShape)
                .border(1.dp, TaliseColors.line, CircleShape)
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(6.dp).background(TaliseColors.greenMint, CircleShape))
            Text("MAIN WALLET", style = TaliseType.mono(10.sp), letterSpacing = 1.5.sp, color = TaliseColors.fg)
        }

        // Numpad
        SendNumpad(onKey = onKey, modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 12.dp))

        // Review CTA
        CapsuleButton(
            title = "Review",
            enabled = canAdvance,
            onClick = onNext,
            modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
        )
    }
}

@Composable
private fun SendNumpad(onKey: (String) -> Unit, modifier: Modifier = Modifier) {
    val rows = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf(".", "0", "<"),
    )
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { key ->
                    Box(
                        Modifier.weight(1f).height(60.dp).clickable { onKey(key) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (key == "<") {
                            Icon(Icons.AutoMirrored.Outlined.Backspace, contentDescription = "Delete", tint = TaliseColors.fg, modifier = Modifier.size(22.dp))
                        } else {
                            Text(key, style = TaliseType.heading(28.sp, FontWeight.Normal), color = TaliseColors.fg)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Step 2: recipient

@Composable
private fun SendRecipientScreen(
    recipient: String,
    onValue: (String) -> Unit,
    onBack: () -> Unit,
    onNext: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlassCircleButton(Icons.Filled.ChevronLeft, onClick = onBack, tint = TaliseColors.fg)
            Spacer(Modifier.weight(1f))
            Text("SEND TO", style = TaliseType.mono(8.sp), letterSpacing = 2.0.sp, color = TaliseColors.fgMuted)
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.size(38.dp))
        }

        // Input card
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 16.dp)
                .background(TaliseColors.surface, RoundedCornerShape(20.dp))
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("TO", style = TaliseType.mono(8.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
            Box {
                if (recipient.isEmpty()) {
                    Text("alice / 0x6487… / +44 7…", style = TaliseType.body(17.sp), color = TaliseColors.fgDim)
                }
                BasicTextField(
                    value = recipient,
                    onValueChange = onValue,
                    singleLine = true,
                    textStyle = TaliseType.body(17.sp).merge(androidx.compose.ui.text.TextStyle(color = TaliseColors.fg)),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(TaliseColors.accent),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Text(
            "Recent".uppercase(),
            style = TaliseType.mono(10.sp),
            letterSpacing = 2.0.sp,
            color = TaliseColors.fgMuted,
            modifier = Modifier.padding(horizontal = 28.dp).padding(top = 26.dp),
        )
        Text(
            "No recent recipients yet, your first send will appear here.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
            modifier = Modifier.padding(horizontal = 28.dp).padding(top = 12.dp),
        )

        Spacer(Modifier.weight(1f))

        CapsuleButton(
            title = "Next",
            enabled = recipient.trim().isNotBlank(),
            onClick = onNext,
            modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
        )
    }
}

// MARK: - Step 3: review

@Composable
private fun SendReviewScreen(
    amountRaw: String,
    recipient: String,
    slideReset: Boolean,
    onBack: () -> Unit,
    onConfirm: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlassCircleButton(Icons.Filled.ChevronLeft, onClick = onBack, tint = TaliseColors.fg)
            Spacer(Modifier.weight(1f))
        }

        Column(
            Modifier.fillMaxWidth().weight(1f).padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text(
                "Review send",
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.5).sp,
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            )

            // From card
            Column(
                Modifier.fillMaxWidth().background(TaliseColors.surface, RoundedCornerShape(22.dp)).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("FROM YOU", style = TaliseType.mono(10.sp), letterSpacing = 2.0.sp, color = TaliseColors.fgDim)
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("$", style = TaliseType.heading(28.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                    Text(
                        displayAmount(amountRaw),
                        style = TaliseType.heading(40.sp, FontWeight.Medium),
                        letterSpacing = (-1).sp,
                        color = TaliseColors.fg,
                        maxLines = 1,
                    )
                }
                Text(usdsuiSecondary(amountRaw), style = TaliseType.mono(12.sp, FontWeight.Light), color = TaliseColors.fgDim)
            }

            // Arrow
            Box(
                Modifier.size(32.dp).background(TaliseColors.surface2, CircleShape).border(1.dp, TaliseColors.line, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.ArrowDownward, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(15.dp))
            }

            // To card
            Column(
                Modifier.fillMaxWidth().background(TaliseColors.surface, RoundedCornerShape(22.dp)).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("TO", style = TaliseType.mono(10.sp), letterSpacing = 2.0.sp, color = TaliseColors.fgDim)
                Text(
                    recipient.trim().ifBlank { "—" },
                    style = TaliseType.heading(20.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    maxLines = 1,
                )
            }

            // Fee line
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Spacer(Modifier.weight(1f))
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(11.dp))
                Text(
                    "Network fee $0.00, Talise auto-routed the rail and sponsored the gas.",
                    style = TaliseType.mono(11.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.weight(1f))
            }
        }

        SlideToConfirm(
            title = "Slide to send",
            tint = TaliseColors.greenMint,
            reset = slideReset,
            onConfirm = { onConfirm() },
            modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
        )
    }
}

// MARK: - Step 4: in-flight

@Composable
private fun SendInProgressScreen(onDone: () -> Unit) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            CircularProgressIndicator(color = TaliseColors.greenMint, strokeWidth = 3.5.dp, modifier = Modifier.size(72.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Sending…", style = TaliseType.heading(28.sp, FontWeight.Medium), letterSpacing = (-0.5).sp, color = TaliseColors.fg)
                Text(
                    "Should take a moment. You can close this now, we'll keep going.",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp),
                )
            }
        }
        Spacer(Modifier.weight(1f))
        GlassCapsuleButton(title = "Done", onClick = onDone, modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp))
    }
}

// MARK: - Step 5: success (iOS SuccessfulTxView)

@Composable
private fun SendCompleteScreen(amountUsd: Double, suiscan: String?, onDone: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        Image(
            painter = painterResource(R.drawable.successcoins),
            contentDescription = null,
            modifier = Modifier.width(360.dp).height(282.dp),
        )

        Spacer(Modifier.height(24.dp))

        Text(
            "$%,.2f".format(amountUsd),
            style = TaliseType.heading(75.sp, FontWeight.Normal),
            letterSpacing = (-1.5).sp,
            color = Mint,
            textAlign = TextAlign.Center,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        Text(
            "Transaction Successful!",
            style = TaliseType.heading(25.sp, FontWeight.Medium),
            letterSpacing = (-0.5).sp,
            color = Mint,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 20.dp).padding(top = 18.dp),
        )
        Text(
            "gas cost = 0, money arrives < 1s",
            style = TaliseType.mono(13.sp, FontWeight.Normal),
            letterSpacing = (-0.26).sp,
            color = TaliseColors.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 20.dp).padding(top = 8.dp),
        )

        Spacer(Modifier.weight(1f))

        Row(
            Modifier.padding(bottom = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Share Receipt
            Row(
                Modifier.width(158.dp).height(41.dp)
                    .background(TaliseColors.surface2, CircleShape)
                    .clickable(enabled = suiscan != null) { suiscan?.let { uriHandler.openUri(it) } },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Share Receipt", style = TaliseType.body(15.sp, FontWeight.Medium), letterSpacing = (-0.3).sp, color = TaliseColors.fg)
                Spacer(Modifier.width(6.dp))
                Icon(Icons.Outlined.IosShare, contentDescription = null, tint = TaliseColors.fg, modifier = Modifier.size(12.dp))
            }
            // Done
            Box(
                Modifier.width(92.dp).height(41.dp).background(TaliseColors.fg, CircleShape).clickable { onDone() },
                contentAlignment = Alignment.Center,
            ) {
                Text("Done", style = TaliseType.body(15.sp, FontWeight.Medium), letterSpacing = (-0.3).sp, color = Color.Black)
            }
        }
    }
}

// MARK: - Failure (iOS SendFailureView)

@Composable
private fun SendFailureScreen(message: String, onTryAgain: () -> Unit, onDone: () -> Unit) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Box(
                Modifier.size(96.dp).background(TaliseColors.danger.copy(alpha = 0.15f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.PriorityHigh, contentDescription = null, tint = TaliseColors.danger, modifier = Modifier.size(36.dp))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Send failed", style = TaliseType.heading(34.sp, FontWeight.Medium), letterSpacing = (-1).sp, color = TaliseColors.fg)
                Text(
                    "No funds moved. You can try again or close this.",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp),
                )
                if (message.isNotBlank()) {
                    Text(
                        message,
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 32.dp).padding(top = 4.dp),
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier.fillMaxWidth().height(56.dp).background(TaliseColors.fg, CircleShape).clickable { onTryAgain() },
                contentAlignment = Alignment.Center,
            ) {
                Text("Try again", style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.bg)
            }
            GlassCapsuleButton(title = "Done", onClick = onDone)
        }
    }
}

// MARK: - Shared chrome

@Composable
private fun GlassCircleButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    tint: Color = TaliseColors.fgMuted,
) {
    Box(
        Modifier.size(38.dp).background(TaliseColors.surface2, CircleShape).border(1.dp, TaliseColors.line, CircleShape).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
    }
}

/** Bright-green primary capsule with dark ink (iOS `Review` / `Next` buttons). */
@Composable
private fun CapsuleButton(title: String, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
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
            color = if (enabled) InkOnGreen else TaliseColors.fgDim,
        )
    }
}

/** Secondary "Done" capsule, surface2 + hairline (iOS `glassCapsule`). */
@Composable
private fun GlassCapsuleButton(title: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(TaliseColors.surface2, CircleShape)
            .border(1.dp, TaliseColors.line, CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(title, style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.fg)
    }
}
