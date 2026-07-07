package io.talise.app.feature.invoices

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.util.Locale

/**
 * Open + pay an invoice by id (the public /i/<id> flow), ported from iOS
 * `PayInvoiceView`. Loads the invoice, sends the USDsui to the issuer's
 * address over the normal send rail, then settles it trustlessly with the
 * resulting digest.
 */
@Composable
fun PayInvoiceScreen(invoiceId: String, onDone: () -> Unit) {
    val vm: PayInvoiceViewModel = viewModel()
    val ui by vm.ui.collectAsStateWithLifecycle()

    LaunchedEffect(invoiceId) { vm.load(invoiceId) }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp)
            .padding(top = 18.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Eyebrow("Pay invoice")
        when {
            ui.paid -> PaidState(onDone)
            ui.loading -> Box(Modifier.fillMaxWidth().padding(top = 60.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = TaliseColors.fg, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            }
            ui.invoice != null -> Detail(
                inv = ui.invoice!!,
                paying = ui.paying,
                error = ui.error,
                onPay = { vm.pay(invoiceId) },
            )
            ui.error != null -> Text(
                ui.error!!,
                style = TaliseType.body(13.sp),
                color = TaliseColors.fgMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 60.dp),
            )
        }
    }
}

@Composable
private fun Detail(
    inv: PublicInvoiceDTO,
    paying: Boolean,
    error: String?,
    onPay: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "$" + String.format(Locale.US, "%,.2f", inv.amountUsd),
                style = TaliseType.display(34.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
            inv.issuer?.let { issuer ->
                Text(
                    "To ${issuer.name ?: issuer.handle}",
                    style = TaliseType.body(14.sp),
                    color = TaliseColors.fgMuted,
                )
            }
            if (!inv.memo.isNullOrEmpty()) {
                Text(
                    inv.memo,
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }
        }
        error?.let { err ->
            Text(err, style = TaliseType.body(12.sp), color = TaliseColors.danger)
        }
        if (inv.status == "open") {
            SlideToConfirm(
                title = if (paying) "Paying…" else "Slide to pay",
                onConfirm = { onPay() },
                enabled = !paying && inv.issuer != null,
                modifier = Modifier.alpha(if (paying) 0.5f else 1f),
            )
        } else {
            Text(
                "This invoice is ${inv.status}.",
                style = TaliseType.body(13.sp),
                color = TaliseColors.fgMuted,
            )
        }
    }
}

@Composable
private fun PaidState(onDone: () -> Unit) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(30.dp))
        Box(
            Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(TaliseColors.greenMint.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Verified,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(56.dp),
            )
        }
        Text(
            "Invoice paid",
            style = TaliseType.heading(22.sp, FontWeight.Medium),
            color = TaliseColors.fg,
        )
        LiquidGlassButton(
            title = "Done",
            onClick = onDone,
            tint = TaliseColors.greenMint,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}
