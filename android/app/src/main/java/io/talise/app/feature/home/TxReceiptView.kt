package io.talise.app.feature.home

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.ArrowOutward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Eco
import androidx.compose.material.icons.filled.SouthWest
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.IosShare
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.core.model.OfframpInfo
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * On-chain receipt — appears when the user taps an activity row. Port of iOS
 * `TxReceiptView`: direction badge, amount in USD with the USDsui leg below,
 * details card, then View Receipt / View on SuiVision / Copy digest actions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TxReceiptView(entry: ActivityEntryDTO) {
    val uriHandler = LocalUriHandler.current
    val clipboard = LocalClipboardManager.current
    var digestCopied by remember { mutableStateOf(false) }
    var showShareableReceipt by remember { mutableStateOf(false) }

    LaunchedEffect(digestCopied) {
        if (digestCopied) {
            delay(1500)
            digestCopied = false
        }
    }

    val category = receiptCategoryOf(entry)
    val badgeBg: Color = when (category) {
        ReceiptCategory.SENT, ReceiptCategory.CASHOUT -> TaliseColors.badgeSent
        ReceiptCategory.RECEIVED, ReceiptCategory.WITHDRAW -> TaliseColors.badgeReceived
        ReceiptCategory.INVEST -> TaliseColors.accent.copy(alpha = 0.22f)
    }
    val badgeFg: Color = when (category) {
        ReceiptCategory.SENT, ReceiptCategory.CASHOUT -> HomeReceiptSentFg
        ReceiptCategory.RECEIVED, ReceiptCategory.WITHDRAW -> HomeReceivedGreen
        ReceiptCategory.INVEST -> TaliseColors.accent
    }
    val badgeIcon: ImageVector = when (category) {
        ReceiptCategory.SENT -> Icons.Filled.ArrowOutward
        ReceiptCategory.CASHOUT -> Icons.Filled.AccountBalance
        ReceiptCategory.RECEIVED -> Icons.Filled.SouthWest
        ReceiptCategory.INVEST -> Icons.Filled.Eco
        ReceiptCategory.WITHDRAW -> Icons.Filled.Eco
    }
    val headerLabel = receiptHeaderLabel(entry, category)
    val primaryAmount = receiptPrimaryAmount(entry)

    Column(
        Modifier
            .fillMaxWidth()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(top = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(26.dp),
    ) {
        // ── Direction badge ──────────────────────────────────────────────
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.padding(top = 16.dp),
        ) {
            Box(
                Modifier.size(68.dp).clip(CircleShape).background(badgeBg),
                contentAlignment = Alignment.Center,
            ) {
                Icon(badgeIcon, contentDescription = null, tint = badgeFg, modifier = Modifier.size(24.dp))
            }
            Text(
                headerLabel,
                style = TaliseType.mono(8.sp),
                letterSpacing = 2.0.sp,
                color = TaliseColors.fgDim,
            )
        }

        // ── Amount ───────────────────────────────────────────────────────
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                primaryAmount,
                style = TaliseType.display(40.sp, FontWeight.Medium),
                letterSpacing = (-1.4).sp,
                color = if (category == ReceiptCategory.CASHOUT) HomeSentRed else TaliseColors.fg,
                maxLines = 1,
            )
            entry.amountUsdsui?.let { usdsui ->
                Text(
                    "${usd2(abs(usdsui))} USDsui",
                    style = TaliseType.mono(12.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }
        }

        // ── Details card ─────────────────────────────────────────────────
        ReceiptDetailsCard(entry, category)

        // ── Actions ──────────────────────────────────────────────────────
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // PRIMARY — the Talise receipt the user can save / share as an image.
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.fg)
                    .clickable { showShareableReceipt = true },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Description, contentDescription = null, tint = TaliseColors.bg, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(8.dp))
                Text("View Receipt", style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.bg)
            }
            // SECONDARY — the canonical on-chain record on SuiVision.
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2)
                    .clickable { uriHandler.openUri("https://suivision.xyz/txblock/${entry.digest}") },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = TaliseColors.fg, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(8.dp))
                Text("View on SuiVision", style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.fg)
            }
            // TERTIARY — quiet copy-digest text action.
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(36.dp)
                    .clickable {
                        clipboard.setText(AnnotatedString(entry.digest))
                        digestCopied = true
                    },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (digestCopied) Icons.Filled.Check else Icons.Filled.ContentCopy,
                    contentDescription = null,
                    tint = TaliseColors.fgMuted,
                    modifier = Modifier.size(12.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    if (digestCopied) "Copied" else "Copy digest",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }
        }

        Spacer(Modifier.height(24.dp))
    }

    if (showShareableReceipt) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { showShareableReceipt = false },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
        ) {
            ShareableReceiptSheet(
                headerLabel = headerLabel,
                primaryAmount = primaryAmount,
                usdsuiLine = entry.amountUsdsui?.let { "${usd2(abs(it))} USDsui" },
                rows = buildReceiptRows(entry, category),
                digest = entry.digest,
                isCashout = category == ReceiptCategory.CASHOUT,
                onClose = { showShareableReceipt = false },
            )
        }
    }
}

