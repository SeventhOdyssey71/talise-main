package io.talise.app.feature.chat

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * A little history — recent chats in a compact sheet (not a full-screen
 * sidebar). Tap a row to reopen it; "New" starts fresh; per-row delete. The
 * Android port of iOS `ChatHistorySheet`.
 */
@Composable
fun ChatHistorySheet(
    conversations: List<ChatConversation>,
    onNew: () -> Unit,
    onOpen: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(conversations, query) {
        val q = query.trim()
        if (q.isEmpty()) conversations
        else conversations.filter { it.title.contains(q, ignoreCase = true) }
    }

    Column(Modifier.fillMaxWidth().background(TaliseColors.bg)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 20.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Chats", style = TaliseType.heading(20.sp, FontWeight.SemiBold), color = TaliseColors.fg)
            Spacer(Modifier.weight(1f))
            Row(
                Modifier
                    .clip(RoundedCornerShape(18.dp))
                    .background(TaliseColors.greenMint)
                    .clickable { onNew() }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Icons.Filled.Edit, contentDescription = null, tint = TaliseColors.bg, modifier = Modifier.size(14.dp))
                Text("New", style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.bg)
            }
        }

        // Search — filter past chats by title.
        if (conversations.isNotEmpty()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 10.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(TaliseColors.surface)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Filled.Search, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(15.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) {
                        Text("Search chats", style = TaliseType.body(14.sp), color = TaliseColors.fgDim)
                    }
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = TaliseType.body(14.sp).copy(color = TaliseColors.fg),
                        cursorBrush = SolidColor(TaliseColors.accent),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (query.isNotEmpty()) {
                    Icon(
                        Icons.Filled.Cancel,
                        contentDescription = "Clear search",
                        tint = TaliseColors.fgDim,
                        modifier = Modifier.size(16.dp).clickable { query = "" },
                    )
                }
            }
        }

        if (conversations.isEmpty()) {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 64.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Outlined.Schedule, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(28.dp))
                Text("No past chats yet.", style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            }
        } else {
            LazyColumn(
                Modifier.fillMaxWidth().weight(1f, fill = false),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(filtered, key = { it.id }) { c ->
                    HistoryRow(c, onOpen = { onOpen(c.id) }, onDelete = { onDelete(c.id) })
                }
                if (filtered.isEmpty()) {
                    item {
                        Text(
                            "No chats match that search.",
                            style = TaliseType.body(13.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                        )
                    }
                }
                item {
                    // Trust note: deleting a chat clears the local transcript only.
                    // The durable memory lives on Walrus (append-only) and stays.
                    Text(
                        "Deleting a chat only clears it from here. What Talise has learned stays saved on Walrus.",
                        style = TaliseType.mono(10.sp, FontWeight.Light),
                        color = TaliseColors.fgDim,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 28.dp)
                            .padding(top = 10.dp, bottom = 16.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(c: ChatConversation, onOpen: () -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(TaliseColors.surface)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(
            Modifier.weight(1f).clickable { onOpen() },
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                c.title.ifEmpty { "New chat" },
                style = TaliseType.body(15.sp),
                color = TaliseColors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(relativeTime(c.updatedAtMs), style = TaliseType.mono(10.sp, FontWeight.Light), color = TaliseColors.fgDim)
        }
        Box(
            Modifier.size(30.dp).clickable { onDelete() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Delete, contentDescription = "Delete chat", tint = TaliseColors.fgDim, modifier = Modifier.size(15.dp))
        }
    }
}

private fun relativeTime(ms: Long): String =
    DateUtils.getRelativeTimeSpanString(ms, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()
