package io.talise.app.feature.rules

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Update
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Rules / Automations hub — a 1:1 port of iOS `RulesView`. A rule is money
 * that runs itself: a fixed amount sent to a recipient on a schedule from the
 * rule's OWN non-custodial on-chain pot. Opening this screen triggers any DUE
 * rules (permissionless `execute_due`; no cron). List shows active + paused
 * rules; each can be paused/resumed (trailing button) or cancelled with a
 * long-press menu (a cancel signs an on-chain refund, then clears).
 *
 * When the feature is gated off server-side (`enabled == false`) we show a
 * clean "Automations are coming soon" state and hide the create button.
 *
 * Nav signature: `RulesScreen(onClose: () -> Unit)`.
 */
@Composable
fun RulesScreen(onClose: () -> Unit) {
    val vm: RulesViewModel = viewModel()
    var editing by remember { mutableStateOf(false) }

    // Load on entry and reload on every return from the editor (iOS reloads
    // on every appearance); fire due rules once per screen instance.
    LaunchedEffect(editing) {
        if (!editing) vm.load(fireDue = true)
    }

    if (editing) {
        RuleEditScreen(onBack = { editing = false })
    } else {
        RulesHub(vm = vm, onClose = onClose, onNew = { editing = true })
    }
}

@Composable
private fun RulesHub(vm: RulesViewModel, onClose: () -> Unit, onNew: () -> Unit) {
    val ui by vm.ui.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Close affordance (iOS shows nav-bar chrome from the parent stack).
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(TaliseColors.surface2).clickable { onClose() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fg, modifier = Modifier.size(15.dp))
            }
        }

        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp).padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // ── Header ──
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "AUTOMATIONS",
                    style = TaliseType.mono(10.sp),
                    letterSpacing = 1.4.sp,
                    color = TaliseColors.fgDim,
                )
                Text(
                    "Money that runs itself",
                    style = TaliseType.heading(26.sp, FontWeight.Medium),
                    letterSpacing = (-0.6).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "Set a rule once, pay a fixed amount to someone on a schedule. It runs automatically and gaslessly.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            if (ui.enabled) {
                // ── New rule ──
                Row(
                    Modifier.fillMaxWidth().height(54.dp)
                        .clip(CircleShape).background(TaliseColors.greenMint).clickable { onNew() },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(Icons.Filled.Add, contentDescription = null, tint = Color.Black, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("New rule", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = Color.Black)
                }
            }

            when {
                ui.loading && !ui.loaded -> LoadingState()
                ui.error != null -> ErrorState(ui.error!!) { vm.load() }
                !ui.enabled -> ComingSoonState()
                ui.rules.isEmpty() -> EmptyState()
                else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ui.rules.forEach { rule ->
                        RuleRow(
                            rule = rule,
                            busy = ui.busyId == rule.id,
                            onToggle = { vm.toggle(rule) },
                            onDelete = { vm.delete(rule) },
                        )
                    }
                }
            }

            Spacer(Modifier.height(28.dp))
        }
    }
}

// MARK: - Rule row

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RuleRow(
    rule: RuleDTO,
    busy: Boolean,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }

    Box {
        Row(
            Modifier.fillMaxWidth()
                .alpha(if (busy) 0.5f else 1f)
                .rampCard()
                .combinedClickable(onClick = {}, onLongClick = { menuOpen = true })
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier.size(46.dp).clip(RoundedCornerShape(14.dp))
                    .background(TaliseColors.greenMint.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (rule.isPaused) Icons.Filled.Pause else Icons.Filled.Autorenew,
                    contentDescription = null,
                    tint = if (rule.isPaused) TaliseColors.fgMuted else TaliseColors.greenMint,
                    modifier = Modifier.size(17.dp),
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    rule.name,
                    style = TaliseType.heading(16.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${usd2(rule.amountUsd)} to ${rule.recipientLabel}",
                    style = TaliseType.body(12.5.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    rule.cadenceLine + (if (rule.isPaused) " · Paused" else ""),
                    style = TaliseType.mono(10.5.sp),
                    color = TaliseColors.fgDim,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            if (busy) {
                CircularProgressIndicator(
                    color = TaliseColors.fgMuted, strokeWidth = 2.dp,
                    modifier = Modifier.size(20.dp),
                )
            } else {
                Box(
                    Modifier.size(36.dp).clip(CircleShape).background(TaliseColors.surface2)
                        .clickable { onToggle() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (rule.isPaused) Icons.Filled.PlayArrow else Icons.Filled.Pause,
                        contentDescription = if (rule.isPaused) "Resume" else "Pause",
                        tint = TaliseColors.fg,
                        modifier = Modifier.size(13.dp),
                    )
                }
            }
        }

        // Long-press menu — iOS contextMenu (Resume/Pause + Cancel & refund pot).
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text(if (rule.isPaused) "Resume" else "Pause") },
                leadingIcon = {
                    Icon(
                        if (rule.isPaused) Icons.Filled.PlayArrow else Icons.Filled.Pause,
                        contentDescription = null,
                    )
                },
                onClick = { menuOpen = false; onToggle() },
            )
            DropdownMenuItem(
                text = { Text("Cancel & refund pot", color = TaliseColors.danger) },
                leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null, tint = TaliseColors.danger) },
                onClick = { menuOpen = false; onDelete() },
            )
        }
    }
}

// MARK: - States

@Composable
private fun LoadingState() {
    Box(contentAlignment = Alignment.Center) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            repeat(3) {
                Box(
                    Modifier.fillMaxWidth().height(78.dp)
                        .clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface),
                )
            }
        }
        CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun ErrorState(msg: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(top = 50.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            msg,
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
        )
        Box(
            Modifier.height(46.dp).clip(CircleShape).background(TaliseColors.greenMint)
                .clickable { onRetry() }.padding(horizontal = 24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("Try again", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = Color.Black)
        }
    }
}

/** Feature-gated state — automations aren't live yet (no escrow key set). */
@Composable
private fun ComingSoonState() {
    Column(
        Modifier.fillMaxWidth().padding(top = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Filled.Update, contentDescription = null,
            tint = TaliseColors.fgDim, modifier = Modifier.size(38.dp),
        )
        Text(
            "Automations are coming soon",
            style = TaliseType.heading(18.sp, FontWeight.Medium),
            color = TaliseColors.fg,
            textAlign = TextAlign.Center,
        )
        Text(
            "Soon you'll be able to set money to send itself: pay rent on the 1st, top someone up weekly, all gaslessly.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
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
            Icons.Filled.Autorenew, contentDescription = null,
            tint = TaliseColors.fgDim, modifier = Modifier.size(38.dp),
        )
        Text(
            "No rules yet",
            style = TaliseType.heading(18.sp, FontWeight.Medium),
            color = TaliseColors.fg,
        )
        Text(
            "Create one to send money on a schedule, automatically.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}
