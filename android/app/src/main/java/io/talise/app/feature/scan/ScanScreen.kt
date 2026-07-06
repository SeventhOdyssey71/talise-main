package io.talise.app.feature.scan

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CropFree
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.foundation.Canvas
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Scan-to-Pay surface, a faithful port of iOS `ScanToPayView`.
 *
 * The Android build renders a viewfinder PLACEHOLDER rather than a live camera:
 * a black backdrop with the iOS mint corner-bracket frame, an animated scan
 * sweep, the "Point and pay" chrome, and the bottom balance chip + hint. No
 * camera or QR dependency is added. Tapping the viewfinder window stands in for
 * a resolved scan and presents the `ConfirmPaymentSheet` layout so the confirm
 * surface is reachable for the visual replica.
 */

private enum class ScanMode { Scan, Manual }

// Demo empty-wallet balance. iOS loads this from /api/balances and falls back
// to $0.00; with no network wiring here we render that same empty state.
private const val DEMO_BALANCE_USD = 0.0

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(onClose: () -> Unit) {
    var mode by remember { mutableStateOf(ScanMode.Scan) }
    var flashOn by remember { mutableStateOf(false) }
    var showConfirm by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
    ) {
        if (mode == ScanMode.Scan) {
            // Centered viewfinder brackets + sweep, floated over the backdrop.
            Box(
                modifier = Modifier.align(Alignment.Center),
                contentAlignment = Alignment.Center,
            ) {
                ScanFrame(
                    size = 268.dp,
                    cornerRadius = 28.dp,
                    bracketLength = 34.dp,
                    lineWidth = 3.dp,
                    color = TaliseColors.greenMint,
                    modifier = Modifier
                        .size(268.dp)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { showConfirm = true },
                )
                ScanSweep(size = 268.dp)
            }
        }

        Column(modifier = Modifier.fillMaxSize()) {
            if (mode == ScanMode.Scan) {
                TopChrome(
                    title = "Point and pay",
                    subtitle = "QR codes, account numbers, one camera.",
                    mode = mode,
                    flashOn = flashOn,
                    onFlash = { flashOn = !flashOn },
                    onClose = onClose,
                    onMode = { mode = it },
                )
                Spacer(Modifier.weight(1f))
                BottomChrome(balance = format2(DEMO_BALANCE_USD))
            } else {
                ManualEntry(
                    onClose = onClose,
                    onMode = { mode = it },
                )
            }
        }
    }

    if (showConfirm) {
        ModalBottomSheet(
            onDismissRequest = { showConfirm = false },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
            dragHandle = { GrabHandle() },
        ) {
            ConfirmPaymentSheet(
                recipientHandle = "alice@talise.sui",
                availableUsd = DEMO_BALANCE_USD,
                onCancel = { showConfirm = false },
                onPaid = { showConfirm = false },
            )
        }
    }
}

// MARK: - Top chrome

@Composable
private fun TopChrome(
    title: String,
    subtitle: String,
    mode: ScanMode,
    flashOn: Boolean,
    onFlash: () -> Unit,
    onClose: () -> Unit,
    onMode: (ScanMode) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(Color.Black.copy(alpha = 0.55f), Color.Black.copy(alpha = 0f)),
                ),
            )
            .statusBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Status bar row: dismiss disc + flash toggle.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DiscButton(icon = { Icon(Icons.Filled.Close, null, tint = TaliseColors.fg, modifier = Modifier.size(14.dp)) }, onClick = onClose)
            Spacer(Modifier.weight(1f))
            DiscButton(
                icon = {
                    Icon(
                        if (flashOn) Icons.Filled.FlashOn else Icons.Filled.FlashOff,
                        null,
                        tint = if (flashOn) TaliseColors.greenMint else TaliseColors.fg,
                        modifier = Modifier.size(14.dp),
                    )
                },
                onClick = onFlash,
            )
        }

        Text(
            title,
            style = TaliseType.heading(20.sp, FontWeight.SemiBold),
            letterSpacing = (-20 * 0.03).sp,
            color = TaliseColors.fg,
            modifier = Modifier.padding(top = 26.dp),
        )
        Text(
            subtitle,
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fg.copy(alpha = 0.65f),
            modifier = Modifier.padding(top = 4.dp),
        )
        ModeToggle(
            mode = mode,
            onMode = onMode,
            modifier = Modifier
                .padding(top = 16.dp)
                .padding(horizontal = 40.dp)
                .padding(bottom = 24.dp),
        )
    }
}

