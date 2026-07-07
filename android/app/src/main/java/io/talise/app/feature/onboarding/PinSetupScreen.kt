package io.talise.app.feature.onboarding

import io.talise.app.core.store.PinService

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Step 3/4 — iOS `PinSetupScreen`: set a 4-digit PIN (or enroll biometrics) to secure
 * the wallet. Filled circles for entered digits, a "Show PIN" reveal toggle, a 4x3
 * numeric keypad, and TWO CTAs (`Use Biometrics` secondary above `Continue` primary).
 *
 * PIN handling: NEVER stores the raw PIN. Once four digits are typed and Continue is
 * tapped, the digits go to [PinService] which writes `salt(16) || sha256(salt || pin)`
 * into Keystore-encrypted prefs (the Keychain analog).
 *
 * Biometrics path: gated on `BiometricManager.canAuthenticate` (API 29+). A PIN is
 * mandatory on file first — biometrics augments the PIN, it doesn't replace it. Either
 * prompt outcome continues with the success flag persisted.
 */
private const val PIN_LENGTH = 4

@Composable
fun PinSetupScreen(userId: String, onContinue: () -> Unit) {
    val context = LocalContext.current

    var entry by remember { mutableStateOf("") }
    var showPin by remember { mutableStateOf(false) }
    var failureMessage by remember { mutableStateOf<String?>(null) }
    val biometricsAvailable = remember { checkBiometricsAvailable(context) }

    fun tapDigit(d: String) {
        if (entry.length >= PIN_LENGTH) return
        failureMessage = null
        entry += d
    }

    fun tapDelete() {
        if (entry.isEmpty()) return
        entry = entry.dropLast(1)
        failureMessage = null
    }

    fun persistAndContinue() {
        if (entry.length != PIN_LENGTH) return
        try {
            PinService.setPin(context, entry, userId)
            OnboardingPrefs.of(context).edit()
                .putBoolean(OnboardingPrefs.KEY_BIOMETRICS_ENABLED, false)
                .apply()
            onContinue()
        } catch (t: Throwable) {
            failureMessage = "Couldn't save PIN. Try again."
            entry = ""
        }
    }

    fun requestBiometrics() {
        // A PIN is mandatory on file (the unlock gate verifies against it); biometrics
        // only adds a faster path. The button is disabled until 4 digits are entered,
        // but guard here too as defense in depth.
        if (entry.length != PIN_LENGTH) {
            failureMessage = "Set your 4-digit PIN first."
            return
        }
        // Persist the PIN NOW so it's always registered before we enable biometrics —
        // even if the OS prompt is then cancelled.
        try {
            PinService.setPin(context, entry, userId)
        } catch (t: Throwable) {
            failureMessage = "Couldn't save your PIN. Please try again."
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && biometricsAvailable) {
            promptBiometrics(context) { success ->
                // PIN is already on file either way; biometrics is the bonus.
                OnboardingPrefs.of(context).edit()
                    .putBoolean(OnboardingPrefs.KEY_BIOMETRICS_ENABLED, success)
                    .apply()
                onContinue()
            }
        } else {
            // No biometrics on device — the PIN is already saved, so just go.
            OnboardingPrefs.of(context).edit()
                .putBoolean(OnboardingPrefs.KEY_BIOMETRICS_ENABLED, false)
                .apply()
            onContinue()
        }
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        OnboardingBackground(Modifier.fillMaxSize())

        Column(
            Modifier
                .fillMaxSize()
                .navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            OnboardingProgressBar(totalSteps = 4, currentStep = 3)

            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 24.dp)
            ) {
                Text(
                    "Secure your wallet",
                    style = TaliseType.heading(23.5.sp, FontWeight.SemiBold),
                    letterSpacing = (-0.705).sp,
                    color = TaliseColors.fg,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Set a 4-digit PIN or use biometrics to secure your wallet. Talise doesn't know your PIN.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    letterSpacing = (-0.39).sp,
                    lineHeight = 17.sp,
                    color = TaliseColors.fgMuted,
                )
            }

            PinDisplay(
                entry = entry,
                showPin = showPin,
                modifier = Modifier.padding(top = 22.dp),
            )

            Text(
                if (showPin) "Hide PIN" else "Show PIN",
                style = TaliseType.body(12.sp, FontWeight.Medium).copy(
                    textDecoration = TextDecoration.Underline,
                ),
                letterSpacing = (-0.36).sp,
                color = TaliseColors.fgMuted,
                modifier = Modifier
                    .clickable { showPin = !showPin }
                    .padding(vertical = 8.dp),
            )

            failureMessage?.let { msg ->
                Text(
                    msg,
                    style = TaliseType.body(12.sp),
                    color = TaliseColors.danger,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            Spacer(Modifier.weight(1f))

            Numpad(
                onDigit = ::tapDigit,
                onDelete = ::tapDelete,
                modifier = Modifier.padding(horizontal = 40.dp),
            )

            Spacer(Modifier.height(12.dp))

            if (biometricsAvailable) {
                SecondaryCta(
                    enabled = entry.length == PIN_LENGTH,
                    onClick = { requestBiometrics() },
                    modifier = Modifier
                        .padding(horizontal = 24.dp)
                        .padding(bottom = 10.dp),
                )
            }

            // Primary CTA.
            Box(
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 24.dp)
                    .fillMaxWidth()
                    .height(54.dp)
                    .clip(RoundedCornerShape(27.dp))
                    .background(
                        if (entry.length == PIN_LENGTH) TaliseColors.accent
                        else TaliseColors.accent.copy(alpha = 0.4f)
                    )
                    .clickable(enabled = entry.length == PIN_LENGTH) { persistAndContinue() },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Continue",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.45).sp,
                    color = TaliseColors.bg,
                )
            }
        }
    }
}

