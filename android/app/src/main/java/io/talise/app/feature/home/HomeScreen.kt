package io.talise.app.feature.home

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowOutward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Eco
import androidx.compose.material.icons.filled.Hexagon
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.SouthWest
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import io.talise.app.R
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.core.model.ActivityOtherCoin
import io.talise.app.core.session.AppSession
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlin.math.abs
import kotlin.math.pow

// Directional palette, ported verbatim from iOS HistoryRow hex literals.
private val SENT_RED = Color(0xFFE5484D)
private val SENT_RED_SOFT = Color(0xFFFF6B6B)
private val RECEIVED_GREEN = Color(0xFF79D96C)
private val RECEIVED_MINT = Color(0xFFCAFFB8)
private val WITHDRAW_MINT = Color(0xFFCAFFB8)
private val WITHDRAW_FOREST = Color(0xFF2E5E1F)
private val AMOUNT_GREEN = Color(0xFF4FB35E)

/** FLAT card, iOS `.flatCard`: solid `surface` fill + clip, NO border/blur/gradient. */
private fun Modifier.flatCard(radius: androidx.compose.ui.unit.Dp = 25.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this.clip(shape).background(TaliseColors.surface, shape)
}

@Composable
fun HomeScreen(nav: NavController, vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val phase by AppSession.phase.collectAsStateWithLifecycle()
    var hidden by remember { mutableStateOf(false) }

    val handle: String? = when (val p = phase) {
        is AppSession.Phase.Ready -> p.user.handle
        is AppSession.Phase.Onboarding -> p.user.handle
        else -> null
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(TaliseColors.bg),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 120.dp),
    ) {
        // ── Top bar: wordmark left, agent (Copilot) mascot right ──────────
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 30.dp).padding(top = 4.dp).height(38.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(
                    painter = painterResource(R.drawable.taliselogo),
                    contentDescription = "Talise",
                    modifier = Modifier.width(24.dp).height(22.dp),
                )
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier.size(40.dp).clip(CircleShape).clickable { nav.navigate(Routes.COPILOT) },
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        painter = painterResource(R.drawable.applogo),
                        contentDescription = "Talise Copilot",
                        modifier = Modifier.size(30.dp),
                    )
                }
            }
        }

        // ── Balance hero + privacy eye + action pills ─────────────────────
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 30.dp).padding(top = 32.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "BALANCE",
                            style = TaliseType.mono(10.sp),
                            letterSpacing = 2.0.sp,
                            color = TaliseColors.fgMuted,
                        )
                        Icon(
                            if (hidden) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = "Toggle amounts",
                            tint = TaliseColors.fgDim,
                            modifier = Modifier.size(11.dp).clickable { hidden = !hidden },
                        )
                    }

                    val usdsui = state.balances?.usdsui ?: 0.0
                    Text(
                        balanceHero(usdsui, hidden),
                        style = TaliseType.display(40.sp, FontWeight.SemiBold),
                        letterSpacing = (-1.6).sp,
                        maxLines = 1,
                    )

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(top = 2.dp),
                    ) {
                        Text(
                            usdsuiSubline(usdsui, hidden),
                            style = TaliseType.mono(10.sp, FontWeight.Light),
                            letterSpacing = (-0.4).sp,
                            color = TaliseColors.fgMuted,
                        )
                        Text("·", style = TaliseType.mono(10.sp, FontWeight.Light), color = TaliseColors.fgDim)
                        Text(
                            "Earn on your idle balance",
                            style = TaliseType.mono(10.sp, FontWeight.Light),
                            letterSpacing = (-0.4).sp,
                            color = TaliseColors.accent,
                        )
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(bottom = 6.dp),
                ) {
                    ActionPill(Icons.Filled.Add) { nav.navigate(Routes.DEPOSIT) }
                    ActionPill(Icons.AutoMirrored.Filled.Send) { nav.navigate(Routes.MOVE_MONEY) }
                }
            }
        }

        // ── Home card carousel: account card + token bucket ───────────────
        item {
            Column(Modifier.padding(top = 24.dp)) {
                val pager = rememberPagerState(pageCount = { 2 })
                HorizontalPager(
                    state = pager,
                    pageSpacing = 0.dp,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 32.dp),
                ) { page ->
                    if (page == 0) UsernameCard(handle) else TokenBucketCard()
                }
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        repeat(2) { i ->
                            Box(
                                Modifier.size(6.dp).clip(CircleShape).background(
                                    if (i == pager.currentPage) TaliseColors.fg
                                    else TaliseColors.fgDim.copy(alpha = 0.45f),
                                ),
                            )
                        }
                    }
                }
            }
        }

        // ── Recent activity header ────────────────────────────────────────
        item {
            Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(top = 28.dp)) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 0.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "RECENT ACTIVITY",
                        style = TaliseType.mono(10.sp),
                        letterSpacing = 2.0.sp,
                        color = TaliseColors.fgMuted,
                    )
                    Spacer(Modifier.weight(1f))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("View all", style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = TaliseColors.fgMuted,
                            modifier = Modifier.size(12.dp),
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))

                val rows = state.activity.take(4)
                if (rows.isEmpty()) {
                    Box(Modifier.fillMaxWidth().flatCard(radius = 20.dp).padding(horizontal = 16.dp, vertical = 22.dp)) {
                        Text(
                            if (state.loading) "Loading" else "No activity yet",
                            style = TaliseType.body(13.sp, FontWeight.Light),
                            color = TaliseColors.fgDim,
                        )
                    }
                } else {
                    Column(Modifier.fillMaxWidth().flatCard(radius = 20.dp)) {
                        rows.forEachIndexed { i, entry ->
                            HistoryRow(entry, hidden)
                            if (i < rows.size - 1) {
                                Box(
                                    Modifier.fillMaxWidth().padding(start = 64.dp).height(0.75.dp)
                                        .background(TaliseColors.line),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 44dp accent action pill, iOS `actionButton(accented:)`: solid accent fill, near-black ink, radius 13. */
@Composable
private fun ActionPill(icon: ImageVector, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(13.dp)).background(TaliseColors.accent).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = TaliseColors.bg, modifier = Modifier.size(16.dp))
    }
}

/** Account card (carousel page 0), handle + copy, or the Claim CTA. */
@Composable
private fun UsernameCard(handle: String?) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            kotlinx.coroutines.delay(1400)
            copied = false
        }
    }

    Box(Modifier.fillMaxWidth().height(212.dp).flatCard(radius = 25.dp)) {
        Image(
            painter = painterResource(R.drawable.suicoinmark),
            contentDescription = null,
            modifier = Modifier.align(Alignment.TopEnd).padding(top = 22.dp, end = 24.dp).size(26.dp),
        )
        Column(Modifier.fillMaxSize().padding(horizontal = 32.dp)) {
            if (handle != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    modifier = Modifier.padding(top = 27.dp),
                ) {
                    Text(
                        handle,
                        style = TaliseType.heading(20.sp, FontWeight.Medium),
                        letterSpacing = (-0.8).sp,
                        color = TaliseColors.fgSubtle,
                        maxLines = 1,
                    )
                    Icon(
                        if (copied) Icons.Filled.Check else Icons.Filled.ContentCopy,
                        contentDescription = "Copy username",
                        tint = TaliseColors.greenMint,
                        modifier = Modifier.size(13.dp).clickable {
                            clipboard.setText(AnnotatedString(handle))
                            copied = true
                        },
                    )
                }
            } else {
                Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "Claim your name",
                        style = TaliseType.heading(20.sp, FontWeight.Medium),
                        letterSpacing = (-0.8).sp,
                        color = TaliseColors.fgSubtle,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "So friends can send you USDsui by name.",
                            style = TaliseType.body(12.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                            maxLines = 2,
                        )
                        Icon(Icons.Filled.NorthEast, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(10.dp))
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Row(
                Modifier.fillMaxWidth().padding(bottom = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("$0.00 FEE", style = TaliseType.mono(8.sp), letterSpacing = (-0.32).sp, color = TaliseColors.fg)
                Spacer(Modifier.weight(1f))
                Text("YOUR MONEY LANDS HERE", style = TaliseType.mono(8.sp), letterSpacing = (-0.32).sp, color = TaliseColors.fg)
            }
        }
    }
}

