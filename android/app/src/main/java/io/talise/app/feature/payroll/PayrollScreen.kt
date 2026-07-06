package io.talise.app.feature.payroll

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.core.model.TeamDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Payroll / Teams hub, a pixel port of iOS `PayrollView`. Lists saved teams
 * from `/api/payouts/teams`: a mono eyebrow + title + subtitle, a mint "New team"
 * capsule, then a card per team (badge · name · people · saved total · chevron).
 * Loading, error, and empty states mirror iOS. Create/edit/pay land in phase 2.
 */
@Composable
fun PayrollScreen(onClose: () -> Unit) {
    val state by produceState<PayrollState>(PayrollState.Loading) {
        value = runCatching { ApiClient.api.teams().teams }
            .fold({ PayrollState.Loaded(it) }, { PayrollState.Failed })
    }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Back affordance, iOS relies on the nav-stack chevron; keep onClose reachable.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 18.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(34.dp).background(TaliseColors.surface2, CircleShape).clickable { onClose() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = TaliseColors.fg,
                    modifier = Modifier.size(15.dp),
                )
            }
        }

        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp).padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // ── Header ──
            Column(
                Modifier.padding(top = 4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    "PAYROLL",
                    style = TaliseType.mono(10.sp),
                    letterSpacing = 1.4.sp,
                    color = TaliseColors.fgDim,
                )
                Text(
                    "Pay your team",
                    style = TaliseType.heading(26.sp, FontWeight.Medium),
                    letterSpacing = (-0.6).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "Save a team once, then pay everyone in one tap, one gasless transaction.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            // ── New team capsule ──
            Row(
                Modifier.fillMaxWidth().height(54.dp)
                    .background(TaliseColors.greenMint, CircleShape)
                    .clickable { /* phase 2: TeamEditView */ },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Filled.Add, contentDescription = null, tint = Color.Black, modifier = Modifier.size(14.dp))
                Spacer(Modifier.size(10.dp))
                Text("New team", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = Color.Black)
            }

            when (state) {
                PayrollState.Loading -> LoadingState()
                PayrollState.Failed -> ErrorState()
                is PayrollState.Loaded -> {
                    val teams = (state as PayrollState.Loaded).teams
                    if (teams.isEmpty()) {
                        EmptyState()
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            teams.forEach { TeamRow(it) }
                        }
                    }
                }
            }

            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun TeamRow(team: TeamDTO) {
    val people = if (team.members.size == 1) "1 person" else "${team.members.size} people"
    val total = team.members.sumOf { it.amount ?: 0.0 }
    Row(
        Modifier.fillMaxWidth().rampCard()
            .clickable { /* phase 2: PayTeamView */ }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(46.dp).background(TaliseColors.greenMint.copy(alpha = 0.12f), RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(R.drawable.hi_team),
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(18.dp),
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                team.name,
                style = TaliseType.heading(16.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(people, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("$%,.2f".format(total), style = TaliseType.mono(14.sp), color = TaliseColors.fg)
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

@Composable
private fun LoadingState() {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(3) {
            Box(Modifier.fillMaxWidth().height(78.dp).taliseGlass(radius = 20.dp))
        }
    }
}

@Composable
private fun ErrorState() {
    Column(
        Modifier.fillMaxWidth().padding(top = 50.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Couldn't load your teams right now.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun EmptyState() {
    Column(
        Modifier.fillMaxWidth().padding(top = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            painterResource(R.drawable.hi_team),
            contentDescription = null,
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(38.dp),
        )
        Text("No teams yet", style = TaliseType.heading(18.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            "Create one to pay a group in one transaction.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

private sealed interface PayrollState {
    data object Loading : PayrollState
    data object Failed : PayrollState
    data class Loaded(val teams: List<TeamDTO>) : PayrollState
}
