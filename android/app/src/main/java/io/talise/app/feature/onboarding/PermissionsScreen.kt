package io.talise.app.feature.onboarding

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Notifications
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Step 4/4 — iOS `PermissionsScreen`. Asks for the two permissions Talise actually
 * needs day one: camera (QR scanning in Send) and notifications (transaction updates).
 *
 * UX rule: never block. Denial still calls [onContinue] — the user can always re-grant
 * later from system Settings, and we surface that path from Profile.
 */
@Composable
fun PermissionsScreen(onContinue: () -> Unit) {
    val context = LocalContext.current
    var requesting by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        // Either result advances — denial is not a blocker.
        requesting = false
        OnboardingPrefs.of(context).edit()
            .putBoolean(OnboardingPrefs.KEY_PERMISSIONS_REQUESTED, true)
            .apply()
        onContinue()
    }

    fun requestPermissions() {
        if (requesting) return
        requesting = true
        val permissions = buildList {
            add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        launcher.launch(permissions.toTypedArray())
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        OnboardingBackground(Modifier.fillMaxSize())

        Column(
            Modifier
                .fillMaxSize()
                .navigationBarsPadding()
        ) {
            OnboardingProgressBar(totalSteps = 4, currentStep = 4)

            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 28.dp)
            ) {
                Text(
                    "Enable Permissions",
                    style = TaliseType.heading(23.5.sp, FontWeight.SemiBold),
                    letterSpacing = (-0.705).sp,
                    color = TaliseColors.fg,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Talise needs camera access to scan QR codes and notifications to keep you updated on transactions.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    letterSpacing = (-0.39).sp,
                    lineHeight = 17.sp,
                    color = TaliseColors.fgMuted,
                )
            }

            Spacer(Modifier.weight(1f))

            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                PermissionBullet(
                    icon = Icons.Filled.CameraAlt,
                    title = "Camera",
                    body = "Scan recipient QR codes when sending money.",
                )
                PermissionBullet(
                    icon = Icons.Filled.Notifications,
                    title = "Notifications",
                    body = "Get notified when a payment lands or fails.",
                )
            }

            // Primary CTA — accent capsule with a camera glyph.
            Row(
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 10.dp)
                    .fillMaxWidth()
                    .height(54.dp)
                    .alpha(if (requesting) 0.6f else 1f)
                    .clip(RoundedCornerShape(27.dp))
                    .background(TaliseColors.accent)
                    .clickable(enabled = !requesting) { requestPermissions() },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.CameraAlt,
                    contentDescription = null,
                    tint = TaliseColors.bg,
                    modifier = Modifier.size(17.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "Enable Permissions",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.45).sp,
                    color = TaliseColors.bg,
                )
            }

            // Secondary "Continue" skip.
            Box(
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 24.dp)
                    .fillMaxWidth()
                    .height(54.dp)
                    .clip(RoundedCornerShape(27.dp))
                    .background(Color.White.copy(alpha = 0.08f))
                    .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(27.dp))
                    .clickable(onClick = onContinue),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Continue",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.45).sp,
                    color = TaliseColors.fg,
                )
            }
        }
    }
}

@Composable
private fun PermissionBullet(icon: ImageVector, title: String, body: String) {
    Row(verticalAlignment = Alignment.Top) {
        Box(
            Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.10f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = TaliseColors.fg,
                modifier = Modifier.size(17.dp),
            )
        }

        Spacer(Modifier.width(14.dp))

        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                title,
                style = TaliseType.body(14.sp, FontWeight.Medium),
                letterSpacing = (-0.42).sp,
                color = TaliseColors.fg,
            )
            Text(
                body,
                style = TaliseType.body(12.sp, FontWeight.Light),
                letterSpacing = (-0.36).sp,
                color = TaliseColors.fgMuted,
            )
        }
    }
}
