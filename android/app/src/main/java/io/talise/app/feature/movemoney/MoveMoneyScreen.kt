package io.talise.app.feature.movemoney

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import io.talise.app.ui.components.ActionTile
import io.talise.app.ui.components.PremiumListRow
import io.talise.app.ui.components.TaliseIcons
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * "Move money" hub — iOS `WithdrawFlowView`. A 2×2 primary grid (Cash out / Send /
 * Send abroad / Send privately), expandable Cheques + Work groups, and a Payroll row.
 * Locked actions show "SOON" until their flow is built.
 */
@Composable
fun MoveMoneyScreen(nav: NavController) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Move money", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fgMuted)
            }
        }

        // 2×2 primary grid
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionTile(TaliseIcons.bank, "Cash out", "To your bank", onClick = {}, locked = true, modifier = Modifier.weight(1f))
            ActionTile(TaliseIcons.send, "Send", "@handle or address", onClick = { nav.navigate(Routes.SEND) }, modifier = Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionTile(TaliseIcons.globe, "Send abroad", "Their currency", onClick = {}, locked = true, modifier = Modifier.weight(1f))
            ActionTile(TaliseIcons.lock, "Send privately", "Amount hidden", onClick = {}, locked = true, modifier = Modifier.weight(1f))
        }

        // Groups (collapsed labels for now; expansion lands with their flows)
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 24.dp)) {
            PremiumListRow(icon = TaliseIcons.cheque, title = "Cheques", subtitle = "Write · Cash · My cheques", onClick = {})
        }
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 24.dp)) {
            PremiumListRow(icon = TaliseIcons.briefcase, title = "Work", subtitle = "Streams · Invoices · Contracts", onClick = {})
        }
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 24.dp)) {
            PremiumListRow(icon = TaliseIcons.team, title = "Payroll", subtitle = "Pay a team in one tap", onClick = { nav.navigate(Routes.PAYROLL) })
        }
    }
}