// ── PIN display ─────────────────────────────────────────────────────────────

/** Four squares — a filled circle (or the literal digit when Show PIN is on) per slot. */
@Composable
private fun PinDisplay(entry: String, showPin: Boolean, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        repeat(PIN_LENGTH) { idx ->
            val filled = idx < entry.length
            Box(
                Modifier
                    .width(56.dp)
                    .height(64.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (filled && !showPin) {
                    Box(
                        Modifier
                            .size(14.dp)
                            .clip(CircleShape)
                            .background(TaliseColors.fg)
                    )
                } else if (filled) {
                    Text(
                        entry[idx].toString(),
                        style = TaliseType.heading(24.sp, FontWeight.Medium),
                        color = TaliseColors.fg,
                    )
                }
            }
        }
    }
}

// ── Keypad ──────────────────────────────────────────────────────────────────

@Composable
private fun Numpad(
    onDigit: (String) -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf("", "0", "del"),
    )
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (row in rows) {
            Row(Modifier.fillMaxWidth()) {
                for (key in row) {
                    when (key) {
                        "" -> Spacer(Modifier.weight(1f).height(58.dp))
                        "del" -> Box(
                            Modifier
                                .weight(1f)
                                .height(58.dp)
                                .clip(CircleShape)
                                .clickable(onClick = onDelete),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.Backspace,
                                contentDescription = "Delete",
                                tint = TaliseColors.fg,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                        else -> Box(
                            Modifier
                                .weight(1f)
                                .height(58.dp)
                                .clip(CircleShape)
                                .clickable { onDigit(key) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                key,
                                style = TaliseType.display(30.sp, FontWeight.Normal),
                                color = TaliseColors.fg,
                            )
                        }
                    }
                }
            }
        }
    }
}

// ── CTAs ────────────────────────────────────────────────────────────────────

/** "Use Biometrics" — glass capsule, disabled until a 4-digit PIN is typed. */
@Composable
private fun SecondaryCta(enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .alpha(if (enabled) 1f else 0.4f)
            .clip(RoundedCornerShape(27.dp))
            .background(Color.White.copy(alpha = 0.08f))
            .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(27.dp))
            .clickable(enabled = enabled, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Outlined.Fingerprint,
            contentDescription = null,
            tint = TaliseColors.fg,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            "Use Biometrics",
            style = TaliseType.body(15.sp, FontWeight.Medium),
            letterSpacing = (-0.45).sp,
            color = TaliseColors.fg,
        )
    }
}

// ── Biometrics plumbing ─────────────────────────────────────────────────────

/** iOS `LAContext.canEvaluatePolicy` analog — framework BiometricManager, API 29+. */
private fun checkBiometricsAvailable(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    val manager = context.getSystemService(BiometricManager::class.java) ?: return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) ==
            BiometricManager.BIOMETRIC_SUCCESS
    } else {
        @Suppress("DEPRECATION")
        manager.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS
    }
}

/**
 * iOS `LAContext.evaluatePolicy` analog — either outcome calls [onResult] exactly once
 * (cancel via the negative button ALSO raises onAuthenticationError, so we de-dupe).
 */
@RequiresApi(Build.VERSION_CODES.Q)
private fun promptBiometrics(context: Context, onResult: (Boolean) -> Unit) {
    val executor = ContextCompat.getMainExecutor(context)
    val delivered = java.util.concurrent.atomic.AtomicBoolean(false)
    fun deliver(success: Boolean) {
        if (delivered.compareAndSet(false, true)) onResult(success)
    }
    val prompt = BiometricPrompt.Builder(context)
        .setTitle("Enable biometric unlock for Talise")
        .setNegativeButton("Cancel", executor) { _, _ -> deliver(false) }
        .build()
    prompt.authenticate(
        CancellationSignal(),
        executor,
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) {
                deliver(true)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                deliver(false)
            }
        },
    )
}
