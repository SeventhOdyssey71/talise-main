package io.talise.app.feature.payroll

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.model.TeamDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.PremiumListRow
import io.talise.app.ui.components.TaliseIcons
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Payroll teams — iOS `PayrollView`. Lists saved teams from `/api/payouts/teams`.
 * Create/edit/pay (prepare→sign→record, gasless) land in phase 2.
 */
@Composable
fun PayrollScreen(onClose: () -> Unit) {
    val teams by produceState<List<TeamDTO>?>(initialValue = null) {
        value = runCatching { ApiClient.api.teams().teams }.getOrDefault(emptyList())
    }

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Eyebrow("Payroll")
                Text("Pay your team", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
            }
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fgMuted) }
        }
        Text(
            "Save a team once, then pay everyone in one tap — one gasless transaction.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )

        val list = teams
        when {
            list == null -> Text("Loading…", style = TaliseType.body(13.sp), color = TaliseColors.fgMuted)
            list.isEmpty() -> Text("No teams yet. Create one to pay a group in one transaction.", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            else -> Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) {
                list.forEach { team ->
                    val people = if (team.members.size == 1) "1 person" else "${team.members.size} people"
                    val total = team.members.sumOf { it.amount ?: 0.0 }
                    PremiumListRow(
                        icon = TaliseIcons.team,
                        title = team.name,
                        subtitle = people,
                        trailing = { Text("$%,.2f".format(total), style = TaliseType.mono(14.sp), color = TaliseColors.fg) },
                        onClick = { /* phase 2: PayTeamScreen */ },
                    )
                }
            }
        }
    }
}
