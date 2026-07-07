package io.talise.app.feature.requests

import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.util.Locale

/**
 * Requests, "ask anyone for $X". A faithful Android port of iOS
 * `RequestsListView` + `RequestCreateView`.
 *
 * The list shows the payment links you've minted (status, share, swipe or
 * long-press to cancel); "New request" opens the create flow (amount +
 * optional note), which mints a shareable link (talise.io/req/<id>) and flips
 * to a share view with a QR, the link, and Copy / Share actions.
 *
 * Wired to the real backend, GET/POST/DELETE `/api/requests` (same wire as
 * iOS/web) via [RequestsApi].
 */
@Composable
fun RequestsScreen(onClose: () -> Unit) {
    val listVm: RequestsViewModel = viewModel()
    val createVm: RequestCreateViewModel = viewModel()
    var showCreate by rememberSaveable { mutableStateOf(false) }

    // System back pops the create flow back to the list, like the iOS
    // NavigationStack pop.
    BackHandler(enabled = showCreate) { showCreate = false }

    // Reload on every return to the list, mirroring iOS `.task` re-running on
    // each appearance (initial load + after create).
    LaunchedEffect(showCreate) {
        if (!showCreate) listVm.load()
    }

    if (showCreate) {
        RequestCreate(vm = createVm, onDone = { showCreate = false })
    } else {
        RequestsList(
            vm = listVm,
            onNew = {
                createVm.reset()
                showCreate = true
            },
        )
    }
}

// MARK: - List

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RequestsList(vm: RequestsViewModel, onNew: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()

    PullToRefreshBox(
        isRefreshing = state.refreshing,
        onRefresh = vm::refresh,
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            RequestsHeader(
                eyebrow = "REQUESTS",
                title = "Request money",
                subtitle = "Mint a link to ask anyone for a set amount, share it, and they pay you straight to your wallet.",
            )

            NewRequestButton(onClick = onNew)

            when {
                state.loading && !state.loaded -> LoadingState()
                state.error != null -> ErrorState(state.error!!, onRetry = vm::load)
                state.requests.isEmpty() -> EmptyState()
                else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    state.requests.forEach { req ->
                        key(req.id) {
                            RequestRow(
                                req = req,
                                busy = state.busyId == req.id,
                                onCancel = { vm.cancel(req) },
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun RequestsHeader(eyebrow: String, title: String, subtitle: String) {
    Column(
        modifier = Modifier.padding(top = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(eyebrow, style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
        Text(title, style = TaliseType.heading(26.sp, FontWeight.Medium), letterSpacing = (-0.6).sp, color = TaliseColors.fg)
        Text(subtitle, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
    }
}

@Composable
private fun NewRequestButton(onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(CircleShape)
            .background(TaliseColors.greenMint)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.Add, contentDescription = null, tint = Color.Black, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(10.dp))
        Text("New request", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = Color.Black)
    }
}

// MARK: - Request row

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RequestRow(req: RequestDTO, busy: Boolean, onCancel: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var menuOpen by remember { mutableStateOf(false) }
    val tint = statusTint(req.status)

    // Swipe left to cancel an open request, the Android take on the iOS
    // trailing swipe action. The row snaps back and shows the busy state
    // while the cancel runs.
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart && req.isOpen && !busy) onCancel()
            false
        },
    )

    Box {
        SwipeToDismissBox(
            state = dismissState,
            enableDismissFromStartToEnd = false,
            enableDismissFromEndToStart = req.isOpen,
            modifier = Modifier.clip(RoundedCornerShape(20.dp)),
            backgroundContent = {
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(TaliseColors.sentRed.copy(alpha = 0.85f))
                        .padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.End,
                ) {
                    Icon(Icons.Outlined.Cancel, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Cancel", style = TaliseType.body(14.sp, FontWeight.Medium), color = Color.White)
                }
            },
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .alpha(if (busy) 0.5f else 1f)
                    .rampCard()
                    .combinedClickable(onClick = {}, onLongClick = { menuOpen = true })
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(tint.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(statusIcon(req.status), contentDescription = null, tint = tint, modifier = Modifier.size(17.dp))
                }

                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(formatUsd2(req.amountUsd), style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.fg)
                    val note = req.requesterNote
                    if (!note.isNullOrEmpty()) {
                        Text(note, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    } else {
                        Text(
                            req.payUrl.replace("https://www.", ""),
                            style = TaliseType.mono(11.sp),
                            color = TaliseColors.fgDim,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(req.status.uppercase(), style = TaliseType.mono(10.sp), letterSpacing = 0.8.sp, color = tint)
                    if (req.isOpen) {
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(TaliseColors.surface2)
                                .clickable { shareText(context, req.payUrl) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Filled.IosShare, contentDescription = "Share", tint = TaliseColors.fg, modifier = Modifier.size(13.dp))
                        }
                    }
                }

                if (busy) {
                    CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                }
            }
        }

        // Long-press menu, the Android take on the iOS context menu.
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text("Copy link", style = TaliseType.body(14.sp)) },
                leadingIcon = { Icon(Icons.Filled.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp)) },
                onClick = {
                    clipboard.setText(AnnotatedString(req.payUrl))
                    menuOpen = false
                },
            )
            if (req.isOpen) {
                DropdownMenuItem(
                    text = { Text("Cancel request", style = TaliseType.body(14.sp), color = TaliseColors.sentRed) },
                    leadingIcon = { Icon(Icons.Outlined.Cancel, contentDescription = null, tint = TaliseColors.sentRed, modifier = Modifier.size(16.dp)) },
                    onClick = {
                        menuOpen = false
                        onCancel()
                    },
                )
            }
        }
    }
}

