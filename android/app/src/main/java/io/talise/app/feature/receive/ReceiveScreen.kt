package io.talise.app.feature.receive

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.core.model.UserDTO
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.util.Locale

/**
 * Receive ("Get paid"), a faithful port of iOS `ReceiveView`.
 *
 * Shows the user's @handle (or short address), a scannable QR, and copy/share
 * affordances. An optional amount field turns the plain receive code into a
 * payment REQUEST link (`talise://pay/<handle>?amount=` or `sui:<address>?amount=`).
 * Copy/Share emit the request link when an amount is set, else the raw address.
 */
@Composable
fun ReceiveScreen(onClose: () -> Unit) {
    val viewModel: ReceiveViewModel = viewModel()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    val user by viewModel.user.collectAsStateWithLifecycle()
    val amountText by viewModel.amountText.collectAsStateWithLifecycle()
    val copied by viewModel.copied.collectAsStateWithLifecycle()

    val address = user?.suiAddress ?: ""
    // Bare on-chain handle (e.g. "alice"), null until the user claims one.
    val taliseHandle = user?.taliseHandle?.takeIf { it.isNotEmpty() }

    // Parsed requested amount in USD, if a positive value was entered.
    val requestedAmount = amountText.trim().toDoubleOrNull()?.takeIf { it > 0 }

    // What the QR encodes. With an amount -> a payable request link (handle-first
    // so the payer sees the @handle; address fallback). Without an amount -> the
    // plain `sui:<address>` receive code that external Sui wallets also understand.
    val qrContent = when {
        requestedAmount != null -> {
            val a = formatAmount(requestedAmount)
            if (taliseHandle != null) "talise://pay/$taliseHandle?amount=$a" else "sui:$address?amount=$a"
        }
        else -> "sui:$address"
    }
    // What Copy/Share emit, the request link when an amount is set, else the raw address.
    val shareContent = if (requestedAmount != null) qrContent else address

    // Receive card title. Prefers the on-chain handle; if the user hasn't claimed
    // one yet we show the canonical short address so the QR card still identifies
    // the wallet (the QR encodes the full address regardless).
    val handleLine = user?.let { displayHandle(it) ?: short(it.suiAddress ?: "") } ?: "your wallet"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        // Header
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "Receive",
                style = TaliseType.mono(8.sp),
                letterSpacing = 1.5.sp,
                color = TaliseColors.fgDim,
            )
            Text(
                "Get paid",
                style = TaliseType.heading(28.sp, FontWeight.Medium),
                letterSpacing = (-1).sp,
                color = TaliseColors.fg,
            )
        }

        // Optional "request a specific amount" input. Empty -> the card is a
        // plain receive code; a value turns it into a payment request.
        AmountField(
            amountText = amountText,
            onAmountChange = viewModel::onAmountChange,
            onClear = viewModel::clearAmount,
            modifier = Modifier.padding(horizontal = 24.dp),
        )

        // QR card
        QrCard(
            handleLine = handleLine,
            requestedAmount = requestedAmount,
            qrContent = qrContent,
            address = address,
            modifier = Modifier.padding(horizontal = 24.dp),
        )

        // Actions
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ActionButton(
                icon = Icons.Filled.ContentCopy,
                checked = copied,
                label = when {
                    copied -> "Copied"
                    requestedAmount != null -> "Copy link"
                    else -> "Copy address"
                },
                primary = false,
                modifier = Modifier.weight(1f),
            ) {
                clipboard.setText(AnnotatedString(shareContent))
                viewModel.markCopied()
            }
            ActionButton(
                icon = Icons.Filled.IosShare,
                checked = false,
                label = if (requestedAmount != null) "Share request" else "Share",
                primary = true,
                modifier = Modifier.weight(1f),
            ) {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, shareContent)
                }
                context.startActivity(Intent.createChooser(intent, null))
            }
        }

        Spacer(Modifier.height(40.dp))
    }
}

/**
 * iOS `User.displayHandle()` — canonical display only when the user owns a
 * resolvable handle, else null so callers can fall back to the short address.
 * (iOS also honors `businessHandle` for business accounts; UserDTO does not
 * carry that field yet.)
 */
