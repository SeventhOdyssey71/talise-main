package io.talise.app.feature.home

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlin.math.abs

@Composable
fun HomeScreen(nav: NavController, vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var hidden by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(TaliseColors.bg),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 110.dp),
    ) {
        item {
            // Top bar — wordmark + Copilot entry (mirrors the iOS Home agent button).
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("talise", style = TaliseType.heading(20.sp, FontWeight.SemiBold), color = TaliseColors.fg)
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .size(38.dp)
                        .background(TaliseColors.greenDeep.copy(alpha = 0.18f), CircleShape)
                        .clickable { nav.navigate(Routes.COPILOT) },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.AutoAwesome,
                        contentDescription = "Copilot",
                        tint = TaliseColors.accent,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }

        item {
            // Balance hero + privacy eye
            Column(Modifier.padding(horizontal = 24.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Eyebrow("Balance")
                    Icon(
                        if (hidden) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = "Toggle amounts",
                        tint = TaliseColors.fgDim,
                        modifier = Modifier.size(16.dp).clickable { hidden = !hidden },
                    )
                }
                Spacer(Modifier.height(6.dp))
                val usd = state.balances?.totalUsd ?: 0.0
                Text(
                    if (hidden) "••••" else formatUsd(usd),
                    style = TaliseType.display(42.sp, FontWeight.SemiBold),
                    letterSpacing = (-1.6).sp,
                    color = TaliseColors.fg,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    if (hidden) "•••• USDsui" else "${"%.2f".format(state.balances?.usdsui ?: 0.0)} USDsui",
                    style = TaliseType.mono(13.sp),
                    color = TaliseColors.fgMuted,
                )

                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    QuickAction(Icons.Filled.Add, "Add", TaliseColors.accent) { nav.navigate(Routes.DEPOSIT) }
                    QuickAction(Icons.AutoMirrored.Filled.ArrowForward, "Move", TaliseColors.accent) { nav.navigate(Routes.MOVE_MONEY) }
                }
            }
        }

        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(top = 28.dp, bottom = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Eyebrow("Recent activity")
            }
        }

        if (state.activity.isEmpty()) {
            item {
                Text(
                    if (state.loading) "Loading…" else "No activity yet",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                )
            }
        } else {
            item { Spacer(Modifier.height(0.dp)) }
            items(state.activity, key = { it.digest }) { entry ->
                Box(Modifier.padding(horizontal = 22.dp, vertical = 4.dp).fillMaxWidth().taliseGlass(radius = 16.dp)) {
                    HistoryRow(entry, hidden)
                }
            }
        }
    }
}

@Composable
private fun QuickAction(icon: ImageVector, label: String, tint: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(48.dp).background(tint.copy(alpha = 0.16f), CircleShape).clickable { onClick() },
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(20.dp)) }
        Text(label, style = TaliseType.body(11.sp), color = TaliseColors.fgMuted, modifier = Modifier.padding(top = 6.dp))
    }
}

/** One activity row — iOS `HistoryRow`: directional badge, team/cashout labels, signed amount. */
@Composable
private fun HistoryRow(entry: ActivityEntryDTO, hidden: Boolean) {
    val isTeam = entry.team != null
    val isCashout = entry.offramp != null || (entry.direction == "withdraw" && entry.venue == "bridge")
    val inflow = entry.direction == "received" || entry.direction == "withdraw"

    val (badgeBg, badgeFg, icon) = when {
        isTeam -> Triple(TaliseColors.sentRed.copy(alpha = 0.16f), TaliseColors.sentRedSoft, Icons.Filled.Groups)
        isCashout -> Triple(TaliseColors.sentRed.copy(alpha = 0.16f), TaliseColors.sentRedSoft, Icons.Filled.ArrowUpward)
        inflow -> Triple(TaliseColors.receivedGreen.copy(alpha = 0.20f), TaliseColors.greenMint, Icons.Filled.ArrowDownward)
        else -> Triple(TaliseColors.sentRed.copy(alpha = 0.16f), TaliseColors.sentRedSoft, Icons.Filled.ArrowUpward)
    }

    val title = when {
        isTeam -> "Paid ${entry.team?.name ?: "your team"}"
        isCashout && entry.offramp != null -> "Cash out to Nigeria"
        isCashout -> "Cash out to United States"
        entry.direction == "received" -> entry.counterpartyName?.let { "Received from $it" } ?: "Received"
        entry.direction == "invest" -> "Invested"
        entry.direction == "withdraw" -> "Withdrew"
        else -> entry.counterpartyName?.let { "Sent to $it" } ?: "Sent"
    }
    val subtitle = entry.team?.let { "${it.recipientCount} people" } ?: relativeTime(entry.timestampMs)

    val amount = entry.amountUsdsui ?: 0.0
    val amountStr = if (hidden) "••••" else (if (inflow) "+" else "-") + formatUsd(abs(amount))

    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp).background(badgeBg, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = badgeFg, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fg, letterSpacing = (-0.48).sp)
            Text(subtitle, style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
        }
        Text(
            amountStr,
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = if (inflow) TaliseColors.receivedGreen else TaliseColors.fg,
        )
    }
}

private fun formatUsd(v: Double): String = "$" + "%,.2f".format(v)

private fun relativeTime(ms: Double): String {
    val diff = System.currentTimeMillis() - ms.toLong()
    val mins = diff / 60_000
    return when {
        mins < 1 -> "now"
        mins < 60 -> "${mins}m ago"
        mins < 1440 -> "${mins / 60}h ago"
        else -> "${mins / 1440}d ago"
    }
}
