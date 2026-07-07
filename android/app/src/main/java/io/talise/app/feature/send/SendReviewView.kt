package io.talise.app.feature.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.session.AppSession
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * Step 3: read-only confirm — iOS `SendReviewView`. Shows the from/to
 * cards, the "no network fee" footnote (or the locked cross-border quote
 * block), and a slide-to-send that kicks off the sponsor-execute.
 */
@Composable
fun SendReviewView(
    draft: SendDraft,
    onConfirm: suspend () -> Unit,
    onBack: () -> Unit,
) {
    // Locked cross-border quote. Null for same-currency sends — those keep
    // the original generic fee line and behave exactly as before.
    var quote by remember { mutableStateOf<ClientCrossBorderQuote?>(null) }
    var secondsLeft by remember { mutableIntStateOf(0) }

    // Lock a fresh quote on appear; 1Hz tick drives the "rate held" countdown
    // and re-locks at expiry so a stale rate never sits committable.
    LaunchedEffect(Unit) {
        quote = draft.makeCrossBorderQuote()
        secondsLeft = quote?.secondsRemaining() ?: 0
        while (true) {
            delay(1000)
            val q = quote ?: continue
            val remaining = q.secondsRemaining()
            if (remaining <= 0) {
                quote = draft.makeCrossBorderQuote()
                secondsLeft = quote?.secondsRemaining() ?: 0
            } else {
                secondsLeft = remaining
            }
        }
    }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Header — just the back chevron; the big title carries the screen.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlassCircleButton(Icons.Filled.ChevronLeft, onClick = onBack, tint = TaliseColors.fg)
            Spacer(Modifier.weight(1f))
        }

        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Review send",
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.5).sp,
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            )

            FromCard(draft)
            // Arrow
            Box(
                Modifier
                    .size(32.dp)
                    .background(TaliseColors.surface2, androidx.compose.foundation.shape.CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.ArrowDownward,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(15.dp),
                )
            }
            ToCard(draft)

            // Cross-border: transparent locked-quote block.
            // Same-currency: the original "no network fee" line.
            val q = quote
            if (q != null) {
                LockedQuoteBlock(q, secondsLeft, modifier = Modifier.padding(top = 4.dp))
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Filled.Verified,
                        contentDescription = null,
                        tint = TaliseColors.greenMint,
                        modifier = Modifier.size(11.dp),
                    )
                    Spacer(Modifier.size(6.dp))
                    Text(
                        "Network fee \$0.00, Talise auto-routed the rail and sponsored the gas.",
                        style = TaliseType.mono(11.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }

        Column(
            Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SlideToConfirm(
                title = "Slide to send",
                tint = TaliseColors.greenMint,
                onConfirm = { onConfirm() },
            )
        }
    }
}

@Composable
private fun FromCard(draft: SendDraft) {
    val myHandle = AppSession.currentUser?.handle ?: "you"
    Column(
        Modifier
            .fillMaxWidth()
            .background(TaliseColors.surface, RoundedCornerShape(22.dp))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Eyebrow("From $myHandle")
        Row {
            Text(
                draft.currency.symbol,
                style = TaliseType.heading(28.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                modifier = Modifier.alignByBaseline(),
            )
            Spacer(Modifier.size(4.dp))
            Text(
                draft.rawAmount.ifEmpty { "0" },
                style = TaliseType.heading(40.sp, FontWeight.Medium),
                letterSpacing = (-1).sp,
                color = TaliseColors.fg,
                maxLines = 1,
                modifier = Modifier.alignByBaseline(),
            )
        }
        Text(
            "${sendFmt(draft.amountUsdsui, 2)} USDsui",
            style = TaliseType.mono(12.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
        )
    }
}

@Composable
private fun ToCard(draft: SendDraft) {
    val r = draft.resolved
    val shortAddr = r?.address?.let { shortAddress(it) } ?: "-"
    val primary = r?.displayName
        ?.takeIf { it.isNotEmpty() && it != r.address }
        ?: shortAddr
    Column(
        Modifier
            .fillMaxWidth()
            .background(TaliseColors.surface, RoundedCornerShape(22.dp))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Eyebrow("To")
        Text(
            primary,
            style = TaliseType.heading(20.sp, FontWeight.Medium),
            color = TaliseColors.fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            shortAddr,
            style = TaliseType.mono(11.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
        )
        val sends = draft.previousSendsToRecipient
        if (sends != null && sends > 0) {
            Text(
                if (sends == 1) "1 previous send" else "$sends previous sends",
                style = TaliseType.mono(11.sp, FontWeight.Light),
                color = TaliseColors.greenMint,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/**
 * Transparent quote card shown instead of the generic fee line when the
 * recipient is paid in a different currency: the locked rate, the spread as
 * an EXPLICIT fee, the total debit, the guaranteed receive amount, and a
 * "rate held Ns" countdown.
 */
@Composable
private fun LockedQuoteBlock(
    q: ClientCrossBorderQuote,
    secondsLeft: Int,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(TaliseColors.surface, RoundedCornerShape(22.dp))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Locked rate + countdown header.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier
                    .glassCapsule()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon(
                    Icons.Filled.Lock,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(10.dp),
                )
                Text(
                    q.rateLine,
                    style = TaliseType.mono(12.sp, FontWeight.Normal),
                    color = TaliseColors.fg,
                )
            }
            Spacer(Modifier.weight(1f))
            Text(
                "Rate held ${secondsLeft}s",
                style = TaliseType.mono(11.sp, FontWeight.Light),
                color = if (secondsLeft <= 5) TaliseColors.danger else TaliseColors.fgMuted,
            )
        }

        LiquidGlassDivider()

        QuoteRow(
            label = "Fee (${spreadBpsLabel(q.spreadBps)})",
            value = sendSymbolic(q.spreadLocal, q.senderCurrency, 2),
        )
        QuoteRow(
            label = "Total debit",
            value = sendSymbolic(q.senderDebitLocal, q.senderCurrency, 2),
        )

        LiquidGlassDivider()

        // The guaranteed receive amount — the headline of the block.
        Row(Modifier.fillMaxWidth()) {
            Text(
                "Recipient gets",
                style = TaliseType.body(13.sp, FontWeight.Normal),
                color = TaliseColors.fgMuted,
                modifier = Modifier.alignByBaseline(),
            )
            Spacer(Modifier.weight(1f))
            Text(
                SendCurrencies.recipientSymbolic(q.recipientReceiveLocal, q.recipientCurrency),
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                color = TaliseColors.greenMint,
                modifier = Modifier.alignByBaseline(),
            )
        }

        Text(
            "Locked at the held rate. Talise moves this as digital dollars, 1:1.",
            style = TaliseType.mono(10.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun QuoteRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            style = TaliseType.body(13.sp, FontWeight.Normal),
            color = TaliseColors.fgMuted,
        )
        Spacer(Modifier.weight(1f))
        Text(
            value,
            style = TaliseType.mono(13.sp, FontWeight.Normal),
            color = TaliseColors.fg,
        )
    }
}

/** "0.25%" style label for the spread basis points. */
internal fun spreadBpsLabel(spreadBps: Int): String {
    val pct = spreadBps.toDouble() / 100.0
    val body = if (pct % 1.0 == 0.0) pct.toInt().toString() else {
        // Up to 2 fraction digits, trailing zeros trimmed.
        String.format(java.util.Locale.US, "%.2f", pct).trimEnd('0').trimEnd('.')
    }
    return "$body%"
}
