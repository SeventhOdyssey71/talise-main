package io.talise.app.feature.earn

import android.content.Context
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * One-time opt-in disclosure presented before the user's FIRST supply — a
 * pixel port of iOS `EarnDisclosureSheet`. Regulatory + framing hygiene: Earn
 * is a SEPARATE, opt-in lending service routed through a third-party DeFi
 * protocol, NOT a property of the Talise balance, and yield is variable and
 * not guaranteed. The supply only runs after the explicit "I understand"
 * acceptance; Talise NEVER auto-supplies funds.
 */

// ── Acceptance persistence (iOS: UserDefaults earnDisclosureAcceptedV1) ─────

private const val EARN_PREFS = "io.talise.app.earn"
private const val DISCLOSURE_KEY = "earnDisclosureAcceptedV1"

internal fun hasAcceptedEarnDisclosure(context: Context): Boolean =
    context.getSharedPreferences(EARN_PREFS, Context.MODE_PRIVATE)
        .getBoolean(DISCLOSURE_KEY, false)

internal fun markEarnDisclosureAccepted(context: Context) {
    context.getSharedPreferences(EARN_PREFS, Context.MODE_PRIVATE)
        .edit().putBoolean(DISCLOSURE_KEY, true).apply()
}

// ── Sheet content ───────────────────────────────────────────────────────────

@Composable
internal fun EarnDisclosureSheet(
    apy: Double,
    moneyWord: String,
    onAccept: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Column(
            Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(top = 26.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            // Header
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "BEFORE YOU START",
                    style = TaliseType.mono(10.sp),
                    letterSpacing = 2.0.sp,
                    color = TaliseColors.fgMuted,
                )
                Text(
                    if (apy > 0) "Earn around %.2f%% on your %s".format(apy * 100, moneyWord)
                    else "Earn on your $moneyWord",
                    style = TaliseType.heading(24.sp, FontWeight.Medium),
                    letterSpacing = (-1).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "A few things to know first.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            // The three load-bearing disclosure points. Order is deliberate:
            // (1) separate service, (2) not part of your balance, (3) returns
            // aren't guaranteed.
            Column(
                Modifier
                    .fillMaxWidth()
                    .earnHeroGlass(radius = 20.dp)
                    .padding(horizontal = 18.dp, vertical = 4.dp),
            ) {
                DisclosurePoint(
                    icon = Icons.Outlined.AccountBalance,
                    title = "A separate lending service",
                    body = "Earn is optional and runs through a third-party lending protocol. It's not a banking or savings product offered by Talise.",
                )
                EarnRowDivider()
                DisclosurePoint(
                    icon = Icons.Outlined.AccountBalanceWallet,
                    title = "Not part of your balance",
                    body = "Money you put into Earn is moved into the lending service, separate from your spendable balance. You choose what to add, nothing moves automatically.",
                )
                EarnRowDivider()
                DisclosurePoint(
                    icon = Icons.AutoMirrored.Outlined.TrendingUp,
                    title = "Returns aren't guaranteed",
                    body = "Rates vary and can change. Earnings are not guaranteed, and your money is not insured or protected against loss.",
                )
            }

            Text(
                "By continuing you're choosing to use this optional service. You can withdraw your money at any time. This is not financial advice.",
                style = TaliseType.body(12.sp, FontWeight.Light),
                color = TaliseColors.fgDim,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
            Spacer(Modifier.height(8.dp))
        }

        // Action bar
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 12.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            LiquidGlassButton(
                title = "I understand, continue",
                tint = TaliseColors.accent,
                onClick = onAccept,
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(36.dp)
                    .clickable { onCancel() },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Not now",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }
        }
    }
}

@Composable
private fun DisclosurePoint(icon: ImageVector, title: String, body: String) {
    // Mirrors the PremiumListRow badge (36dp earn disc + accent glyph) but
    // carries a wrapping body paragraph — the explainer text is regulatory
    // and must render in full.
    Row(
        Modifier.fillMaxWidth().padding(vertical = 16.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(36.dp).background(TaliseColors.accent.copy(alpha = 0.18f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(14.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                title,
                style = TaliseType.body(14.sp, FontWeight.Light),
                letterSpacing = (-0.48).sp,
                color = TaliseColors.fg,
            )
            Text(
                body,
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
    }
}
