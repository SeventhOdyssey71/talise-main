package io.talise.app.feature.onboarding

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Off-ramp Phase 3 — iOS `OnboardingBankLinkView`. Optional onboarding step shown ONLY
 * to users who selected country == Nigeria ("NG") on the KYC screen. A lightweight
 * "get paid in Naira" prompt with two actions:
 *
 *   • Add bank account — [onAddBank] presents the bank add-flow; the caller invokes the
 *     provided `markLinked` once an account is linked (first account auto-becomes
 *     primary server-side). Android's add-flow screen has not landed yet, so this is a
 *     no-op until it does (tracked in the parity notes).
 *   • Skip for now — continue onboarding untouched.
 *
 * This step never blocks onboarding — it's purely additive for Nigerian users.
 */
@Composable
fun OnboardingBankLinkView(
    onContinue: () -> Unit,
    onAddBank: ((markLinked: () -> Unit) -> Unit)? = null,
) {
    var linked by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Header()

            if (linked) LinkedConfirmation() else ValueProps()

            Spacer(Modifier.height(12.dp))

            if (linked) {
                PrimaryButton(title = "Continue", onClick = onContinue)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    PrimaryButton(title = "Add bank account") {
                        onAddBank?.invoke { linked = true }
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                            .clickable(onClick = onContinue),
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
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(
            Modifier
                .size(56.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(TaliseColors.accentSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.AccountBalance,
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(26.dp),
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
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface)
    ) {
        Prop(
            icon = Icons.Filled.Payments,
            title = "Receive in Naira",
            sub = "Friends send you USDsui; it lands in your bank as NGN.",
        )
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
        Prop(
            icon = Icons.Filled.Bolt,
            title = "No extra steps later",
            sub = "Linked once, your @handle is ready to be paid.",
        )
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
        Prop(
            icon = Icons.Filled.Lock,
            title = "Private",
            sub = "Senders only see your bank name, never your account number.",
        )
    }
}

@Composable
private fun Prop(icon: ImageVector, title: String, sub: String) {
    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.Top) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = TaliseColors.accent,
            modifier = Modifier.width(24.dp).size(18.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
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
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Filled.Verified,
            contentDescription = null,
            tint = TaliseColors.greenMint,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
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
        Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(TaliseColors.greenMint)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            style = TaliseType.heading(16.sp, FontWeight.Medium),
            color = Color(0xFF0A140C),
        )
    }
}