/** Token bucket card (carousel page 1). */
@Composable
private fun TokenBucketCard() {
    Box(Modifier.fillMaxWidth().height(212.dp).flatCard(radius = 25.dp)) {
        Icon(
            Icons.Filled.Hexagon,
            contentDescription = null,
            tint = TaliseColors.greenMint.copy(alpha = 0.9f),
            modifier = Modifier.align(Alignment.TopEnd).padding(top = 22.dp, end = 24.dp).size(22.dp),
        )
        Column(Modifier.fillMaxSize().padding(horizontal = 32.dp)) {
            Text(
                "Token bucket",
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                letterSpacing = (-0.8).sp,
                color = TaliseColors.fgSubtle,
                modifier = Modifier.padding(top = 27.dp),
            )
            Text(
                "No other tokens yet",
                style = TaliseType.body(13.sp),
                color = TaliseColors.fgMuted,
                modifier = Modifier.padding(top = 7.dp),
            )
            Spacer(Modifier.weight(1f))
            Row(
                Modifier.fillMaxWidth().padding(bottom = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("OTHER TOKENS", style = TaliseType.mono(8.sp), letterSpacing = (-0.32).sp, color = TaliseColors.fg)
                Spacer(Modifier.weight(1f))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("TAP TO VIEW", style = TaliseType.mono(8.sp), letterSpacing = (-0.32).sp, color = TaliseColors.fg)
                    Icon(Icons.Filled.NorthEast, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(8.dp))
                }
            }
        }
    }
}