// ── Category (receipt-local, mirrors iOS TxReceiptView.Category) ────────────

private enum class ReceiptCategory { SENT, RECEIVED, INVEST, WITHDRAW, CASHOUT }

private fun receiptCategoryOf(e: ActivityEntryDTO): ReceiptCategory = when {
    e.offramp != null -> ReceiptCategory.CASHOUT
    e.direction == "received" -> ReceiptCategory.RECEIVED
    e.direction == "invest" -> ReceiptCategory.INVEST
    e.direction == "withdraw" -> ReceiptCategory.WITHDRAW
    else -> ReceiptCategory.SENT
}

private fun receiptHeaderLabel(e: ActivityEntryDTO, category: ReceiptCategory): String = when (category) {
    ReceiptCategory.SENT -> "SENT"
    ReceiptCategory.CASHOUT -> "CASH OUT"
    ReceiptCategory.RECEIVED -> "RECEIVED"
    ReceiptCategory.INVEST ->
        e.venue?.takeIf { it.isNotEmpty() }?.let { "INVESTED IN ${displayVenueName(it).uppercase()}" } ?: "INVESTED"
    ReceiptCategory.WITHDRAW ->
        e.venue?.takeIf { it.isNotEmpty() }?.let { "WITHDREW FROM ${displayVenueName(it).uppercase()}" } ?: "WITHDREW"
}

private fun receiptPrimaryAmount(e: ActivityEntryDTO): String {
    // U+202F narrow no-break space between sign and currency symbol so the
    // minus stroke never kisses the currency glyph at hero size.
    e.offramp?.let { off -> return "- " + ngn(off.amountNgn) }
    val inflow = e.direction == "received" || e.direction == "withdraw"
    val prefix = if (inflow) "+ " else "- "
    e.otherCoin?.let { return "$prefix${coinDisplayAmount(it)} ${it.symbol}" }
    e.amountUsdsui?.let { return prefix + usd2(abs(it)) }
    e.amountSui?.let { return prefix + String.format(java.util.Locale.US, "%.4f SUI", abs(it)) }
    return "$prefix-"
}

// ── Details card ────────────────────────────────────────────────────────────

@Composable
private fun ReceiptDetailsCard(entry: ActivityEntryDTO, category: ReceiptCategory) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(TaliseColors.surface)
            .padding(vertical = 4.dp),
    ) {
        val off = entry.offramp
        if (off != null) {
            // CASH-OUT body: destination bank, USDsui debited, FX rate,
            // disbursement status, date, digest.
            ReceiptRow("To", cashOutDestination(off))
            ReceiptDivider()
            entry.amountUsdsui?.let { usd ->
                ReceiptRow("You sent", "${usd2(abs(usd))} USDsui")
                ReceiptDivider()
            }
            ReceiptRow("Rate", "$1 = ${ngn(off.rate)}")
            ReceiptDivider()
            ReceiptRow("Status", cashOutStatusLabel(off.status))
            ReceiptDivider()
            ReceiptRow("Date", receiptDate(entry.timestampMs))
            ReceiptDivider()
            ReceiptRow("Digest", shortDigest(entry.digest), mono = true)
        } else {
            val hasName = entry.counterpartyName?.isNotEmpty() == true
            when (category) {
                ReceiptCategory.SENT, ReceiptCategory.CASHOUT ->
                    ReceiptRow("To", counterpartyOrAddress(entry), mono = !hasName)
                ReceiptCategory.RECEIVED ->
                    ReceiptRow("From", counterpartyOrAddress(entry), mono = !hasName)
                ReceiptCategory.INVEST, ReceiptCategory.WITHDRAW ->
                    ReceiptRow("Venue", entry.venue?.let { displayVenueName(it) } ?: "-")
            }
            // Round-up save leg — only on sends that bundled an auto-save.
            val save = entry.roundupUsdsui ?: 0.0
            if (save > 0) {
                ReceiptDivider()
                ReceiptRow("Saved", "+${usd2(save)}")
            }
            ReceiptDivider()
            ReceiptRow("Date", receiptDate(entry.timestampMs))
            ReceiptDivider()
            ReceiptRow("Network", "Sui Mainnet")
            ReceiptDivider()
            ReceiptRow("Digest", shortDigest(entry.digest), mono = true)
        }
    }
}

