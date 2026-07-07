package io.talise.app.feature.scan

import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.R
import io.talise.app.core.model.RecipientResolution
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/** Mint-green celebration accent (iOS SuccessfulTxView / #B1F49A). */
private val Mint = Color(0xFFB1F49A)

/**
 * "Confirm Payment" bottom sheet presented after a successful Scan-to-Pay scan
 * resolves a recipient, an exact port of iOS `ConfirmPaymentSheet`: recipient
 * avatar + handle card, "Amount to pay" big figure + asset, "Available" line,
 * green Slide to Pay, Cancel.
 *
 * Execution REUSES the existing gasless send pipeline verbatim (the same path
 * `SendViewModel` runs): sponsor-prepare → local zkLogin sign → gasless-submit.
 * On slide-complete we run that, then swap in the success celebration. Nothing
 * about the send rail is re-implemented here, only the surface.
 */
@Composable
fun ConfirmPaymentSheet(
    /** The resolved recipient, address + display identity. Resolved by the scanner. */
    recipient: RecipientResolution,
    /** Amount the QR carried (USDsui / USD), if any. Seeds the editable field. */
    scannedAmount: Double?,
    /** Called after a successful send + Done so the scanner can tear the whole surface down. */
    onPaid: () -> Unit,
    /** Cancel taps, dismisses this sheet back to the live viewfinder. */
    onCancel: () -> Unit,
    vm: ConfirmPaymentViewModel = viewModel(key = "confirm-${recipient.address}"),
) {
    val ui by vm.state.collectAsStateWithLifecycle()

    Box(Modifier.fillMaxWidth().background(TaliseColors.bg)) {
        val success = ui.success
        if (success != null) {
            // Reuse the EXISTING success celebration shown by the Send flow,
            // same component layout, same currency formatting.
            ScanPaySuccessView(
                amountText = usd2(success.usdsui),
                digest = success.digest,
                onDone = onPaid,
            )
        } else {
            ConfirmSheetBody(
                recipient = recipient,
                scannedAmount = scannedAmount,
                ui = ui,
                onPay = { amount -> vm.pay(amount, recipient) },
                onCancel = onCancel,
            )
        }
    }
}

// MARK: - Sheet body

@Composable
private fun ConfirmSheetBody(
    recipient: RecipientResolution,
    scannedAmount: Double?,
    ui: ConfirmPaymentViewModel.UiState,
    onPay: (Double) -> Unit,
    onCancel: () -> Unit,
) {
    /** Raw amount string. Seeded from the scanned amount when present. */
    var rawAmount by rememberSaveable { mutableStateOf("") }
    var slideReset by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current

    // Seed the amount once, iOS `seedAmount()`: a carried QR amount fills the
    // field (trailing zeros trimmed); otherwise focus it so the user can type.
    LaunchedEffect(Unit) {
        if (rawAmount.isEmpty() && scannedAmount != null && scannedAmount > 0) {
            rawAmount = formatSeed(scannedAmount)
        } else if (rawAmount.isEmpty()) {
            focusRequester.requestFocus()
        }
    }

    // Spring the knob back after a failed attempt (iOS `resetSlide` binding).
    LaunchedEffect(ui.resetTick) {
        if (ui.resetTick > 0) {
            slideReset = true
            delay(60)
            slideReset = false
        }
    }

    val amountUsdsui = rawAmount.replace(",", "").toDoubleOrNull()?.takeIf { it > 0 } ?: 0.0
    val availableUsdsui = ui.balance?.usdsui ?: 0.0
    val exceedsBalance = amountUsdsui > 0 && amountUsdsui > availableUsdsui
    val canPay = amountUsdsui > 0 && !exceedsBalance && !ui.sending

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            // Tap anywhere off the amount field to dismiss the keyboard and
            // expose the Slide to Pay control.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { focusManager.clearFocus() },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        GrabHandle(modifier = Modifier.padding(top = 10.dp))

        Text(
            "Confirm Payment",
            style = TaliseType.heading(20.sp, FontWeight.SemiBold),
            letterSpacing = (-0.5).sp,
            color = TaliseColors.fg,
            modifier = Modifier.padding(top = 18.dp),
        )

        RecipientCard(
            recipient = recipient,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 24.dp),
        )

        AmountBlock(
            rawAmount = rawAmount,
            onAmount = { new -> rawAmount = new.filter { it.isDigit() || it == '.' || it == ',' } },
            focusRequester = focusRequester,
            onDone = { focusManager.clearFocus() },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 26.dp),
        )

        AvailableLine(
            exceeds = exceedsBalance,
            available = usd2(availableUsdsui),
            modifier = Modifier.padding(top = 12.dp),
        )

        if (ui.errorMessage != null) {
            Text(
                ui.errorMessage,
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.danger,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(horizontal = 32.dp)
                    .padding(top = 12.dp),
            )
        }

        Spacer(Modifier.height(28.dp))

        SlideToConfirm(
            title = "Slide to Pay",
            tint = TaliseColors.accent,
            enabled = canPay,
            reset = slideReset,
            onConfirm = {
                focusManager.clearFocus()
                onPay(amountUsdsui)
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp),
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 14.dp, bottom = 18.dp)
                .height(44.dp)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    enabled = !ui.sending,
                ) { onCancel() },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "Cancel",
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = TaliseColors.fgMuted,
            )
        }
    }
}

