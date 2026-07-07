package io.talise.app.feature.kyc

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Paid
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseDimens
import io.talise.app.ui.theme.TaliseType

/**
 * Off-ramp Phase 3 — optional onboarding step shown ONLY to users who selected
 * country == Nigeria ("NG") on the verify screen. Ported 1:1 from iOS
 * `OnboardingBankLinkView`: a lightweight "get paid in Naira" prompt.
 *
 * `linked` flips after the add-flow succeeds; the primary action then becomes
 * "Continue". The add-flow itself (iOS `AddBankAccountView`) is not ported yet,
 * so [onAddBankAccount] is a hook for the future profile bank flow. After
 * either action the screen calls [onContinue]; the parent then finishes
 * onboarding as normal. This step never blocks onboarding.
 */
@Composable
fun OnboardingBankLink(
    onContinue: () -> Unit,
    linked: Boolean = false,
    onAddBankAccount: () -> Unit = {},
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(TaliseDimens.xl),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Header()

            if (linked) {
                LinkedConfirmation()
            } else {
                ValueProps()
            }

            Spacer(Modifier.height(TaliseDimens.md))

            if (linked) {
                PrimaryButton(title = "Continue", onClick = onContinue)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
                    PrimaryButton(title = "Add bank account", onClick = onAddBankAccount)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .clickable { onContinue() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Skip for now",
                            style = TaliseType.body(15.sp),
                            color = TaliseColors.fgMuted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Header() {
    Column(verticalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(TaliseColors.accentSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.AccountBalance,
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(28.dp),
            )
        }
        Text(
            "Get paid in Naira",
            style = TaliseType.display(30.sp, FontWeight.Medium),
            letterSpacing = (-0.8).sp,
            color = TaliseColors.fg,
        )
        Text(
            "Add a Nigerian bank account so people can pay you straight to your bank, in Naira. You can always do this later from your profile.",
            style = TaliseType.body(14.sp),
            lineHeight = 20.sp,
            color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun ValueProps() {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(TaliseDimens.radiusLg))
            .background(TaliseColors.surface),
    ) {
        Prop(
            icon = Icons.Filled.Paid,
            title = "Receive in Naira",
            sub = "Friends send you USDsui; it lands in your bank as NGN.",
        )
        Divider()
        Prop(
            icon = Icons.Filled.Bolt,
            title = "No extra steps later",
            sub = "Linked once, your @handle is ready to be paid.",
        )
        Divider()
        Prop(
            icon = Icons.Filled.Lock,
            title = "Private",
            sub = "Senders only see your bank name, never your account number.",
        )
    }
}

@Composable
private fun Divider() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(TaliseColors.line),
    )
}

@Composable
private fun Prop(icon: ImageVector, title: String, sub: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(TaliseDimens.lg),
        horizontalArrangement = Arrangement.spacedBy(TaliseDimens.md),
    ) {
        Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(18.dp),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                title,
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
            Text(
                sub,
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
    }
}

@Composable
private fun LinkedConfirmation() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TaliseDimens.radiusLg))
            .background(TaliseColors.surface)
            .padding(TaliseDimens.lg),
        horizontalArrangement = Arrangement.spacedBy(TaliseDimens.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Filled.Verified,
            contentDescription = null,
            tint = TaliseColors.greenMint,
            modifier = Modifier.size(22.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                "Bank account linked",
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
            Text(
                "You're set to get paid in Naira.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
    }
}

@Composable
private fun PrimaryButton(title: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(TaliseColors.greenMint)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            style = TaliseType.heading(16.sp, FontWeight.Medium),
            color = TaliseColors.inkOnGreen,
        )
    }
}
