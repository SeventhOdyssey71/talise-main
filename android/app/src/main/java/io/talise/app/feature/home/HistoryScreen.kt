package io.talise.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Full activity history — opened from Home's "View all". Shows every entry from
 * `/api/activity?limit=50` with five filter chips (All / Sent / Received / Earn /
 * Swap). Same flat row treatment as Home, just unlimited and filterable.
 * 1:1 port of iOS `HistoryView`.
 */
private enum class HistoryFilter(val label: String) {
    ALL("All"), SENT("Sent"), RECEIVED("Received"), EARN("Earn"), SWAP("Swap");

    fun matches(e: ActivityEntryDTO): Boolean = when (this) {
        ALL -> true
        SENT -> e.direction == "sent"
        RECEIVED -> e.direction == "received"
        // Chips collapse related pairs so Home users don't hit five overlapping
        // categories: invest/withdraw → Earn; swap/autoswap → Swap.
        EARN -> e.direction == "invest" || e.direction == "withdraw"
        SWAP -> e.direction == "swap" || e.direction == "autoswap"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HistoryScreen(initialEntries: List<ActivityEntryDTO>, amountsHidden: Boolean) {
    // Seeded with Home's already-loaded rows so "View all" opens instantly with
    // the last-good (immutable) history and never flashes empty.
    var entries by remember { mutableStateOf(initialEntries) }
    var filter by remember { mutableStateOf(HistoryFilter.ALL) }
    var receiptEntry by remember { mutableStateOf<ActivityEntryDTO?>(null) }

    LaunchedEffect(Unit) {
        runCatching { homeApi.activity(limit = 50).entries }
            .onSuccess { fresh ->
                // On-chain history is immutable — only replace on a real result.
                if (fresh.isNotEmpty() || entries.isEmpty()) entries = fresh
            }
    }

    val filtered = entries.filter { filter.matches(it) }

    LazyColumn(
        modifier = Modifier.fillMaxWidth().background(TaliseColors.bg),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // ── Header ────────────────────────────────────────────────────────
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                MicroLabel(text = "History", color = TaliseColors.fgDim)
                Text(
                    "All activity",
                    style = TaliseType.heading(26.sp, FontWeight.Medium),
                    letterSpacing = (-0.8).sp,
                    color = TaliseColors.fg,
                )
            }
        }

        // ── Filter chips ──────────────────────────────────────────────────
        item {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                HistoryFilter.entries.forEach { f ->
                    val selected = f == filter
                    Text(
                        f.label,
                        style = TaliseType.heading(12.sp, FontWeight.Medium),
                        color = if (selected) TaliseColors.bg else TaliseColors.fg,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (selected) TaliseColors.fg else TaliseColors.surface2)
                            .clickable { filter = f }
                            .padding(horizontal = 16.dp, vertical = 9.dp),
                    )
                }
            }
        }

        // ── Rows ──────────────────────────────────────────────────────────
        if (filtered.isEmpty()) {
            item {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        Icons.Outlined.Inbox,
                        contentDescription = null,
                        tint = TaliseColors.fgDim,
                        modifier = Modifier.padding(top = 28.dp).size(28.dp),
                    )
                    Text(
                        if (filter == HistoryFilter.ALL) "No activity yet"
                        else "No ${filter.label.lowercase()} activity yet",
                        style = TaliseType.body(14.sp, FontWeight.Light),
                        color = TaliseColors.fg,
                    )
                }
            }
        } else {
            item {
                // One flat solid plate holding every row, split by inset hairlines.
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(TaliseColors.surface),
                ) {
                    filtered.forEachIndexed { i, entry ->
                        HistoryRow(entry = entry, amountsHidden = amountsHidden, onTap = { receiptEntry = entry })
                        if (i < filtered.size - 1) {
                            Box(
                                Modifier.fillMaxWidth().padding(start = 64.dp).height(0.75.dp)
                                    .background(TaliseColors.line),
                            )
                        }
                    }
                }
            }
        }

        item { Spacer(Modifier.height(40.dp)) }
    }

    // Own receipt sheet, mirroring iOS HistoryView's `.sheet(item: receiptEntry)`.
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
}
