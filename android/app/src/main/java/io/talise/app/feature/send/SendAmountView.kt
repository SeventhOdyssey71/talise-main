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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.SubdirectoryArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Step 1: enter an amount in the user's display currency — iOS
 * `SendAmountView`. Big centered amount, secondary USDsui-equivalent line,
 * "MAIN WALLET" pill, custom numpad. No keyboard.
 */
@Composable
fun SendAmountView(
    draft: SendDraft,
    onNext: () -> Unit,
    onCancel: () -> Unit,
) {
    val balance by produceState<BalancesDTO?>(initialValue = null) {
        value = runCatching { ApiClient.api.balances() }.getOrNull()
    }

    val typedAmountUsdsui = run {
        val typed = draft.rawAmount.toDoubleOrNull() ?: 0.0
        if (typed <= 0) 0.0 else {
            val rate = SendFx.rate(draft.currency.code)
            if (rate > 0) typed / rate else 0.0
        }
    }
    val exceedsBalance = run {
        val have = balance?.usdsui
        have != null && typedAmountUsdsui > 0 && typedAmountUsdsui > have
    }
    val canAdvance = typedAmountUsdsui > 0 && !exceedsBalance

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Header
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlassCircleButton(Icons.Filled.Close, onClick = onCancel, iconSize = 15.dp)
            Spacer(Modifier.weight(1f))
            SendMicroLabel("Send", color = TaliseColors.fgMuted, kerning = 2.0)
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.size(38.dp))
        }

        Spacer(Modifier.weight(1f))

        // Amount block
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val display = displayAmountString(draft.rawAmount)
            // Symbol + number in ONE composed text so a width-driven
            // scale-down shrinks BOTH in lockstep. The symbol renders
            // smaller + muted; hierarchy comes from weight and color.
            val chars = display.length + draft.currency.symbol.length
            val scale = if (chars <= 8) 1f else (8f / chars).coerceAtLeast(0.4f)
            val amountText = buildAnnotatedString {
                withStyle(
                    SpanStyle(
                        fontSize = (56 * scale).sp,
                        fontWeight = FontWeight.Thin,
                        color = TaliseColors.fgMuted,
                    ),
                ) { append(draft.currency.symbol) }
                withStyle(
                    SpanStyle(fontSize = (56 * scale).sp, fontWeight = FontWeight.Thin),
                ) { append(" ") }
                withStyle(
                    SpanStyle(
                        fontSize = (72 * scale).sp,
                        fontWeight = FontWeight.Medium,
                        color = TaliseColors.fg,
                        letterSpacing = (-2).sp,
                    ),
                ) { append(display) }
            }
            Text(amountText, style = TaliseType.heading(72.sp, FontWeight.Medium), maxLines = 1)

            Text(
                "${sendFmt(typedAmountUsdsui, 2)} USDsui",
                style = TaliseType.mono(13.sp, FontWeight.Light),
                color = TaliseColors.fgDim,
            )

            // Cross-border only: show what the recipient actually receives
            // in THEIR currency. Hidden for same-currency sends.
            val receive = draft.liveRecipientReceiveLocal()
            if (receive != null) {
                Row(
                    Modifier.padding(top = 1.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(
                        Icons.Filled.SubdirectoryArrowRight,
                        contentDescription = null,
                        tint = TaliseColors.accent,
                        modifier = Modifier.size(10.dp),
                    )
                    Text(
                        "Recipient gets ${SendCurrencies.recipientSymbolic(receive.first, receive.second)}",
                        style = TaliseType.mono(12.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }
            }

            if (exceedsBalance) {
                SendMicroLabel(
                    "Over available balance",
                    color = TaliseColors.danger,
                    kerning = 1.5,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }

        Spacer(Modifier.weight(1f))

        // Wallet pill
        Row(
            Modifier
                .align(Alignment.CenterHorizontally)
                .padding(bottom = 18.dp)
                .glassCapsule()
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(6.dp).background(TaliseColors.greenMint, CircleShape))
            Text(
                "MAIN WALLET",
                style = TaliseType.mono(10.sp, FontWeight.Normal),
                letterSpacing = 1.5.sp,
                color = TaliseColors.fg,
            )
            val avail = balance?.usdsui?.let { sendLocal2(it) }
            if (avail != null) {
                Text("·", style = TaliseType.mono(10.sp, FontWeight.Light), color = TaliseColors.fgDim)
                Text(avail, style = TaliseType.mono(10.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            }
        }

        SendNumpad(
            value = draft.rawAmount,
            onValueChange = { draft.rawAmount = it },
            modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 12.dp),
        )

        CapsuleButton(
            title = "Review",
            enabled = canAdvance,
            onClick = {
                if (canAdvance) {
                    draft.amountUsdsui = typedAmountUsdsui
                    onNext()
                }
            },
            modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
        )
    }
}