private fun cashOutDestination(off: OfframpInfo): String {
    val bank = off.bankName?.takeIf { it.isNotEmpty() } ?: "Bank"
    val last4 = off.accountLast4
    return if (!last4.isNullOrEmpty()) "$bank ••••$last4" else bank
}

private fun counterpartyOrAddress(e: ActivityEntryDTO): String {
    e.counterpartyName?.let { if (it.isNotEmpty()) return it }
    e.counterparty?.let { return shortAddress(it) }
    return "-"
}

@Composable
private fun ReceiptRow(label: String, value: String, mono: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        Spacer(Modifier.weight(1f))
        Text(
            value,
            style = if (mono) TaliseType.mono(12.sp, FontWeight.Light) else TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ReceiptDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp)
            .height(1.dp)
            .background(Color.White.copy(alpha = 0.05f)),
    )
}

// ── Shareable receipt ───────────────────────────────────────────────────────

/** One label/value pair on the shareable receipt. */
internal data class ReceiptRowData(val label: String, val value: String, val mono: Boolean)

private fun buildReceiptRows(entry: ActivityEntryDTO, category: ReceiptCategory): List<ReceiptRowData> {
    entry.offramp?.let { off ->
        val rows = mutableListOf(ReceiptRowData("To", cashOutDestination(off), mono = false))
        entry.amountUsdsui?.let { usd ->
            rows.add(ReceiptRowData("You sent", "${usd2(abs(usd))} USDsui", mono = false))
        }
        rows.add(ReceiptRowData("Rate", "$1 = ${ngn(off.rate)}", mono = false))
        rows.add(ReceiptRowData("Status", cashOutStatusLabel(off.status), mono = false))
        rows.add(ReceiptRowData("Date", receiptDate(entry.timestampMs), mono = false))
        rows.add(ReceiptRowData("Network", "Sui Mainnet", mono = false))
        return rows
    }
    val hasName = entry.counterpartyName?.isNotEmpty() == true
    val rows = mutableListOf<ReceiptRowData>()
    when (category) {
        ReceiptCategory.RECEIVED -> rows.add(ReceiptRowData("From", counterpartyOrAddress(entry), mono = !hasName))
        ReceiptCategory.INVEST, ReceiptCategory.WITHDRAW ->
            rows.add(ReceiptRowData("Venue", entry.venue?.let { displayVenueName(it) } ?: "-", mono = false))
        ReceiptCategory.SENT, ReceiptCategory.CASHOUT ->
            rows.add(ReceiptRowData("To", counterpartyOrAddress(entry), mono = !hasName))
    }
    val save = entry.roundupUsdsui ?: 0.0
    if (save > 0) rows.add(ReceiptRowData("Saved", "+${usd2(save)}", mono = false))
    rows.add(ReceiptRowData("Date", receiptDate(entry.timestampMs), mono = false))
    rows.add(ReceiptRowData("Network", "Sui Mainnet", mono = false))
    return rows
}

/**
 * A branded, downloadable/shareable receipt. Renders the card to an image
 * (Compose GraphicsLayer capture) and offers it via the system share sheet.
 */