// ── Activity row ──────────────────────────────────────────────────────────

private enum class RowCategory { SENT, RECEIVED, INVEST, WITHDRAW, AUTOSWAP, CASHOUT, TEAM, NEUTRAL }

/** One history row, mirrors iOS `HistoryRow`: directional badge, category title, signed amount. */
@Composable
private fun HistoryRow(entry: ActivityEntryDTO, hidden: Boolean) {
    val category = categoryOf(entry)

    val badgeBg: Color = when (category) {
        RowCategory.SENT, RowCategory.CASHOUT, RowCategory.TEAM -> SENT_RED.copy(alpha = 0.16f)
        RowCategory.RECEIVED -> RECEIVED_GREEN.copy(alpha = 0.20f)
        RowCategory.INVEST, RowCategory.AUTOSWAP -> TaliseColors.accent.copy(alpha = 0.20f)
        RowCategory.WITHDRAW -> WITHDRAW_MINT.copy(alpha = 0.42f)
        RowCategory.NEUTRAL -> TaliseColors.surface2
    }
    val badgeFg: Color = when (category) {
        RowCategory.SENT, RowCategory.CASHOUT, RowCategory.TEAM -> SENT_RED_SOFT
        RowCategory.RECEIVED -> RECEIVED_MINT
        RowCategory.INVEST, RowCategory.AUTOSWAP -> TaliseColors.accent
        RowCategory.WITHDRAW -> WITHDRAW_FOREST
        RowCategory.NEUTRAL -> TaliseColors.fg
    }
    val icon: ImageVector = when (category) {
        RowCategory.SENT -> Icons.Filled.ArrowOutward
        RowCategory.CASHOUT -> Icons.Filled.AccountBalance
        RowCategory.RECEIVED -> Icons.Filled.SouthWest
        RowCategory.INVEST, RowCategory.AUTOSWAP -> Icons.Filled.Eco
        RowCategory.WITHDRAW -> Icons.Outlined.Eco
        RowCategory.TEAM -> Icons.Filled.AccountBalance // unused, team uses hi_team painter
        RowCategory.NEUTRAL -> Icons.Outlined.Circle
    }

    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(badgeBg), contentAlignment = Alignment.Center) {
            if (category == RowCategory.TEAM) {
                Icon(painterResource(R.drawable.hi_team), contentDescription = null, tint = badgeFg, modifier = Modifier.size(18.dp))
            } else {
                Icon(icon, contentDescription = null, tint = badgeFg, modifier = Modifier.size(14.dp))
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                titleOf(entry, category),
                style = TaliseType.body(13.sp, FontWeight.Light),
                letterSpacing = (-0.48).sp,
                color = TaliseColors.fg,
            )
            Text(
                subtitleOf(entry),
                style = TaliseType.mono(8.sp),
                letterSpacing = (-0.32).sp,
                color = TaliseColors.fgDim,
            )
        }
        Text(
            if (hidden) "••••" else amountOf(entry, category),
            style = TaliseType.body(14.sp, FontWeight.Light),
            letterSpacing = (-0.56).sp,
            color = if (hidden) TaliseColors.fgMuted else amountColorOf(entry, category),
        )
    }
}

