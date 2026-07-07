package io.talise.app.feature.send

import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Step 5: success — iOS `SendCompleteView`. Renders the Figma "Successful
 * PopUp" celebration via [SuccessfulTxView]: the sent amount in the user's
 * currency, "gas cost = 0, money arrives < 1s", and Share Receipt + Done.
 */
@Composable
fun SendCompleteView(
    draft: SendDraft,
    onDone: () -> Unit,
) {
    val context = LocalContext.current

    // Amount in the user's display currency (USDsui is 1:1 USD).
    val amountText = sendLocal2(draft.success?.usdsui ?: draft.amountUsdsui)
    // Spend + Save pop: the server-blessed round-up amount that auto-saved
    // with this send (0 → no pop).
    val savedUsd = draft.success?.savedUsd ?: 0.0
    val crossCurrency = draft.isCrossCurrency

    // Headline: same-currency wallet sends keep the default celebration;
    // cross-border fiat-payout sends say "Sent" to mark the chain leg as
    // final WITHOUT overclaiming bank delivery.
    val title = if (crossCurrency) "Sent" else "Transaction Successful!"
    val subtitle = if (crossCurrency) {
        val name = draft.success?.recipientDisplay ?: "their bank"
        "Sent, on its way to $name's bank"
    } else {
        "gas cost = 0, money arrives < 1s"
    }

    SuccessfulTxView(
        amountText = amountText,
        title = title,
        subtitle = subtitle,
        onShareReceipt = {
            // Share the on-chain explorer link via the system share sheet.
            // No-op without a digest (shouldn't happen — Complete is gated
            // on a real digest).
            val digest = draft.success?.digest
            if (!digest.isNullOrEmpty()) {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "https://suivision.xyz/txblock/$digest")
                }
                context.startActivity(Intent.createChooser(intent, null))
            }
        },
        onDone = onDone,
        savedText = if (savedUsd > 0) sendLocal2(savedUsd) else null,
        // Only same-currency wallet sends are chain-final end-to-end, so
        // only they carry the recipient display; cross-border passes null.
        recipientDisplay = if (crossCurrency) null else draft.success?.recipientDisplay,
    )
}