@Composable
private fun ShareableReceiptSheet(
    headerLabel: String,
    primaryAmount: String,
    usdsuiLine: String?,
    rows: List<ReceiptRowData>,
    digest: String,
    isCashout: Boolean,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val graphicsLayer = rememberGraphicsLayer()

    Column(Modifier.fillMaxWidth().background(TaliseColors.bg)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(top = 18.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Receipt", style = TaliseType.heading(17.sp, FontWeight.Medium), color = TaliseColors.fg)
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Filled.Close,
                contentDescription = "Close",
                tint = TaliseColors.fgMuted,
                modifier = Modifier.size(14.dp).clickable { onClose() },
            )
        }

        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .width(340.dp)
                    .padding(vertical = 18.dp)
                    .drawWithContent {
                        graphicsLayer.record { this@drawWithContent.drawContent() }
                        drawLayer(graphicsLayer)
                    },
            ) {
                ShareableReceiptCard(
                    headerLabel = headerLabel,
                    primaryAmount = primaryAmount,
                    usdsuiLine = usdsuiLine,
                    rows = rows,
                    digest = digest,
                    isCashout = isCashout,
                )
            }
        }

        Row(
            Modifier
                .padding(horizontal = 22.dp)
                .padding(bottom = 22.dp)
                .fillMaxWidth()
                .height(52.dp)
                .clip(CircleShape)
                .background(TaliseColors.fg)
                .clickable {
                    scope.launch {
                        runCatching {
                            val bitmap = graphicsLayer.toImageBitmap().asAndroidBitmap()
                            shareReceiptImage(context, bitmap)
                        }
                    }
                },
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.IosShare, contentDescription = null, tint = TaliseColors.bg, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(8.dp))
            Text("Save / Share receipt", style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.bg)
        }
    }
}

/** Writes the rendered receipt PNG to MediaStore, then hands it to the share sheet. */
private fun shareReceiptImage(context: Context, bitmap: Bitmap) {
    val uri: Uri? = runCatching {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "talise-receipt-${System.currentTimeMillis()}.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        }
        val inserted = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        inserted?.also { target ->
            context.contentResolver.openOutputStream(target)?.use { os ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, os)
            }
        }
    }.getOrNull()
    if (uri != null) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching { context.startActivity(Intent.createChooser(intent, "Talise receipt")) }
    }
}

/** The visual receipt itself — iOS `ShareableReceiptCard`. */
@Composable
private fun ShareableReceiptCard(
    headerLabel: String,
    primaryAmount: String,
    usdsuiLine: String?,
    rows: List<ReceiptRowData>,
    digest: String,
    isCashout: Boolean,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(TaliseColors.surface)
            .border(1.dp, Color.White.copy(alpha = 0.06f), RoundedCornerShape(28.dp)),
    ) {
        // Brand header + amount
        Column(
            Modifier.fillMaxWidth().padding(top = 30.dp, bottom = 22.dp).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(TaliseColors.greenMint))
                Text(
                    "talise",
                    style = TaliseType.heading(20.sp, FontWeight.SemiBold),
                    letterSpacing = (-0.5).sp,
                    color = TaliseColors.fg,
                )
            }
            Text(
                headerLabel.uppercase(),
                style = TaliseType.mono(11.sp),
                letterSpacing = 2.sp,
                color = TaliseColors.fgDim,
            )
            Text(
                primaryAmount,
                style = TaliseType.display(34.sp, FontWeight.Medium),
                letterSpacing = (-1.2).sp,
                color = if (isCashout) HomeSentRed else TaliseColors.fg,
                maxLines = 1,
            )
            if (usdsuiLine != null) {
                Text(usdsuiLine, style = TaliseType.mono(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            }
        }

        // Perforation line
        Canvas(Modifier.fillMaxWidth().padding(horizontal = 20.dp).height(1.dp)) {
            drawLine(
                color = Color.White.copy(alpha = 0.10f),
                start = androidx.compose.ui.geometry.Offset(0f, size.height / 2),
                end = androidx.compose.ui.geometry.Offset(size.width, size.height / 2),
                strokeWidth = size.height,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
            )
        }

        // Detail rows
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 6.dp)) {
            rows.forEachIndexed { i, r ->
                Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(r.label, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                    Spacer(Modifier.weight(1f))
                    Text(
                        r.value,
                        style = if (r.mono) TaliseType.mono(12.sp, FontWeight.Light) else TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fg,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (i < rows.size - 1) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.05f)))
                }
            }
        }

        // Digest
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 10.dp, bottom = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "TRANSACTION DIGEST",
                style = TaliseType.mono(9.sp),
                letterSpacing = 1.5.sp,
                color = TaliseColors.fgDim,
            )
            Text(
                digest,
                style = TaliseType.mono(10.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Footer
        Row(
            Modifier.fillMaxWidth().padding(bottom = 24.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Verified, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(11.dp))
            Spacer(Modifier.width(6.dp))
            Text(
                "Verified on Sui Mainnet • talise.io",
                style = TaliseType.body(11.sp, FontWeight.Light),
                color = TaliseColors.fgDim,
            )
        }
    }
}