private fun categoryOf(e: ActivityEntryDTO): RowCategory = when {
    e.offramp != null -> RowCategory.CASHOUT
    e.direction == "withdraw" && e.venue == "bridge" -> RowCategory.CASHOUT
    e.team != null -> RowCategory.TEAM
    e.direction == "received" -> RowCategory.RECEIVED
    e.direction == "invest" -> RowCategory.INVEST
    e.direction == "withdraw" -> RowCategory.WITHDRAW
    e.direction == "autoswap" || e.direction == "swap" -> RowCategory.AUTOSWAP
    e.direction == "sent" -> RowCategory.SENT
    else -> RowCategory.NEUTRAL
}

private fun counterpartyLabel(e: ActivityEntryDTO): String? {
    e.counterpartyName?.let { if (it.isNotEmpty()) return it }
    val addr = e.counterparty
    if (!addr.isNullOrEmpty()) {
        return if (addr.length > 14) addr.take(6) + "…" + addr.takeLast(4) else addr
    }
    return null
}

private fun venueName(v: String): String = when (v.lowercase()) {
    "deepbook" -> "DeepBook"
    "navi" -> "NAVI"
    "bridge" -> "Bridge"
    else -> v.replaceFirstChar { it.uppercase() }
}

private fun titleOf(e: ActivityEntryDTO, category: RowCategory): String {
    if (category == RowCategory.CASHOUT) {
        if (e.offramp != null) return "Cash out to Nigeria"
        if (e.venue == "bridge") return "Cash out to United States"
        return "Cash out"
    }
    e.otherCoin?.let { other ->
        return if (e.direction == "received") "Received ${other.symbol}" else "Sent ${other.symbol}"
    }
    val hasRoundup = (e.roundupUsdsui ?: 0.0) > 0.0
    return when (category) {
        RowCategory.SENT -> {
            val who = counterpartyLabel(e)
            when {
                who != null && hasRoundup -> "Sent to $who + saved"
                who != null -> "Sent to $who"
                hasRoundup -> "Sent + saved"
                else -> "Sent"
            }
        }
        RowCategory.TEAM -> e.team?.name?.takeIf { it.isNotEmpty() }?.let { "Paid $it" } ?: "Paid your team"
        RowCategory.RECEIVED -> counterpartyLabel(e)?.let { "Received from $it" } ?: "Received"
        RowCategory.INVEST -> e.venue?.takeIf { it.isNotEmpty() }?.let { "Invested in ${venueName(it)}" } ?: "Invested"
        RowCategory.WITHDRAW -> e.venue?.takeIf { it.isNotEmpty() }?.let { "Withdrew from ${venueName(it)}" } ?: "Withdrew"
        RowCategory.AUTOSWAP -> when {
            e.direction == "swap" -> "Swapped"
            !e.venue.isNullOrEmpty() -> "Auto-swapped ${e.venue!!.uppercase()}"
            else -> "Auto-swapped to USDsui"
        }
        RowCategory.CASHOUT -> "Cash out"
        RowCategory.NEUTRAL -> "Activity"
    }
}

