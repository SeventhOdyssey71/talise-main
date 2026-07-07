package io.talise.app.feature.scan

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CropFree
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.NoPhotography
import androidx.compose.material.icons.outlined.VideocamOff
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Full-screen Scan-to-Pay surface, an exact port of iOS `ScanToPayView`.
 *
 * The capture layer ([ScannerCaptureLayer]) mounts behind the overlay; the
 * corner brackets + caption float on top. Camera permission is re-checked on
 * appear and requested when undetermined; denied → an inline Settings prompt;
 * no usable device → an "unavailable" state.
 *
 * A successful scan parses the QR ([ScanPayload]), resolves the recipient to a
 * display identity (reusing `/api/recipient/resolve` + the local address
 * decode the Send flow uses), and presents a [ConfirmPaymentSheet] over the
 * scanner. Bank placards (OCR) and manual entry route to
 * [ScanBankPayoutSheet]. After a successful payment the whole scan surface
 * dismisses back to Home.
 */

/** Side of the viewfinder window, also the scrim cut-out + bracket trace. */
private val ViewfinderSize: Dp = 268.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(onClose: () -> Unit, vm: ScanViewModel = viewModel()) {
    val ui by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current

    // MARK: Camera authorization gate (iOS resolveCameraAuthorization).
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) vm.onPermissionGranted() else vm.onPermissionDenied()
    }
    LaunchedEffect(Unit) {
        val status = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
        if (status == PackageManager.PERMISSION_GRANTED) {
            vm.onPermissionGranted()
        } else {
            // Request inline, onboarding may have been skipped, or this is the
            // user's first camera touchpoint. Don't assume grant.
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    // Success haptic on the "Scanned successfully" beat (iOS UINotificationFeedback).
    LaunchedEffect(ui.scanned) {
        if (ui.scanned) haptic.performHapticFeedback(HapticFeedbackType.LongPress)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // Black backdrop, always present so any letterboxing around the
            // aspect-fill preview reads as intentional black.
            .background(Color.Black),
    ) {
        // Live camera feed sits behind the overlay so the corner brackets +
        // caption float on top of the frame.
        if (ui.cameraState == ScanViewModel.CameraState.Scanning && ui.mode == ScanViewModel.Mode.Scan) {
            ScannerCaptureLayer(
                torchOn = ui.flashOn,
                resumeToken = ui.resumeToken,
                ocrEnabled = true,
                onCode = vm::handleScan,
                onText = vm::handleOcr,
                onCameraAvailability = vm::onCameraAvailability,
                onTorchAvailability = vm::onTorchAvailability,
                modifier = Modifier.fillMaxSize(),
            )
        }

        if (ui.mode == ScanViewModel.Mode.Manual) {
            ManualEntry(ui = ui, vm = vm, onClose = onClose)
        } else {
            ScannerOverlay(ui = ui, vm = vm, onClose = onClose)
        }

        // Permission / availability surfaces sit above the overlay so their
        // copy isn't competing with the viewfinder caption. Only in scan mode,
        // manual entry needs no camera.
        if (ui.mode == ScanViewModel.Mode.Scan) {
            when (ui.cameraState) {
                ScanViewModel.CameraState.Denied -> DeniedState(
                    onOpenSettings = {
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.fromParts("package", context.packageName, null)
                        }
                        context.startActivity(intent)
                    },
                )
                ScanViewModel.CameraState.Unavailable -> UnavailableState()
                else -> Unit
            }
        }

        // Brief resolving veil between a valid scan and the confirm sheet,
        // covers the SuiNS / address lookup.
        AnimatedVisibility(visible = ui.resolving, enter = fadeIn(), exit = fadeOut()) {
            ResolvingOverlay()
        }
        AnimatedVisibility(visible = ui.scanned, enter = fadeIn(tween(120)), exit = fadeOut(tween(150))) {
            ScannedOverlay()
        }
    }

    // MARK: Sheets

    val pendingPayment = ui.pendingPayment
    if (pendingPayment != null) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { vm.rearmAfterConfirm() },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
            dragHandle = null,
        ) {
            ConfirmPaymentSheet(
                recipient = pendingPayment.recipient,
                scannedAmount = pendingPayment.amount,
                onPaid = {
                    // Send landed, dismiss the scanner, which tears down this
                    // nested confirm sheet with it, returning the user to Home
                    // in one motion.
                    onClose()
                },
                onCancel = { vm.rearmAfterConfirm() },
            )
        }
    }

    val pendingBank = ui.pendingBank
    if (pendingBank != null) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { vm.rearmAfterBank() },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
            dragHandle = null,
        ) {
            ScanBankPayoutSheet(
                bank = pendingBank.bank,
                accountNumber = pendingBank.accountNumber,
                onPaid = { onClose() },
                onCancel = { vm.rearmAfterBank() },
            )
        }
    }

    if (ui.showBankPicker) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { vm.setShowBankPicker(false) },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
        ) {
            ScanBankPickerSheet(
                selected = ui.manualBank,
                onSelect = { bank ->
                    vm.setManualBank(bank)
                    vm.setShowBankPicker(false)
                },
                onClose = { vm.setShowBankPicker(false) },
            )
        }
    }
}

