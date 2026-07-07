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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Hexagon
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import io.talise.app.core.session.AppSession
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** FLAT card, iOS `.flatCard`: solid `surface` fill + clip, NO border/blur/gradient. */
private fun Modifier.flatCard(radius: androidx.compose.ui.unit.Dp = 25.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this.clip(shape).background(TaliseColors.surface, shape)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(nav: NavController, vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val phase by AppSession.phase.collectAsStateWithLifecycle()
    val hidden by vm.amountsHidden.collectAsStateWithLifecycle()

    // Sheets, mirroring iOS `.sheet(item: receiptEntry)` + `.sheet(historySheetVisible)`.
    var receiptEntry by remember { mutableStateOf<ActivityEntryDTO?>(null) }
    var showHistory by remember { mutableStateOf(false) }

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
                            modifier = Modifier.size(11.dp).clickable { vm.toggleAmountsHidden() },
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

        // ── Recent activity header + top-4 rows ───────────────────────────
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
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                        modifier = Modifier.clickable { showHistory = true },
                    ) {
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
                            "No activity yet",
                            style = TaliseType.body(13.sp, FontWeight.Light),
                            color = TaliseColors.fgDim,
                        )
                    }
                } else {
                    // One flat solid card holding the rows, split by inset hairline
                    // dividers past the badge — the clean Apple-system list look.
                    Column(Modifier.fillMaxWidth().flatCard(radius = 20.dp)) {
                        rows.forEachIndexed { i, entry ->
                            HistoryRow(entry = entry, amountsHidden = hidden, onTap = { receiptEntry = entry })
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

    // ── Receipt sheet — tapping a row opens its on-chain receipt (iOS TxReceiptView). ──
    receiptEntry?.let { entry ->
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { receiptEntry = null },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
        ) {
            TxReceiptView(entry)
        }
    }

    // ── History sheet — "View all" opens the full filterable feed (iOS HistoryView). ──
    if (showHistory) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { showHistory = false },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
        ) {
            HistoryScreen(initialEntries = state.activity, amountsHidden = hidden)
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

// ── Balance hero formatting (iOS HomeView.balanceHero / suiusdFormatted) ─────

/** Balance hero, dollars in `fg`, cents dimmed to `fgMuted` (iOS `balanceHero`). */
private fun balanceHero(usdsui: Double, hidden: Boolean): AnnotatedString {
    if (hidden) return buildAnnotatedString {
        withStyle(SpanStyle(color = TaliseColors.fgMuted)) { append("••••••") }
    }
    val s = usd2(usdsui)
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