@Composable
private fun DiscButton(icon: @Composable () -> Unit, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(38.dp)
            .clip(CircleShape)
            .background(TaliseColors.surface2)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { icon() }
}

// MARK: - Mode toggle

@Composable
private fun ModeToggle(mode: ScanMode, onMode: (ScanMode) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.12f))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ToggleSegment(
            title = "Camera",
            icon = Icons.Filled.CropFree,
            isOn = mode == ScanMode.Scan,
            modifier = Modifier.weight(1f),
        ) { onMode(ScanMode.Scan) }
        ToggleSegment(
            title = "Type it in",
            icon = Icons.Outlined.Keyboard,
            isOn = mode == ScanMode.Manual,
            modifier = Modifier.weight(1f),
        ) { onMode(ScanMode.Manual) }
    }
}

@Composable
private fun ToggleSegment(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    isOn: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(if (isOn) TaliseColors.greenMint else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (isOn) TaliseColors.bg else TaliseColors.fg, modifier = Modifier.size(11.dp))
        Spacer(Modifier.width(6.dp))
        Text(
            title,
            style = TaliseType.heading(13.sp, FontWeight.Medium),
            color = if (isOn) TaliseColors.bg else TaliseColors.fg,
        )
    }
}

// MARK: - Bottom chrome

@Composable
private fun BottomChrome(balance: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(Color.Black.copy(alpha = 0f), Color.Black.copy(alpha = 0.55f)),
                ),
            )
            .navigationBarsPadding()
            .padding(top = 36.dp, bottom = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        BalanceChip(balance)
        Text(
            "Frame a Talise code or a bank account number. Talise reads it and sets up the payment.",
            style = TaliseType.body(13.sp, FontWeight.Normal),
            color = TaliseColors.fg.copy(alpha = 0.9f),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 52.dp),
        )
    }
}

@Composable
private fun BalanceChip(balance: String) {
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.12f))
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(TaliseColors.greenMint),
        )
        Text(
            "Balance",
            style = TaliseType.mono(10.sp),
            letterSpacing = 1.1.sp,
            color = TaliseColors.fg.copy(alpha = 0.65f),
        )
        Text(
            balance,
            style = TaliseType.heading(14.sp, FontWeight.SemiBold),
            letterSpacing = (-0.3).sp,
            color = TaliseColors.fg,
        )
    }
}

// MARK: - Manual entry

@Composable
private fun ManualEntry(onClose: () -> Unit, onMode: (ScanMode) -> Unit) {
    var manualBank by remember { mutableStateOf<String?>(null) }
    var account by remember { mutableStateOf("") }
    val ready = manualBank != null && account.length == 10

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DiscButton(icon = { Icon(Icons.Filled.Close, null, tint = TaliseColors.fg, modifier = Modifier.size(14.dp)) }, onClick = onClose)
            Spacer(Modifier.weight(1f))
        }

        Text(
            "Pay a bank account",
            style = TaliseType.heading(20.sp, FontWeight.SemiBold),
            letterSpacing = (-20 * 0.03).sp,
            color = TaliseColors.fg,
            modifier = Modifier.padding(top = 26.dp),
        )
        Text(
            "We confirm the account name before anything moves.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fg.copy(alpha = 0.65f),
            modifier = Modifier.padding(top = 4.dp),
        )
        ModeToggle(
            mode = ScanMode.Manual,
            onMode = onMode,
            modifier = Modifier
                .padding(top = 16.dp)
                .padding(horizontal = 40.dp),
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 28.dp)
                .padding(top = 34.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // Bank field.
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ManualLabel("Bank")
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White.copy(alpha = 0.08f))
                        .clickable { /* Bank picker stub: no bank list wired on Android yet. */ }
                        .padding(horizontal = 16.dp, vertical = 15.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        manualBank ?: "Select bank",
                        style = TaliseType.body(15.sp),
                        color = if (manualBank == null) TaliseColors.fg.copy(alpha = 0.5f) else TaliseColors.fg,
                    )
                    Spacer(Modifier.weight(1f))
                    Icon(Icons.Filled.KeyboardArrowDown, null, tint = TaliseColors.fg.copy(alpha = 0.6f), modifier = Modifier.size(18.dp))
                }
            }

            // Account number field.
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ManualLabel("Account number")
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White.copy(alpha = 0.08f))
                        .padding(horizontal = 16.dp, vertical = 16.dp),
                ) {
                    if (account.isEmpty()) {
                        Text(
                            "10-digit account number",
                            style = TaliseType.body(16.sp),
                            color = TaliseColors.fg.copy(alpha = 0.4f),
                        )
                    }
                    BasicTextField(
                        value = account,
                        onValueChange = { new -> account = new.filter { it.isDigit() }.take(10) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        textStyle = TextStyle(
                            fontFamily = TaliseType.sansFamily,
                            fontSize = 16.sp,
                            color = TaliseColors.fg,
                        ),
                        cursorBrush = SolidColor(TaliseColors.greenMint),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            // Continue.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(top = 6.dp)
                    .clip(CircleShape)
                    .background(if (ready) TaliseColors.greenMint else Color.White.copy(alpha = 0.3f))
                    .clickable(enabled = ready) { /* Bank payout routing not wired on Android yet. */ },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Continue",
                    style = TaliseType.heading(16.sp, FontWeight.Medium),
                    color = TaliseColors.bg,
                )
            }
        }
    }
}

