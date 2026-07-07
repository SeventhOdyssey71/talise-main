package io.talise.app.feature.scan

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

/**
 * The single pluggable scanner input, the Android slot for iOS `QRScannerView`
 * (AVCaptureSession + metadata QR delegate + Vision OCR).
 *
 * CURRENT STATE: a placeholder. No camera/barcode dependency exists in the
 * Gradle catalog yet, so this layer renders the black camera backdrop and never
 * emits codes. The AndroidManifest ALREADY declares `android.permission.CAMERA`,
 * and `ScanScreen` runs the real runtime-permission gate, so once the
 * orchestrator adds CameraX + ML Kit (see parity-notes-scan.md) ONLY the body of
 * this composable changes:
 *
 *   - Mount a CameraX `PreviewView` via `AndroidView`, bind Preview +
 *     ImageAnalysis to the lifecycle.
 *   - Feed frames to ML Kit `BarcodeScanning` (FORMAT_QR_CODE only) and, when
 *     [ocrEnabled], `TextRecognition` throttled to ~3 fps.
 *   - Debounce: emit [onCode] once per detection; a bump of [resumeToken]
 *     re-arms detection (parent bumps it after an unrecognized code).
 *   - Apply [torchOn] via `camera.cameraControl.enableTorch` and report
 *     `cameraInfo.hasFlashUnit()` through [onTorchAvailability].
 *   - Report a missing/unusable camera through [onCameraAvailability] so the
 *     parent can paint the "Camera unavailable" surface.
 *
 * The callback surface below is an exact mirror of the iOS representable, so
 * `ScanScreen`/`ScanViewModel` need no change when the real camera lands.
 */
@Composable
fun ScannerCaptureLayer(
    /** Drives the torch. Bound to the screen's flash toggle. */
    torchOn: Boolean,
    /**
     * Monotonic re-arm token. After an unrecognized code the parent bumps this;
     * the capture layer clears its one-shot latch so the next code is read.
     */
    resumeToken: Int,
    /** Master switch for the OCR text path (bank placards). */
    ocrEnabled: Boolean,
    /** First-detection callback, fires exactly once per scanned QR string. */
    onCode: (String) -> Unit,
    /** Continuous OCR callback, one array of recognized strings per processed frame. */
    onText: (List<String>) -> Unit,
    /** Reports whether a usable capture device exists. */
    onCameraAvailability: (Boolean) -> Unit,
    /** Reports whether the active device has a torch (hides the flash toggle when false). */
    onTorchAvailability: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Placeholder: a black "camera" backdrop. Report the camera as present so
    // the live-scanner chrome (scrim, sweep, caption) renders exactly like iOS,
    // and no torch so the flash toggle stays hidden (same as iOS on
    // front-only/simulator devices). Swap this body for the CameraX preview.
    LaunchedEffect(Unit) {
        onCameraAvailability(true)
        onTorchAvailability(false)
    }
    // Parameters are consumed by the real implementation; reference them so the
    // placeholder compiles warning-clean and the wiring stays exercised.
    LaunchedEffect(torchOn, resumeToken, ocrEnabled) { /* no camera to drive yet */ }

    Box(modifier = modifier.fillMaxSize().background(Color.Black))
}
