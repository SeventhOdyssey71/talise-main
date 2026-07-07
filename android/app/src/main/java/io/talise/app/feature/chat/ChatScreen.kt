package io.talise.app.feature.chat

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.core.session.AppSession
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Talise Copilot — the AI finance chat, an exact Compose port of iOS
 * `ChatTabView.swift`.
 *
 * Layout (top → bottom):
 *   1. Greeting header (time-of-day aware, first-name from the session).
 *      Subtitle: "Let's make sense of your numbers."
 *   2. Scrollable transcript. User bubbles right-aligned in mint, assistant
 *      bubbles left-aligned in surface gray. Auto-scrolls to the newest
 *      message as SSE deltas arrive. Agent intent cards render beneath the
 *      assistant bubble once a stream closes.
 *   3. Suggestion grid (only on an empty transcript — it gets out of the way
 *      after the first turn).
 *   4. "Ask anything" input pill — submit on send.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(onClose: () -> Unit, vm: ChatViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val phase by AppSession.phase.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current
    val focusRequester = remember { FocusRequester() }
    var historyOpen by remember { mutableStateOf(false) }

    // Keep the newest message in view as the reply streams in.
    LaunchedEffect(state.messages.lastOrNull()?.id, state.messages.lastOrNull()?.content) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .statusBarsPadding()
            .imePadding(),
    ) {
        Header(
            greeting = greeting(phase),
            onHistory = { historyOpen = true },
            onClose = onClose,
            modifier = Modifier.padding(horizontal = 24.dp).padding(top = 20.dp),
        )

        // Transcript
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .pointerInput(Unit) { detectTapGestures { focusManager.clearFocus() } },
            contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.messages.isEmpty()) {
                item {
                    EmptyState(
                        onSuggestion = { prompt ->
                            vm.fillPrompt(prompt)
                            focusRequester.requestFocus()
                        },
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
            } else {
                items(state.messages, key = { it.id }) { msg ->
                    MessageRow(
                        msg = msg,
                        onRegenerate = { vm.regenerate(msg.id) },
                        onExecuted = { results -> vm.recordExecution(msg.id, results) },
                    )
                }
            }
        }

        InputPill(
            value = state.input,
            onValue = { vm.setInput(it) },
            onSend = { vm.send() },
            streaming = state.streaming,
            focusRequester = focusRequester,
            modifier = Modifier
                .padding(horizontal = 24.dp)
                .padding(bottom = 28.dp)
                .navigationBarsPadding(),
        )
    }

    if (historyOpen) {
        ModalBottomSheet(
            onDismissRequest = { historyOpen = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
            containerColor = TaliseColors.bg,
        ) {
            ChatHistorySheet(
                conversations = state.conversations,
                onNew = { vm.newChat(); historyOpen = false },
                onOpen = { id -> vm.open(id); historyOpen = false },
                onDelete = { id -> vm.deleteConversation(id) },
            )
        }
    }
}

// ── Header ────────────────────────────────────────────────────────────────

@Composable
private fun Header(
    greeting: String,
    onHistory: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AgentMascot(size = 34.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                greeting,
                style = TaliseType.heading(19.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "Let's make sense of your numbers.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        // A little history (recent chats) + close.
        CircleButton(Icons.Outlined.Schedule, label = "History", onClick = onHistory)
        CircleButton(Icons.Filled.Close, label = "Close", onClick = onClose)
    }
}

@Composable
private fun CircleButton(icon: ImageVector, label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(TaliseColors.surfaceGlass)
            .border(0.5.dp, Color.White.copy(alpha = 0.12f), CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = TaliseColors.fgMuted, modifier = Modifier.size(16.dp))
    }
}

private fun greeting(phase: AppSession.Phase): String {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val slot = when (hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        in 17..21 -> "Good evening"
        else -> "Hey"
    }
    val raw = when (phase) {
        is AppSession.Phase.Ready -> phase.user.name
        is AppSession.Phase.Onboarding -> phase.user.name
        else -> null
    }?.trim()
    val name = raw?.takeIf { it.isNotEmpty() }?.split(" ")?.firstOrNull() ?: "there"
    return "$slot, $name"
}

// ── Empty state + suggestions ─────────────────────────────────────────────