// MARK: - Overlay

@Composable
private fun ScannerOverlay(ui: ScanViewModel.UiState, vm: ScanViewModel, onClose: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        // Soft dimming scrim with the viewfinder window punched out, so the
        // live frame reads brightest inside the brackets. Only painted over
        // the live preview.
        if (ui.cameraState == ScanViewModel.CameraState.Scanning) {
            ViewfinderScrim()
        }

        // Center: viewfinder corner brackets, floated over the full-bleed
        // camera. Mint brackets + a sweeping scan line.
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(ViewfinderSize),
            contentAlignment = Alignment.Center,
        ) {
            ScanFrame(
                size = ViewfinderSize,
                cornerRadius = 28.dp,
                bracketLength = 34.dp,
                lineWidth = 3.dp,
                color = TaliseColors.greenMint,
                modifier = Modifier.size(ViewfinderSize),
            )
            if (ui.cameraState == ScanViewModel.CameraState.Scanning) {
                ScanSweep(size = ViewfinderSize)
            }
        }

        // Top + bottom chrome float over the edge-to-edge camera. A subtle
        // dark gradient behind each keeps the white controls legible.
        Column(Modifier.fillMaxSize()) {
            TopChrome(
                title = "Point & pay",
                subtitle = "QR codes, account numbers, one camera.",
                mode = ui.mode,
                flashOn = ui.flashOn,
                hasTorch = ui.hasTorch,
                onFlash = vm::toggleFlash,
                onClose = onClose,
                onMode = vm::setMode,
            )
            Spacer(Modifier.weight(1f))
            BottomChrome(
                balance = usd2(ui.balance?.usdsui ?: 0.0),
                showUnrecognized = ui.showUnrecognized,
            )
        }
    }
}

/**
 * Dimming scrim with a rounded-rect cut-out over the viewfinder window, the
 * Compose twin of iOS `.blendMode(.destinationOut)` + `.compositingGroup()`.
 */
@Composable
private fun ViewfinderScrim() {
    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen },
    ) {
        drawRect(Color.Black.copy(alpha = 0.42f))
        val side = ViewfinderSize.toPx()
        drawRoundRect(
            color = Color.Black,
            topLeft = Offset((size.width - side) / 2f, (size.height - side) / 2f),
            size = Size(side, side),
            cornerRadius = CornerRadius(28.dp.toPx()),
            blendMode = BlendMode.Clear,
        )
    }
}

// MARK: - Top chrome

/**
 * Top overlay block: close button + title + mode toggle over a dark gradient
 * scrim. The balance deliberately does NOT live up here (that's every
 * super-app's scanner), it sits in a quiet chip above the caption instead.
 */
