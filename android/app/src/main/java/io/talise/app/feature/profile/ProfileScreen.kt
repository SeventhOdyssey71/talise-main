package io.talise.app.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import io.talise.app.core.session.AppSession
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassPill
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.components.PremiumListRow
import io.talise.app.ui.components.TaliseIcons
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Profile tab — iOS `ProfileView`. A solid forest hero card (avatar + name + handle
 * chip + email), a three-cell stats strip, and flat section cards (Payroll, Wallet,
 * Help) closing on a sign-out button + version footer.
 */
@Composable
fun ProfileScreen(nav: NavController) {
    val user = AppSession.currentUser
    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    val forest = Brush.linearGradient(listOf(Color(0xFF3A6E2A), Color(0xFF224417)))

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        Hero(user?.displayName, user?.handle, user?.email, forest)
        StatsStrip()

        Section("Payroll") {
            PremiumListRow(
                icon = TaliseIcons.team,
                title = "Team payments",
                subtitle = "Pay a team in one tap",
                onClick = { nav.navigate(Routes.PAYROLL) },
            )
        }

        Section("Wallet") {
            Column {
                Text(
                    user?.suiAddress ?: "—",
                    style = TaliseType.mono(12.sp, FontWeight.Light),
                    color = TaliseColors.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
                )
                Divider()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    LiquidGlassPill(title = "Copy", onClick = {
                        user?.suiAddress?.let { clipboard.setText(AnnotatedString(it)) }
                    })
                    LiquidGlassPill(title = "Suiscan", onClick = {
                        user?.suiAddress?.let { uriHandler.openUri("https://suiscan.xyz/mainnet/account/$it") }
                    })
                }
            }
        }

        Section("Help") {
            Column {
                LinkRow(Icons.AutoMirrored.Filled.HelpOutline, "Support") { uriHandler.openUri("https://talise.io") }
                Divider()
                LinkRow(Icons.Filled.Shield, "Privacy Policy") { uriHandler.openUri("https://talise.io/privacy") }
                Divider()
                LinkRow(Icons.Filled.Description, "Terms of Service") { uriHandler.openUri("https://talise.io/terms") }
            }
        }

        SignOutButton(onClick = { AppSession.signOut() })

        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.Center) {
            MicroLabel("TALISE", color = TaliseColors.fgDim)
        }
        Spacer(Modifier.height(120.dp))
    }
}

/** Solid forest hero card — avatar, name, handle chip, sign-in email. */
@Composable
private fun Hero(name: String?, handle: String?, email: String?, forest: Brush) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(26.dp))
            .background(forest, RoundedCornerShape(26.dp))
            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(26.dp))
            .padding(vertical = 26.dp, horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Initials disc — flat fallback avatar (mirrors iOS `initialsDisc`).
        Box(
            Modifier.size(88.dp).clip(CircleShape).background(TaliseColors.surface2)
                .border(2.dp, Color.White.copy(alpha = 0.25f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(initials(name, email), style = TaliseType.heading(32.sp, FontWeight.Medium), color = TaliseColors.fg)
        }
        Text(name ?: "—", style = TaliseType.heading(21.sp, FontWeight.SemiBold), letterSpacing = (-0.5).sp, color = Color.White, maxLines = 1)
        if (!handle.isNullOrEmpty()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.background(Color.White.copy(alpha = 0.12f), CircleShape).padding(horizontal = 11.dp, vertical = 5.dp),
            ) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(11.dp))
                Text("$handle@talise", style = TaliseType.mono(12.sp), color = Color.White.copy(alpha = 0.9f))
            }
        } else {
            Text("Claim your name", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.greenMint)
        }
        Text(email ?: "", style = TaliseType.mono(11.sp, FontWeight.Light), color = Color.White.copy(alpha = 0.6f), maxLines = 1)
    }
}

/** Three-cell standing strip — KYC, Rewards tier, Points — divided by hairlines. */
@Composable
private fun StatsStrip() {
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface, RoundedCornerShape(20.dp)),
    ) {
        StatCell("KYC", "—", false, Modifier.weight(1f))
        VDivider()
        StatCell("Rewards", "Bronze", false, Modifier.weight(1f))
        VDivider()
        StatCell("Points", "0", false, Modifier.weight(1f))
    }
}

@Composable
private fun StatCell(label: String, value: String, accent: Boolean, modifier: Modifier = Modifier) {
    Column(modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Eyebrow(label)
        Text(value, style = TaliseType.heading(14.sp, FontWeight.Medium), color = if (accent) TaliseColors.accent else TaliseColors.fg, maxLines = 1)
    }
}

@Composable
private fun VDivider() {
    Box(Modifier.width(1.dp).fillMaxHeight().padding(vertical = 12.dp).background(TaliseColors.line))
}

@Composable
private fun Divider() {
    Box(Modifier.fillMaxWidth().padding(start = 18.dp).height(1.dp).background(TaliseColors.line))
}

/** Section with an outside eyebrow title above a flat section card. iOS `section`. */
@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(title)
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) { content() }
    }
}

@Composable
private fun LinkRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = TaliseColors.fgMuted, modifier = Modifier.size(18.dp))
        Text(label, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fg, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun SignOutButton(onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(50.dp)
            .clip(CircleShape)
            .background(TaliseColors.surface2, CircleShape)
            .clickable { onClick() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = Color(0xFFE08D8A), modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text("Sign out", style = TaliseType.heading(15.sp, FontWeight.Medium), color = Color(0xFFE08D8A))
    }
}

private fun initials(name: String?, email: String?): String {
    name?.trim()?.split(" ")?.firstOrNull()?.firstOrNull()?.let { return it.uppercaseChar().toString() }
    email?.substringBefore("@")?.firstOrNull()?.let { return it.uppercaseChar().toString() }
    return "·"
}