@Composable
private fun ManualLabel(text: String) {
    Text(
        text,
        style = TaliseType.mono(10.sp, FontWeight.Normal),
        letterSpacing = 1.3.sp,
        color = TaliseColors.fg.copy(alpha = 0.6f),
    )
}

// MARK: - Confirm payment sheet

@Composable
private fun ConfirmPaymentSheet(
    recipientHandle: String,
    availableUsd: Double,
    onCancel: () -> Unit,
    onPaid: () -> Unit,
) {
    var rawAmount by remember { mutableStateOf("") }
    val typed = rawAmount.replace(",", "").toDoubleOrNull() ?: 0.0
    val exceeds = typed > 0.0 && typed > availableUsd
    val canPay = typed > 0.0 && !exceeds

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(bottom = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Confirm Payment",
            style = TaliseType.heading(20.sp, FontWeight.SemiBold),
            letterSpacing = (-0.5).sp,
            color = TaliseColors.fg,
            modifier = Modifier.padding(top = 18.dp),
        )

        RecipientCard(
            handle = recipientHandle,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 24.dp),
        )

        AmountBlock(
            rawAmount = rawAmount,
            onAmount = { rawAmount = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 26.dp),
        )

        AvailableLine(
            exceeds = exceeds,
            available = format2(availableUsd),
            modifier = Modifier.padding(top = 12.dp),
        )

        Spacer(Modifier.height(28.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp),
        ) {
            SlideToConfirm(
                title = "Slide to Pay",
                tint = TaliseColors.accent,
                enabled = canPay,
                onConfirm = { onPaid() },
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp)
                .padding(top = 14.dp)
                .clickable(onClick = onCancel),
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
private fun GrabHandle() {
    Box(
        modifier = Modifier
            .padding(top = 10.dp)
            .size(width = 38.dp, height = 5.dp)
            .clip(CircleShape)
            .background(TaliseColors.fgDim.copy(alpha = 0.6f)),
    )
}

@Composable
private fun RecipientCard(handle: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(22.dp))
            .background(TaliseColors.surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
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
                overflow = TextOverflow.Ellipsis,
            )
            Text("Recipient", style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
        }
    }
}

@Composable
private fun AmountBlock(rawAmount: String, onAmount: (String) -> Unit, modifier: Modifier = Modifier) {
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
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TextStyle(
                        fontFamily = TaliseType.sansFamily,
                        fontSize = 48.sp,
                        fontWeight = FontWeight.Medium,
                        color = TaliseColors.fg,
                        textAlign = TextAlign.Center,
                    ),
                    cursorBrush = SolidColor(TaliseColors.accent),
                )
            }
        }
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

// MARK: - Viewfinder frame