@Composable
private fun TopChrome(
    title: String,
    subtitle: String,
    mode: ScanViewModel.Mode,
    flashOn: Boolean,
    hasTorch: Boolean,
    onFlash: () -> Unit,
    onClose: () -> Unit,
    onMode: (ScanViewModel.Mode) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            // Dark top→clear gradient so white controls stay legible over a
            // bright camera frame. Extends up under the status bar.
            .background(
                Brush.verticalGradient(
                    listOf(Color.Black.copy(alpha = 0.55f), Color.Black.copy(alpha = 0f)),
                ),
            )
            .statusBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TopStatusBar(
            flashOn = flashOn,
            hasTorch = hasTorch,
            onFlash = onFlash,
            onClose = onClose,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 8.dp),
        )

        // Title sits just below the status bar. Kerning ratio matches the
        // design language (-size x 0.03).
        Text(
            title,
            style = TaliseType.heading(20.sp, FontWeight.SemiBold),
            letterSpacing = (-20 * 0.03).sp,
            color = Color.White,
            modifier = Modifier.padding(top = 26.dp),
        )
        Text(
            subtitle,
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = Color.White.copy(alpha = 0.65f),
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

/**
 * Two-up row: a glass dismiss disc on the leading edge and the flash toggle on
 * the trailing edge. The flash toggle only paints when the active device has a
 * torch (hidden on the emulator + front-only devices).
 */
@Composable
private fun TopStatusBar(
    flashOn: Boolean,
    hasTorch: Boolean,
    onFlash: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        DiscButton(onClick = onClose) {
            Icon(Icons.Filled.Close, null, tint = Color.White, modifier = Modifier.size(14.dp))
        }
        Spacer(Modifier.weight(1f))
        if (hasTorch) {
            DiscButton(onClick = onFlash) {
                Icon(
                    if (flashOn) Icons.Filled.FlashOn else Icons.Filled.FlashOff,
                    null,
                    tint = if (flashOn) TaliseColors.greenMint else Color.White,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}

@Composable
private fun DiscButton(onClick: () -> Unit, icon: @Composable () -> Unit) {
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

/**
 * "Camera / Type it in" segmented control, glassy over the dark scanner
 * backdrop with the active segment in brand mint.
 */
@Composable
private fun ModeToggle(
    mode: ScanViewModel.Mode,
    onMode: (ScanViewModel.Mode) -> Unit,
    modifier: Modifier = Modifier,
) {
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
            isOn = mode == ScanViewModel.Mode.Scan,
            modifier = Modifier.weight(1f),
        ) { onMode(ScanViewModel.Mode.Scan) }
        ToggleSegment(
            title = "Type it in",
            icon = Icons.Outlined.Keyboard,
            isOn = mode == ScanViewModel.Mode.Manual,
            modifier = Modifier.weight(1f),
        ) { onMode(ScanViewModel.Mode.Manual) }
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
        Icon(icon, null, tint = if (isOn) TaliseColors.bg else Color.White, modifier = Modifier.size(11.dp))
        Spacer(Modifier.width(6.dp))
        Text(
            title,
            style = TaliseType.heading(13.sp, FontWeight.Medium),
            color = if (isOn) TaliseColors.bg else Color.White,
        )
    }
}

// MARK: - Bottom chrome

/**
 * Bottom overlay block: balance chip + instruction caption (or the
 * "unrecognized" pill) over a dark gradient scrim, anchored above the nav bar.
 */
@Composable
private fun BottomChrome(balance: String, showUnrecognized: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            // Clear→dark gradient behind the bottom hint.
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
        if (showUnrecognized) {
            UnrecognizedPill()
        } else {
            Text(
                "Frame a Talise code or a bank account number. Talise reads it and sets up the payment.",
                style = TaliseType.body(13.sp, FontWeight.Normal),
                color = Color.White.copy(alpha = 0.9f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 52.dp),
            )
        }
    }
}

/**
 * Quiet balance chip above the caption, what you can spend, where your eye
 * already is, instead of the super-app top-corner figure.
 */
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
            color = Color.White.copy(alpha = 0.65f),
        )
        Text(
            balance,
            style = TaliseType.heading(14.sp, FontWeight.SemiBold),
            letterSpacing = (-0.3).sp,
            color = Color.White,
        )
    }
}

/**
 * Transient "not a Talise code" feedback. We keep scanning underneath, this
 * just tells the user the last code wasn't routable.
 */