@Composable
internal fun GrabHandle(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(width = 38.dp, height = 5.dp)
            .clip(CircleShape)
            .background(TaliseColors.fgDim.copy(alpha = 0.6f)),
    )
}

// MARK: - Recipient card

@Composable
private fun RecipientCard(recipient: RecipientResolution, modifier: Modifier = Modifier) {
    val handle = recipientHandle(recipient)
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(22.dp))
            .background(TaliseColors.surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Initials monogram in a green disc, derived from the resolved display
        // identity (handle initials, else the address tail).
        Box(
            modifier = Modifier
                .size(46.dp)
                .clip(CircleShape)
                .background(TaliseColors.accent.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                monogram(handle),
                style = TaliseType.heading(17.sp, FontWeight.SemiBold),
                color = TaliseColors.accent,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                handle,
                style = TaliseType.heading(16.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                maxLines = 1,
                // iOS truncates the middle; Compose 1.7 only ships tail ellipsis.
                overflow = TextOverflow.Ellipsis,
            )
            Text("Recipient", style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
        }
    }
}

// MARK: - Amount

@Composable
private fun AmountBlock(
    rawAmount: String,
    onAmount: (String) -> Unit,
    focusRequester: FocusRequester,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("Amount to pay", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("$", style = TaliseType.heading(38.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
            Box(contentAlignment = Alignment.Center) {
                if (rawAmount.isEmpty()) {
                    Text("0", style = TaliseType.heading(48.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
                }
                BasicTextField(
                    value = rawAmount,
                    onValueChange = onAmount,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { onDone() }),
                    textStyle = TextStyle(
                        fontFamily = TaliseType.sansFamily,
                        fontSize = 48.sp,
                        fontWeight = FontWeight.Medium,
                        color = TaliseColors.fg,
                        textAlign = TextAlign.Center,
                    ),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.focusRequester(focusRequester),
                )
            }
        }
        // The on-chain asset. Display currency is USD on Android, so the
        // figure IS the USDsui figure (iOS shows the ≈ line only for non-USD).
        Text("USDsui", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
    }
}

@Composable
private fun AvailableLine(exceeds: Boolean, available: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (exceeds) {
            Icon(Icons.Filled.ErrorOutline, null, tint = TaliseColors.danger, modifier = Modifier.size(11.dp))
            Text(
                "Not enough, available $available",
                style = TaliseType.mono(11.sp),
                color = TaliseColors.danger,
            )
        } else {
            Text("Available", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
            Text(available, style = TaliseType.mono(11.sp), color = TaliseColors.fgMuted)
        }
    }
}

// MARK: - Success (iOS SuccessfulTxView, same layout the Send flow renders)

@Composable
private fun ScanPaySuccessView(amountText: String, digest: String, onDone: () -> Unit) {
    val context = LocalContext.current
    Column(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))

        Image(
            painter = painterResource(R.drawable.successcoins),
            contentDescription = null,
            modifier = Modifier.width(300.dp).height(235.dp),
        )

        Spacer(Modifier.height(18.dp))

        Text(
            amountText,
            style = TaliseType.heading(64.sp, FontWeight.Normal),
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
            modifier = Modifier.padding(horizontal = 20.dp).padding(top = 16.dp),
        )
        Text(
            "gas cost = 0, money arrives < 1s",
            style = TaliseType.mono(13.sp, FontWeight.Normal),
            letterSpacing = (-0.26).sp,
            color = TaliseColors.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 20.dp).padding(top = 8.dp),
        )

        Row(
            Modifier.padding(top = 30.dp, bottom = 30.dp),
            horizontalArrangement = Arrangement.spacedBy(13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Share Receipt, the system share sheet with the explorer link
            // (string, not URL, mirrors iOS shareReceipt).
            Row(
                Modifier
                    .width(158.dp)
                    .height(41.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2)
                    .clickable(enabled = digest.isNotEmpty()) {
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, "https://suivision.xyz/txblock/$digest")
                        }
                        context.startActivity(Intent.createChooser(send, null))
                    },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Share Receipt",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.3).sp,
                    color = TaliseColors.fg,
                )
                Spacer(Modifier.width(6.dp))
                Icon(Icons.Outlined.IosShare, contentDescription = null, tint = TaliseColors.fg, modifier = Modifier.size(12.dp))
            }
            // Done, hands control back to the scanner which dismisses the
            // whole Scan-to-Pay surface back to Home in one motion.
            Box(
                Modifier
                    .width(92.dp)
                    .height(41.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.fg)
                    .clickable { onDone() },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Done",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.3).sp,
                    color = Color.Black,
                )
            }
        }
    }
}