/**
 * Four rounded corner brackets tracing a softly-rounded window, a 1:1 port of the
 * iOS `ScanFrame` Canvas. Each bracket runs the corner arc plus a straight leg
 * along each edge, drawn with round caps so the window reads as a rounded rect.
 */
@Composable
private fun ScanFrame(
    size: androidx.compose.ui.unit.Dp,
    cornerRadius: androidx.compose.ui.unit.Dp,
    bracketLength: androidx.compose.ui.unit.Dp,
    lineWidth: androidx.compose.ui.unit.Dp,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.size(size)) {
        val side = size.toPx()
        val lw = lineWidth.toPx()
        val half = lw / 2f
        val minX = half
        val minY = half
        val maxX = side - half
        val maxY = side - half
        val r = min(cornerRadius.toPx(), (side - lw) / 2f - 1f)
        val l = bracketLength.toPx()

        val stroke = Stroke(width = lw, cap = StrokeCap.Round, join = StrokeJoin.Round)

        // Top-left.
        var p = Path().apply {
            moveTo(minX, minY + r + l)
            lineTo(minX, minY + r)
            arcTo(Rect(minX, minY, minX + 2 * r, minY + 2 * r), 180f, 90f, false)
            lineTo(minX + r + l, minY)
        }
        drawPath(p, color, style = stroke)

        // Top-right.
        p = Path().apply {
            moveTo(maxX - r - l, minY)
            lineTo(maxX - r, minY)
            arcTo(Rect(maxX - 2 * r, minY, maxX, minY + 2 * r), 270f, 90f, false)
            lineTo(maxX, minY + r + l)
        }
        drawPath(p, color, style = stroke)

        // Bottom-right.
        p = Path().apply {
            moveTo(maxX, maxY - r - l)
            lineTo(maxX, maxY - r)
            arcTo(Rect(maxX - 2 * r, maxY - 2 * r, maxX, maxY), 0f, 90f, false)
            lineTo(maxX - r - l, maxY)
        }
        drawPath(p, color, style = stroke)

        // Bottom-left.
        p = Path().apply {
            moveTo(minX + r + l, maxY)
            lineTo(minX + r, maxY)
            arcTo(Rect(minX, maxY - 2 * r, minX + 2 * r, maxY), 90f, 90f, false)
            lineTo(minX, maxY - r - l)
        }
        drawPath(p, color, style = stroke)
    }
}

/**
 * Animated mint sweep line gliding up and down inside the viewfinder, a port of
 * the iOS `ScanSweep` (2.4s easeInOut, autoreversing).
 */
@Composable
private fun ScanSweep(size: androidx.compose.ui.unit.Dp) {
    val travel = size / 2 - 30.dp
    val transition = rememberInfiniteTransition(label = "sweep")
    val fraction by transition.animateFloat(
        initialValue = -1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2400, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "sweepOffset",
    )
    Box(
        modifier = Modifier
            .width(size - 44.dp)
            .height(2.5.dp)
            .offset { IntOffset(0, (fraction * travel.toPx()).roundToInt()) }
            .background(
                Brush.horizontalGradient(
                    listOf(
                        TaliseColors.greenMint.copy(alpha = 0f),
                        TaliseColors.greenMint.copy(alpha = 0.9f),
                        TaliseColors.greenMint.copy(alpha = 0f),
                    ),
                ),
            ),
    )
}

// MARK: - Helpers

/** Two-letter monogram for the avatar disc, mirroring iOS `monogram`. */
private fun monogram(handle: String): String {
    var cleaned = handle
        .replace("@talise.sui", "")
        .replace(".talise.sui", "")
        .replace(".sui", "")
    if (cleaned.startsWith("@")) cleaned = cleaned.drop(1)
    if (cleaned.lowercase().startsWith("0x")) {
        val tail = cleaned.drop(2).take(2)
        return if (tail.isEmpty()) "0x" else tail.uppercase()
    }
    val parts = cleaned.split(" ", ".", "_").filter { it.isNotEmpty() }
    if (parts.size >= 2) return "${parts[0].first()}${parts[1].first()}".uppercase()
    return cleaned.take(2).uppercase()
}

/** "$X.XX" money string, mirroring iOS `TaliseFormat.local2`. */
private fun format2(v: Double): String = "$" + String.format("%,.2f", v)