@Composable
private fun UnrecognizedPill() {
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(TaliseColors.surface)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Filled.ErrorOutline,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.9f),
            modifier = Modifier.size(13.dp),
        )
        Text(
            "Not a Talise payment code",
            style = TaliseType.body(13.sp, FontWeight.Normal),
            color = Color.White,
        )
    }
}

// MARK: - Resolving / scanned overlays

@Composable
private fun ResolvingOverlay() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.7f))
            // Swallow taps while resolving.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) {},
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .clip(RoundedCornerShape(22.dp))
                .background(TaliseColors.surface)
                .padding(horizontal = 28.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            CircularProgressIndicator(
                color = TaliseColors.greenMint,
                strokeWidth = 3.dp,
                modifier = Modifier.size(44.dp),
            )
            Text(
                "Finding who to pay…",
                style = TaliseType.body(13.sp, FontWeight.Normal),
                color = Color.White,
            )
        }
    }
}

/**
 * "Scanned successfully" beat, a mint check that pops in, holds, then hands
 * off to the confirm sheet. ~0.9s total.
 */
@Composable
private fun ScannedOverlay() {
    var pop by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { pop = true }
    val scale by animateFloatAsState(
        targetValue = if (pop) 1f else 0.4f,
        // iOS .spring(response: 0.32, dampingFraction: 0.62) ≈ stiffness 400.
        animationSpec = spring(dampingRatio = 0.62f, stiffness = 400f),
        label = "scannedPop",
    )
    val alpha by animateFloatAsState(
        targetValue = if (pop) 1f else 0f,
        animationSpec = tween(180),
        label = "scannedAlpha",
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .clip(RoundedCornerShape(22.dp))
                .background(TaliseColors.surface)
                .padding(horizontal = 28.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .scale(scale)
                    .graphicsLayer { this.alpha = alpha }
                    .clip(CircleShape)
                    .background(TaliseColors.greenMint.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Check,
                    contentDescription = null,
                    tint = TaliseColors.greenMint,
                    modifier = Modifier.size(26.dp),
                )
            }
            Text(
                "Scanned successfully",
                style = TaliseType.body(13.sp, FontWeight.Normal),
                color = Color.White,
                modifier = Modifier.graphicsLayer { this.alpha = alpha },
            )
        }
    }
}

// MARK: - Permission states

/**
 * Shown for denied camera access. The user already chose to deny (here or in
 * onboarding) so a re-request would be a silent no-op, the only path forward
 * is Settings.
 */
@Composable
private fun DeniedState(onOpenSettings: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(
                Icons.Outlined.NoPhotography,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.8f),
                modifier = Modifier.size(34.dp),
            )
            Text(
                "Camera access needed to scan",
                style = TaliseType.heading(17.sp, FontWeight.SemiBold),
                color = Color.White,
            )
            Text(
                "Enable camera access in Settings to scan a payment QR code.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = Color.White.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 48.dp),
            )
            Box(
                modifier = Modifier
                    .padding(top = 4.dp)
                    .height(48.dp)
                    .clip(CircleShape)
                    .background(Color.White)
                    .clickable(onClick = onOpenSettings)
                    .padding(horizontal = 28.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Open Settings",
                    style = TaliseType.heading(15.sp, FontWeight.Medium),
                    color = Color.Black,
                )
            }
        }
    }
}

/**
 * Shown when there's no usable capture device. Keeps the view testable
 * instead of a frozen black screen.
 */
@Composable
private fun UnavailableState() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                Icons.Outlined.VideocamOff,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.8f),
                modifier = Modifier.size(34.dp),
            )
            Text(
                "Camera unavailable on this device",
                style = TaliseType.heading(17.sp, FontWeight.SemiBold),
                color = Color.White,
            )
            Text(
                "Scan-to-Pay needs a camera. Try this on a physical device.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = Color.White.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 48.dp),
            )
        }
    }
}

// MARK: - Manual entry

/**
 * Type a bank + 10-digit account by hand. Mirrors the bank-form pattern from
 * iOS `BankWithdrawView` (searchable picker + 10-digit field). Sits on the
 * dark scanner backdrop so the toggle stays in place.
 */