private fun statusTint(status: String): Color = when (status) {
    "paid" -> TaliseColors.greenMint
    "open" -> TaliseColors.accent
    else -> TaliseColors.fgDim // cancelled / expired
}

private fun statusIcon(status: String): ImageVector = when (status) {
    "paid" -> Icons.Filled.Verified
    "open" -> Icons.Filled.Link
    "cancelled" -> Icons.Outlined.Cancel
    else -> Icons.Filled.Schedule // expired
}

// MARK: - List states

@Composable
private fun LoadingState() {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            repeat(3) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(78.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(TaliseColors.surface),
                )
            }
        }
        CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun ErrorState(msg: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 50.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            msg,
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
        )
        Row(
            modifier = Modifier
                .height(46.dp)
                .clip(CircleShape)
                .background(TaliseColors.greenMint)
                .clickable(onClick = onRetry)
                .padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Try again", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = Color.Black)
        }
    }
}

@Composable
private fun EmptyState() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Filled.QrCode2, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(38.dp))
        Text("No requests yet", style = TaliseType.heading(18.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            "Create one to ask someone for a set amount.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

// MARK: - Create

@Composable
private fun RequestCreate(vm: RequestCreateViewModel, onDone: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()

    val created = state.created
    if (created != null) {
        ShareView(res = created, copied = state.copied, onCopied = vm::markCopied, onDone = onDone)
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        RequestsHeader(
            eyebrow = "REQUEST",
            title = "Request money",
            subtitle = "Ask anyone for a set amount. Share a link or QR, they pay you straight to your wallet.",
        )

        AmountCard(amount = state.amount, onAmountChange = vm::setAmount)
        NoteCard(note = state.note, onNoteChange = vm::setNote)

        state.error?.let {
            Text(it, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
        }

        CreateButton(enabled = state.canCreate, creating = state.creating, onClick = vm::create)

        Text(
            "You'll get a link anyone can open to pay you, no app required.",
            style = TaliseType.mono(11.sp),
            color = TaliseColors.fgMuted,
        )

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun AmountCard(amount: String, onAmountChange: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .rampCard()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("AMOUNT", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(TaliseColors.surface2)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("$", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (amount.isEmpty()) {
                    Text("20.00", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                }
                BasicTextField(
                    value = amount,
                    onValueChange = onAmountChange,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TaliseType.heading(22.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun NoteCard(note: String, onNoteChange: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .rampCard()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("NOTE (OPTIONAL)", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(TaliseColors.surface2)
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            if (note.isEmpty()) {
                Text("e.g. Dinner last night", style = TaliseType.body(15.sp, FontWeight.Normal), color = TaliseColors.fgDim)
            }
            BasicTextField(
                value = note,
                onValueChange = onNoteChange,
                maxLines = 4,
                textStyle = TaliseType.body(15.sp, FontWeight.Normal).copy(color = TaliseColors.fg),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun CreateButton(enabled: Boolean, creating: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(CircleShape)
            .background(if (enabled) TaliseColors.greenMint else TaliseColors.surface2)
            .alpha(if (enabled) 1f else 0.6f)
            .clickable(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (creating) {
            CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(
            if (creating) "Creating…" else "Create request",
            style = TaliseType.body(16.sp, FontWeight.SemiBold),
            color = Color.Black,
        )
    }
}

// MARK: - Share

@Composable
private fun ShareView(
    res: RequestCreateResponse,
    copied: Boolean,
    onCopied: () -> Unit,
    onDone: () -> Unit,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(top = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Requesting", style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
            Text(formatUsd2(res.request.amountUsd), style = TaliseType.heading(40.sp, FontWeight.Medium), letterSpacing = (-1).sp, color = TaliseColors.fg)
            val note = res.request.requesterNote
            if (!note.isNullOrEmpty()) {
                Text(note, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fgMuted, textAlign = TextAlign.Center)
            }
        }

        // QR card, the payable link, encoded.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(TaliseColors.surface)
                .padding(vertical = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(256.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color.White)
                    .padding(18.dp),
                contentAlignment = Alignment.Center,
            ) {
                QrView(content = res.payUrl, modifier = Modifier.size(220.dp))
            }
            Text(
                prettyLink(res.payUrl),
                style = TaliseType.mono(12.5.sp, FontWeight.Light),
                color = TaliseColors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ShareActionButton(
                icon = if (copied) Icons.Filled.Check else Icons.Filled.ContentCopy,
                label = if (copied) "Copied" else "Copy link",
                primary = false,
                modifier = Modifier.weight(1f),
            ) {
                clipboard.setText(AnnotatedString(res.payUrl))
                onCopied()
            }
            ShareActionButton(
                icon = Icons.Filled.IosShare,
                label = "Share",
                primary = true,
                modifier = Modifier.weight(1f),
            ) {
                shareText(context, res.payUrl)
            }
        }

        Text(
            "Done",
            style = TaliseType.body(14.sp),
            color = TaliseColors.fgMuted,
            modifier = Modifier
                .padding(top = 4.dp)
                .clickable(onClick = onDone),
        )

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ShareActionButton(
    icon: ImageVector,
    label: String,
    primary: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val fg = if (primary) TaliseColors.bg else TaliseColors.fg
    Row(
        modifier = modifier
            .height(48.dp)
            .clip(CircleShape)
            .background(if (primary) TaliseColors.fg else TaliseColors.surface2)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, style = TaliseType.heading(14.sp, FontWeight.Medium), color = fg)
    }
}

// MARK: - Helpers

/** Two-decimal USD string, mirroring iOS `TaliseFormat.usd2` (en_US currency). */
private fun formatUsd2(v: Double): String = "$" + String.format(Locale.US, "%,.2f", v)

/** Drop the scheme for a tidy on-card label ("talise.io/req/…"). */
private fun prettyLink(url: String): String = url
    .replace("https://", "")
    .replace("http://", "")
    .replace("www.", "")

private fun shareText(context: Context, text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, null))
}