/** A starter suggestion: a clean green icon, a title + subtitle, and the prompt it drops into the composer. */
private data class Suggestion(
    val icon: ImageVector,
    val title: String,
    val subtitle: String,
    val prompt: String,
)

private val gridSuggestions = listOf(
    Suggestion(Icons.Filled.CreditCard, "Balance", "See your total", "What's my balance?"),
    Suggestion(Icons.Filled.History, "Recent activity", "Your latest moves", "Show my recent activity"),
    Suggestion(Icons.Filled.Payments, "Save money", "Into your savings", "I'd like to save some money"),
    Suggestion(Icons.Filled.AccountBalance, "Cash out", "To your bank", "Cash out to my bank account"),
)

@Composable
private fun EmptyState(onSuggestion: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Hero: just the mascot, no glow.
        AgentMascot(size = 62.dp, animated = true)
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(
                "Your money, made simple.",
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                textAlign = TextAlign.Center,
            )
            Text(
                "Ask me anything about your money and I'll help you make sense of it.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 290.dp),
            )
        }
        // A clean, well-spaced 2x2 suggestion grid (4 starters).
        Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            gridSuggestions.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    pair.forEach { s ->
                        SuggestionCard(s, onClick = { onSuggestion(s.prompt) }, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun SuggestionCard(s: Suggestion, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier
            .defaultMinSize(minHeight = 104.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(TaliseColors.surface2)
            .border(0.5.dp, Color.White.copy(alpha = 0.06f), RoundedCornerShape(16.dp))
            .clickable { onClick() }
            .padding(14.dp),
    ) {
        // Clean green icon tile (unified, no multicolor).
        Box(
            Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(TaliseColors.greenMint.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(s.icon, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text(s.title, style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            s.subtitle,
            style = TaliseType.body(11.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// ── Transcript rows ───────────────────────────────────────────────────────

/**
 * One transcript row: the prose bubble (when there's text or it's still
 * streaming) plus, once the stream closes, the Talise Agent action card for
 * any parsed intent. A pure-intent turn shows just the card.
 */
@Composable
private fun MessageRow(
    msg: ChatMessage,
    onRegenerate: () -> Unit,
    onExecuted: (List<AgentActionResult>) -> Unit,
) {
    if (msg.role == ChatMessage.Role.User) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            Box(
                Modifier
                    .padding(start = 48.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(TaliseColors.greenMint)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text(msg.content, style = TaliseType.body(15.sp, FontWeight.Medium), color = TaliseColors.bg)
            }
            Spacer(Modifier.height(3.dp))
            MessageMeta(dateMs = msg.dateMs, sent = true)
        }
    } else {
        // Assistant turn: a small mascot avatar beside a dark chat bubble.
        Row(Modifier.fillMaxWidth()) {
            AgentMascot(size = 30.dp)
            Spacer(Modifier.width(8.dp))
            Column(
                Modifier.weight(1f).padding(end = 20.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (msg.streaming && msg.content.isEmpty()) {
                    TypingDots()
                } else if (msg.content.isNotEmpty() || msg.streaming) {
                    AssistantBubble(msg)
                    if (!msg.streaming) MessageMeta(dateMs = msg.dateMs, sent = false)
                }
                val intent = msg.intent
                if (intent != null && !msg.streaming) {
                    AgentIntentCard(
                        intent = intent,
                        executed = msg.executed,
                        onExecuted = onExecuted,
                    )
                }
                if (!msg.streaming && msg.content.isNotEmpty()) {
                    val clipboard = LocalClipboardManager.current
                    Row {
                        RowAction(Icons.Outlined.ContentCopy, "Copy") { clipboard.setText(AnnotatedString(msg.content)) }
                        RowAction(Icons.Outlined.Refresh, "Regenerate", onClick = onRegenerate)
                    }
                }
            }
        }
    }
}

/** Small timestamp (+ a read-receipt double-check on sent user turns). */
@Composable
private fun MessageMeta(dateMs: Long?, sent: Boolean) {
    Row(
        Modifier.padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (dateMs != null) {
            Text(timeString(dateMs), style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
        }
        if (sent) DoubleCheck()
    }
}

/** The WhatsApp-style read-receipt double check on sent turns. */
@Composable
private fun DoubleCheck() {
    Row {
        Icon(
            Icons.Filled.Check, contentDescription = null,
            tint = TaliseColors.greenMint, modifier = Modifier.size(10.dp),
        )
        Icon(
            Icons.Filled.Check, contentDescription = null,
            tint = TaliseColors.greenMint, modifier = Modifier.size(10.dp).offset(x = (-5).dp),
        )
    }
}

private fun timeString(ms: Long): String = SimpleDateFormat("h:mm a", Locale.US).format(Date(ms))

@Composable
private fun RowAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(width = 30.dp, height = 26.dp)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = TaliseColors.fgDim, modifier = Modifier.size(14.dp))
    }
}

/**
 * Assistant turns render in a dark chat bubble (inline markdown rendered so
 * **bold** shows cleanly, not literal asterisks).
 */
@Composable
private fun AssistantBubble(msg: ChatMessage) {
    Box(
        Modifier
            .clip(RoundedCornerShape(18.dp))
            .background(TaliseColors.surface2)
            .border(0.5.dp, Color.White.copy(alpha = 0.06f), RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 11.dp),
    ) {
        Text(
            markdown(msg.content + if (msg.streaming) " ▍" else ""),
            style = TaliseType.body(15.sp, FontWeight.Light).copy(lineHeight = 21.sp),
            color = TaliseColors.fg,
        )
    }
}

/**
 * Parse the assistant's inline markdown (bold + links) while keeping line
 * breaks. Also strips any em/en dashes the model still slips in (brand rule)
 * so they never reach the screen, regardless of the prompt.
 */
private fun markdown(s: String): AnnotatedString {
    val cleaned = s
        .replace(" — ", ", ")
        .replace(" – ", ", ")
        .replace("-", "-")
        .replace("–", "-")
        // Inline links: keep the label, drop the URL noise.
        .replace(Regex("\\[([^\\]]+)]\\(([^)]+)\\)"), "$1")
    return buildAnnotatedString {
        var i = 0
        var bold = false
        while (i < cleaned.length) {
            val next = cleaned.indexOf("**", i)
            if (next < 0) {
                appendStyled(cleaned.substring(i), bold)
                break
            }
            appendStyled(cleaned.substring(i, next), bold)
            bold = !bold
            i = next + 2
        }
    }
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.appendStyled(text: String, bold: Boolean) {
    if (text.isEmpty()) return
    if (bold) {
        pushStyle(SpanStyle(fontWeight = FontWeight.SemiBold))
        append(text)
        pop()
    } else {
        append(text)
    }
}

/** Three staggered pulsing dots — the assistant "thinking" indicator. */
@Composable
private fun TypingDots() {
    val transition = rememberInfiniteTransition(label = "typing")
    Row(
        Modifier.padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(3) { i ->
            val p by transition.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    tween(durationMillis = 600),
                    RepeatMode.Reverse,
                    initialStartOffset = StartOffset(i * 200),
                ),
                label = "typing-dot-$i",
            )
            Box(
                Modifier
                    .size(6.dp)
                    .scale(0.55f + 0.45f * p)
                    .alpha(0.4f + 0.6f * p)
                    .background(TaliseColors.fgMuted, CircleShape),
            )
        }
    }
}

// ── Input pill ────────────────────────────────────────────────────────────

/** Clean composer: a text field and a send button. No attachments, no mic. */
@Composable
private fun InputPill(
    value: String,
    onValue: (String) -> Unit,
    onSend: () -> Unit,
    streaming: Boolean,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val canSend = !streaming && value.trim().isNotEmpty()
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(50))
            .background(TaliseColors.surface2)
            .border(0.5.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(50))
            .padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
            if (value.isEmpty()) {
                Text("Ask anything", style = TaliseType.body(16.sp), color = TaliseColors.fgDim)
            }
            BasicTextField(
                value = value,
                onValueChange = onValue,
                enabled = !streaming,
                maxLines = 5,
                textStyle = TaliseType.body(16.sp).copy(color = TaliseColors.fg),
                cursorBrush = SolidColor(TaliseColors.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
            )
        }
        Box(
            Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(if (canSend) TaliseColors.accent else TaliseColors.fgDim)
                .clickable(enabled = canSend) { onSend() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (streaming) Icons.Filled.MoreHoriz else Icons.Filled.ArrowUpward,
                contentDescription = "Send",
                tint = Color.Black,
                modifier = Modifier.size(17.dp),
            )
        }
    }
}