private fun displayHandle(user: UserDTO): String? {
    val h = user.taliseHandle
    if (!h.isNullOrEmpty()) return "$h@talise.sui"
    return null
}

@Composable
private fun AmountField(
    amountText: String,
    onAmountChange: (String) -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val focusManager = LocalFocusManager.current
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "Request a specific amount (optional)",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(TaliseColors.surface2)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "$",
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                color = TaliseColors.fgSubtle,
            )
            Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (amountText.isEmpty()) {
                    Text(
                        "0.00",
                        style = TaliseType.heading(20.sp, FontWeight.Medium),
                        color = TaliseColors.fgDim,
                    )
                }
                BasicTextField(
                    value = amountText,
                    onValueChange = onAmountChange,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TaliseType.heading(20.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (amountText.isNotEmpty()) {
                Icon(
                    Icons.Filled.Cancel,
                    contentDescription = "Clear",
                    tint = TaliseColors.fgDim,
                    modifier = Modifier
                        .size(20.dp)
                        .clip(RoundedCornerShape(50))
                        .clickable {
                            onClear()
                            focusManager.clearFocus()
                        },
                )
            }
        }
    }
}

@Composable
private fun QrCard(
    handleLine: String,
    requestedAmount: Double?,
    qrContent: String,
    address: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(TaliseColors.surface)
            .padding(vertical = 30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text(
            handleLine,
            style = TaliseType.heading(20.sp, FontWeight.Medium),
            letterSpacing = (-0.8).sp,
            color = TaliseColors.fgSubtle,
        )

        if (requestedAmount != null) {
            Text(
                "Requesting $${formatAmount(requestedAmount)}",
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = TaliseColors.accent,
            )
        }

        // 220x220 QR on an 18-padded white tile, matching iOS `QRView`.
        Box(
            modifier = Modifier
                .size(220.dp + 36.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.White)
                .padding(18.dp),
            contentAlignment = Alignment.Center,
        ) {
            QrView(content = qrContent, modifier = Modifier.size(220.dp))
        }

        Text(
            short(address),
            style = TaliseType.mono(13.sp, FontWeight.Light),
            color = TaliseColors.fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * iOS `QRView` — renders [content] as a QR bitmap scaled without interpolation
 * (one pixel per module, nearest-neighbor upscale); gray fill if encoding fails.
 */
@Composable
private fun QrView(content: String, modifier: Modifier = Modifier) {
    val bitmap = remember(content) {
        QrCode.encode(content)?.let { modules ->
            val n = modules.size
            val pixels = IntArray(n * n)
            for (y in 0 until n) {
                for (x in 0 until n) {
                    pixels[y * n + x] = if (modules[y][x]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
                }
            }
            Bitmap.createBitmap(pixels, n, n, Bitmap.Config.ARGB_8888).asImageBitmap()
        }
    }
    if (bitmap != null) {
        Image(
            bitmap = bitmap,
            contentDescription = "Receive QR code",
            contentScale = ContentScale.Fit,
            filterQuality = FilterQuality.None,
            modifier = modifier,
        )
    } else {
        Box(modifier.background(Color.Gray))
    }
}

@Composable
private fun ActionButton(
    icon: ImageVector,
    checked: Boolean,
    label: String,
    primary: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val fg = if (primary) TaliseColors.bg else TaliseColors.fg
    Row(
        modifier = modifier
            .height(48.dp)
            .clip(RoundedCornerShape(50))
            .background(if (primary) TaliseColors.fg else TaliseColors.surface2)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(
            if (checked) Icons.Filled.Check else icon,
            contentDescription = null,
            tint = fg,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.size(8.dp))
        Text(
            label,
            style = TaliseType.heading(14.sp, FontWeight.Medium),
            color = fg,
        )
    }
}

/** Two-decimal USD string, mirroring iOS `String(format: "%.2f", amt)` (C locale, always "."). */
private fun formatAmount(v: Double): String = String.format(Locale.US, "%.2f", v)

/** Middle-truncated address, mirroring iOS `short(_:)`. */
private fun short(a: String): String {
    if (a.length <= 14) return a
    return a.take(10) + "…" + a.takeLast(8)
}
