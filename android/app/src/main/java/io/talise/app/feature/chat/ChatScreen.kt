package io.talise.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Talise Copilot, the money assistant, a full-screen chat mirroring the iOS
 * Chat tab: greeting + suggestion grid on an empty transcript, streamed replies,
 * and an "Ask anything" input pill. Talks to `POST /api/chat/stream`.
 */
@Composable
fun ChatScreen(onClose: () -> Unit, vm: ChatViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Keep the newest message in view as the reply streams in.
    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.text) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex)
    }

    fun submit() {
        val t = input
        input = ""
        vm.send(t)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .statusBarsPadding()
            .imePadding(),
    ) {
        // Header
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(36.dp).background(TaliseColors.surfaceGlass, CircleShape).clickable { onClose() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Close", tint = TaliseColors.fg, modifier = Modifier.size(18.dp)) }
            Mascot(size = 32.dp)
            Column {
                Text(timeGreeting(), style = TaliseType.heading(17.sp, FontWeight.SemiBold), color = TaliseColors.fg)
                Text("Let's make sense of your numbers.", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
            }
        }

        // Transcript / empty state
        if (state.messages.isEmpty()) {
            EmptyState(onSuggestion = { vm.send(it) }, modifier = Modifier.weight(1f))
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(state.messages, key = { it.id }) { msg -> Bubble(msg) }
            }
        }

        // Input pill
        InputPill(
            value = input,
            onValue = { input = it },
            onSend = { submit() },
            enabled = !state.sending,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp).navigationBarsPadding(),
        )
    }
}

@Composable
private fun Bubble(msg: ChatMessage) {
    val isUser = msg.role == ChatMessage.Role.User
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        if (!isUser) {
            Mascot(size = 26.dp)
            Spacer(Modifier.width(8.dp))
        }
        Box(
            Modifier
                .fillMaxWidth(0.82f)
                .background(
                    if (isUser) TaliseColors.greenDeep else TaliseColors.surfaceGlass,
                    RoundedCornerShape(
                        topStart = 18.dp,
                        topEnd = 18.dp,
                        bottomEnd = if (isUser) 6.dp else 18.dp,
                        bottomStart = if (isUser) 18.dp else 6.dp,
                    ),
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            val shown = if (msg.streaming && msg.text.isBlank()) "…" else msg.text
            Text(
                shown,
                style = TaliseType.body(15.sp, FontWeight.Normal),
                color = if (isUser) TaliseColors.labelOnDeep else TaliseColors.fg,
            )
        }
    }
}

@Composable
private fun EmptyState(onSuggestion: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 22.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Mascot(size = 60.dp)
        Spacer(Modifier.height(16.dp))
        Text(
            "Ask me anything about your money and I'll help you make sense of it.",
            style = TaliseType.body(15.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        Spacer(Modifier.height(24.dp))
        // 2x2 starter grid, the same four the iOS Copilot offers (title, subtitle, prompt).
        val starters = listOf(
            Triple("Balance", "See your total", "What's my balance?"),
            Triple("Recent activity", "Your latest moves", "Show my recent activity"),
            Triple("Save money", "Into your savings", "I'd like to save some money"),
            Triple("Cash out", "To your bank", "Cash out to my bank account"),
        )
        starters.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { (title, subtitle, prompt) ->
                    SuggestionCard(title, subtitle, onClick = { onSuggestion(prompt) }, modifier = Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun SuggestionCard(title: String, subtitle: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier
            .background(TaliseColors.surfaceGlass, RoundedCornerShape(18.dp))
            .border(1.dp, TaliseColors.line, RoundedCornerShape(18.dp))
            .clickable { onClick() }
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(title, style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(subtitle, style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
    }
}

@Composable
private fun InputPill(
    value: String,
    onValue: (String) -> Unit,
    onSend: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val canSend = value.isNotBlank() && enabled
    Row(
        modifier
            .fillMaxWidth()
            .background(TaliseColors.surfaceGlass, RoundedCornerShape(28.dp))
            .border(1.dp, TaliseColors.line, RoundedCornerShape(28.dp))
            .padding(start = 8.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextField(
            value = value,
            onValueChange = onValue,
            modifier = Modifier.weight(1f),
            enabled = enabled,
            placeholder = { Text("Ask anything", color = TaliseColors.fgDim, style = TaliseType.body(15.sp)) },
            textStyle = LocalTextStyle.current.merge(TaliseType.body(15.sp)).copy(color = TaliseColors.fg),
            singleLine = false,
            maxLines = 5,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { onSend() }),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                disabledContainerColor = Color.Transparent,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                disabledIndicatorColor = Color.Transparent,
                cursorColor = TaliseColors.accent,
            ),
        )
        Box(
            Modifier
                .size(38.dp)
                .background(if (canSend) TaliseColors.accent else TaliseColors.fgDim, CircleShape)
                .clickable(enabled = canSend) { onSend() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.ArrowUpward, contentDescription = "Send", tint = TaliseColors.inkOnGreen, modifier = Modifier.size(18.dp))
        }
    }
}

/** The Copilot mark, the real Talise app mark (iOS AgentMascot). */
@Composable
private fun Mascot(size: androidx.compose.ui.unit.Dp) {
    androidx.compose.foundation.Image(
        painter = androidx.compose.ui.res.painterResource(io.talise.app.R.drawable.applogo),
        contentDescription = "Talise Copilot",
        modifier = Modifier.size(size),
    )
}

/** Time-of-day greeting, matching iOS ChatTabView.greeting. */
private fun timeGreeting(): String {
    val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    return when (hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        in 17..21 -> "Good evening"
        else -> "Hey"
    }
}