@Composable
private fun ManualEntry(ui: ScanViewModel.UiState, vm: ScanViewModel, onClose: () -> Unit) {
    val focusManager = LocalFocusManager.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { focusManager.clearFocus() },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DiscButton(onClick = onClose) {
                Icon(Icons.Filled.Close, null, tint = Color.White, modifier = Modifier.size(14.dp))
            }
            Spacer(Modifier.weight(1f))
        }

        Text(
            "Pay a bank account",
            style = TaliseType.heading(20.sp, FontWeight.SemiBold),
            letterSpacing = (-20 * 0.03).sp,
            color = Color.White,
            modifier = Modifier.padding(top = 26.dp),
        )
        Text(
            "We confirm the account name before anything moves.",
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = Color.White.copy(alpha = 0.65f),
            modifier = Modifier.padding(top = 4.dp),
        )
        ModeToggle(
            mode = ScanViewModel.Mode.Manual,
            onMode = vm::setMode,
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
                        .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(16.dp))
                        .clickable { vm.setShowBankPicker(true) }
                        .padding(horizontal = 16.dp, vertical = 15.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        ui.manualBank?.name ?: "Select bank",
                        style = TaliseType.body(15.sp),
                        color = if (ui.manualBank == null) Color.White.copy(alpha = 0.5f) else Color.White,
                    )
                    Spacer(Modifier.weight(1f))
                    Icon(
                        Icons.Filled.KeyboardArrowDown,
                        contentDescription = null,
                        tint = Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.size(18.dp),
                    )
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
                        .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(16.dp))
                        .padding(horizontal = 16.dp, vertical = 16.dp),
                ) {
                    if (ui.manualAccount.isEmpty()) {
                        Text(
                            "10-digit account number",
                            style = TaliseType.body(16.sp),
                            color = Color.White.copy(alpha = 0.4f),
                        )
                    }
                    BasicTextField(
                        value = ui.manualAccount,
                        onValueChange = vm::setManualAccount,
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        textStyle = TextStyle(
                            fontFamily = TaliseType.sansFamily,
                            fontSize = 16.sp,
                            color = Color.White,
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
                    .padding(top = 6.dp)
                    .height(56.dp)
                    .clip(CircleShape)
                    .background(if (ui.manualReady) TaliseColors.greenMint else Color.White.copy(alpha = 0.3f))
                    .clickable(enabled = ui.manualReady) {
                        focusManager.clearFocus()
                        vm.routeManual()
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Continue",
                    style = TaliseType.heading(16.sp, FontWeight.Medium),
                    color = TaliseColors.bg,
                )
            }
        }

        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun ManualLabel(text: String) {
    Text(
        text,
        style = TaliseType.mono(10.sp, FontWeight.Light),
        letterSpacing = 1.3.sp,
        color = Color.White.copy(alpha = 0.6f),
    )
}

// MARK: - Viewfinder frame

/**
 * Four rounded corner brackets tracing a softly-rounded window, a 1:1 port of
 * the iOS `ScanFrame` Canvas. Each bracket runs the corner arc plus a straight
 * leg along each edge, drawn with round caps so the window reads as a rounded
 * rect rather than a hard square.
 */
@Composable
private fun ScanFrame(
    size: Dp,
    cornerRadius: Dp,
    bracketLength: Dp,
    lineWidth: Dp,
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
        // Clamp the radius so the arc + both legs fit on each side.
        val r = min(cornerRadius.toPx(), (side - lw) / 2f - 1f)
        val l = bracketLength.toPx()

        val stroke = Stroke(width = lw, cap = StrokeCap.Round, join = StrokeJoin.Round)

        // Top-left: straight down the left edge → corner arc → straight along
        // the top edge.
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

// MARK: - Scan sweep

/**
 * Animated mint sweep line gliding up and down inside the viewfinder, a port
 * of the iOS `ScanSweep` (2.4s easeInOut, autoreversing), signals "live and
 * reading".
 */
@Composable
private fun ScanSweep(size: Dp) {
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