// MARK: - Derived identity

/** The @handle (or shortened 0x) shown in the recipient card, iOS `recipientHandle`. */
private fun recipientHandle(recipient: RecipientResolution): String {
    val name = recipient.displayName
    if (!name.isNullOrEmpty() && name != recipient.address) return name
    val d = recipient.display
    if (!d.isNullOrEmpty() && d != recipient.address) return d
    return ScanSuiAddress.short(recipient.address)
}

/**
 * Two-letter monogram for the avatar disc. Strips SuiNS suffixes and the
 * leading `@`; falls back to the address tail for raw 0x sends.
 */
internal fun monogram(raw: String): String {
    var cleaned = raw
        .replace("@talise.sui", "")
        .replace(".talise.sui", "")
        .replace(".sui", "")
    if (cleaned.startsWith("@")) cleaned = cleaned.drop(1)

    // 0x…/short-address recipients: take the two chars after "0x".
    if (cleaned.lowercase().startsWith("0x")) {
        val tail = cleaned.drop(2).take(2)
        return if (tail.isEmpty()) "0x" else tail.uppercase()
    }

    val parts = cleaned.split(' ', '.', '_').filter { it.isNotEmpty() }
    if (parts.size >= 2) return "${parts[0].first()}${parts[1].first()}".uppercase()
    return cleaned.take(2).uppercase()
}

// MARK: - Formatting

/** "$X.XX" money string, mirrors iOS `TaliseFormat.usd2`/`local2` (USD display). */
internal fun usd2(v: Double): String = "$" + String.format(java.util.Locale.US, "%,.2f", v)

/** Trim trailing zeros so a seeded "50.00" reads as "50", iOS `formatSeed`. */
private fun formatSeed(v: Double): String {
    if (v == Math.rint(v)) return v.toLong().toString()
    var s = String.format(java.util.Locale.US, "%.2f", v)
    while (s.endsWith("0")) s = s.dropLast(1)
    if (s.endsWith(".")) s = s.dropLast(1)
    return s
}