private fun subtitleOf(e: ActivityEntryDTO): String {
    e.offramp?.let { off ->
        val bank = off.bankName?.takeIf { it.isNotEmpty() } ?: "Bank"
        val last4 = off.accountLast4
        return if (!last4.isNullOrEmpty()) "$bank ••••$last4" else bank
    }
    val relative = relativeTime(e.timestampMs)
    e.team?.let { team ->
        val people = if (team.recipientCount == 1) "1 person" else "${team.recipientCount} people"
        return "$people · $relative"
    }
    val save = e.roundupUsdsui ?: 0.0
    if (save > 0) return "Saved ${formatUsd(save)} · $relative"
    return relative
}

private fun amountColorOf(e: ActivityEntryDTO, category: RowCategory): Color = when {
    category == RowCategory.CASHOUT -> SENT_RED
    category == RowCategory.AUTOSWAP -> TaliseColors.fg
    e.direction == "received" || e.direction == "withdraw" -> AMOUNT_GREEN
    else -> TaliseColors.fg
}

private fun amountOf(e: ActivityEntryDTO, category: RowCategory): String {
    e.offramp?.let { off -> return "-₦" + "%,.2f".format(off.amountNgn) }
    if (category == RowCategory.CASHOUT) {
        e.otherCoin?.let { other -> return "-${coinDisplay(other)} ${other.symbol}" }
    }
    if (category == RowCategory.AUTOSWAP) {
        val legs = mutableListOf<String>()
        (e.amountSui ?: 0.0).let { if (it > 0) legs.add("%.4f SUI".format(it)) }
        e.otherCoin?.let { legs.add("${coinDisplay(it)} ${it.symbol}") }
        (e.amountUsdsui ?: 0.0).let { if (it > 0) legs.add(formatUsd(it)) }
        return when (legs.size) {
            0 -> "→ -"
            1 -> "→ ${legs[0]}"
            else -> "${legs[0]} → ${legs[1]}"
        }
    }
    val inflow = e.direction == "received" || e.direction == "withdraw"
    val prefix = if (inflow) "+" else "-"
    e.otherCoin?.let { return "$prefix${coinDisplay(it)} ${it.symbol}" }
    e.amountUsdsui?.let { return prefix + formatUsd(abs(it)) }
    e.amountSui?.let { return prefix + "%.4f SUI".format(abs(it)) }
    return "$prefix-"
}

/** Raw u64 coin amount scaled by decimals, iOS `ActivityOtherCoin.displayAmount`. */
private fun coinDisplay(c: ActivityOtherCoin): String {
    val raw = c.amount.toDoubleOrNull() ?: 0.0
    val v = raw / 10.0.pow(c.decimals)
    return if (v < 1) "%.4f".format(v) else "%,.2f".format(v)
}

/** Balance hero, dollars in `fg`, cents dimmed to `fgMuted` (iOS `balanceHero`). */
private fun balanceHero(usdsui: Double, hidden: Boolean): AnnotatedString {
    if (hidden) return buildAnnotatedString {
        withStyle(SpanStyle(color = TaliseColors.fgMuted)) { append("••••••") }
    }
    val s = formatUsd(usdsui)
    val dot = s.lastIndexOf('.')
    return buildAnnotatedString {
        if (dot < 0) {
            withStyle(SpanStyle(color = TaliseColors.fg)) { append(s) }
        } else {
            withStyle(SpanStyle(color = TaliseColors.fg)) { append(s.substring(0, dot)) }
            withStyle(SpanStyle(color = TaliseColors.fgMuted)) { append(s.substring(dot)) }
        }
    }
}

private fun usdsuiSubline(usdsui: Double, hidden: Boolean): String {
    if (hidden) return "•••• USDsui"
    return if (usdsui < 0.01) "%.4f USDsui".format(usdsui) else "%.2f USDsui".format(usdsui)
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
