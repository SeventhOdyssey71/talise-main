package io.talise.app.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import io.talise.app.core.session.AppSession
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.PremiumListRow
import io.talise.app.ui.components.TaliseIcons
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** Profile tab — iOS `ProfileView`: hero + wallet + payroll + sign-out (live sections in phase 2). */
@Composable
fun ProfileScreen(nav: NavController) {
    val user = AppSession.currentUser

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).verticalScroll(rememberScrollState()).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // Hero
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(72.dp).background(TaliseColors.surface2, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Person, contentDescription = null, tint = TaliseColors.fgMuted, modifier = Modifier.size(34.dp))
            }
            Text(user?.displayName ?: "You", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fg, modifier = Modifier.padding(top = 12.dp))
            Text(user?.handle ?: "Claim your @handle", style = TaliseType.body(13.sp), color = TaliseColors.fgMuted)
        }

        Eyebrow("Payroll")
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) {
            PremiumListRow(icon = TaliseIcons.team, title = "Team payments", subtitle = "Pay a team in one tap", onClick = { nav.navigate(Routes.PAYROLL) })
        }

        Eyebrow("Wallet")
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) {
            PremiumListRow(icon = TaliseIcons.wallet, title = "Sui address", subtitle = user?.suiAddress?.let { it.take(8) + "…" + it.takeLast(4) } ?: "—", showChevron = false, onClick = {})
        }

        LiquidGlassButton(
            title = "Sign out",
            tint = null,
            onClick = { AppSession.signOut() },
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
