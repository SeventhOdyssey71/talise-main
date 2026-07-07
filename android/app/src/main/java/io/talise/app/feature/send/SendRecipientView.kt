package io.talise.app.feature.send

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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Off-ramp Phase 3 pay-mode: on-chain (default) vs the recipient's bank. */
private enum class PayMode { Onchain, Bank }

private val addressRe = Regex("^0x[a-fA-F0-9]{64}$")

/**
 * Step 2: pick a recipient — iOS `SendRecipientView`. Text input at the top
 * + recent contacts from /api/contacts. Tapping a contact auto-resolves and
 * advances; the "Next" button is the keyboard-only path for hand-typed
 * addresses. When the resolved recipient has a PRIMARY linked bank, a
 * segmented control offers paying their bank in NGN instead of on-chain.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SendRecipientView(
    draft: SendDraft,
    onNext: () -> Unit,
    onBack: () -> Unit,
    /** Closes the entire Send flow (used by the bank payout path). */
    onClose: () -> Unit,
    /** Bank payout is suppressed in flows where it would contradict privacy. */
    allowBankPayout: Boolean = true,
) {
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val focusManager = LocalFocusManager.current
    val focusRequester = remember { FocusRequester() }

    var contacts by remember { mutableStateOf<List<SendContactDTO>>(emptyList()) }
    var loadingContacts by remember { mutableStateOf(true) }
    var resolving by remember { mutableStateOf(false) }
    var resolveJob by remember { mutableStateOf<Job?>(null) }
    var pendingPickToken by remember { mutableStateOf<Long?>(null) }
    var pickCounter by remember { mutableLongStateOf(0L) }
    var suppressNextResolve by remember { mutableStateOf(false) }
    var payMode by remember { mutableStateOf(PayMode.Onchain) }
    var showBankSheet by remember { mutableStateOf(false) }

    val recipientHasBank = allowBankPayout && draft.resolved?.recipientBank?.hasPrimary == true
    val canAdvance = draft.resolved != null

    /** Debounced server resolve — mirrors iOS `scheduleResolve`. */
    fun scheduleResolve(input: String) {
        resolveJob?.cancel()
        draft.resolved = null
        val q = input.trim()
        if (q.length < 3) {
            resolving = false
            return
        }
        if (addressRe.matches(q)) {
            draft.resolved = SendResolvedRecipient(
                address = q,
                displayName = shortAddress(q),
                source = "address",
            )
            resolving = false
            // Enrich with the recipient's payout bank so the "Their bank"
            // rail appears for a pasted address too.
            resolveJob = scope.launch {
                val enriched = runCatching { SendApiClient.api.resolve(q) }.getOrNull()
                if (!isActive) return@launch
                if (enriched?.recipientBank?.hasPrimary == true && draft.resolved?.address == q) {
                    draft.resolved = enriched
                }
            }
            return
        }
        resolving = true
        resolveJob = scope.launch {
            delay(250)
            if (!isActive) return@launch
            val r = runCatching { SendApiClient.api.resolve(q) }.getOrNull()
            if (!isActive) return@launch
            draft.resolved = r
            // Carry over historical sent-count if this address is in our
            // contacts list — keeps the "N previous sends" hint working
            // for typed addresses, not just contact picks.
            draft.previousSendsToRecipient =
                if (r != null) contacts.firstOrNull { it.address == r.address }?.sentCount else null
            resolving = false
        }
    }

    fun pickContact(c: SendContactDTO) {
        // Cancel any in-flight resolve and raise the suppression flag BEFORE
        // writing recipientInput — otherwise the change handler re-resolves
        // on the contact's name and clobbers the authoritative address.
        resolveJob?.cancel()
        resolving = false
        suppressNextResolve = true

        draft.recipientInput = c.name ?: c.address
        // Optimistic resolution so the recipient shows instantly.
        draft.resolved = SendResolvedRecipient(
            address = c.address,
            displayName = c.name ?: shortAddress(c.address),
            source = "contact",
        )
        draft.previousSendsToRecipient = c.sentCount
        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        focusManager.clearFocus()

        // Enrich with the recipient's payout bank. If they have a primary
        // bank, STAY here so the "Their bank" rail pops up; otherwise
        // continue straight through. The token guards the async branch.
        pickCounter += 1
        val token = pickCounter
        pendingPickToken = token
        resolveJob = scope.launch {
            val enriched = runCatching { SendApiClient.api.resolve(c.address) }.getOrNull()
            if (!isActive || pendingPickToken != token) return@launch
            if (enriched?.recipientBank?.hasPrimary == true) {
                draft.resolved = enriched
                pendingPickToken = null
                // Stay — the rail toggle is now visible.
            } else {
                pendingPickToken = null
                onNext()
            }
        }
    }

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
        contacts = runCatching { SendApiClient.api.contacts() }.getOrNull()?.contacts ?: emptyList()
        loadingContacts = false
    }

    // A changed recipient resets the pay-mode back to on-chain so the toggle
    // never carries a stale "Their bank" choice onto a different person.
    LaunchedEffect(draft.resolved?.address) { payMode = PayMode.Onchain }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Header
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlassCircleButton(Icons.Filled.ChevronLeft, onClick = onBack, tint = TaliseColors.fg)
            Spacer(Modifier.weight(1f))
            SendMicroLabel("Send to", color = TaliseColors.fgMuted, kerning = 2.0)
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.size(38.dp))
        }

        // Input card
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 16.dp)
                .background(TaliseColors.surface, RoundedCornerShape(20.dp))
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            SendMicroLabel("To", color = TaliseColors.fgDim, kerning = 1.5)
            Box {
                if (draft.recipientInput.isEmpty()) {
                    Text(
                        "alice / 0x6487… / +44 7…",
                        style = TaliseType.body(17.sp),
                        color = TaliseColors.fgDim,
                    )
                }
                BasicTextField(
                    value = draft.recipientInput,
                    onValueChange = { new ->
                        draft.recipientInput = new
                        // Don't re-resolve when pickContact programmatically
                        // sets the input — it already set the authoritative
                        // address; re-resolving on the name would clobber it.
                        if (suppressNextResolve) {
                            suppressNextResolve = false
                        } else {
                            scheduleResolve(new)
                        }
                    },
                    singleLine = true,
                    textStyle = TaliseType.body(17.sp).copy(color = TaliseColors.fg),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                    modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
                )
            }
        }

        // Resolve status
        Box(Modifier.fillMaxWidth().padding(horizontal = 28.dp).padding(top = 8.dp)) {
            val r = draft.resolved
            when {
                resolving -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    CircularProgressIndicator(
                        color = TaliseColors.fgDim,
                        strokeWidth = 1.5.dp,
                        modifier = Modifier.size(11.dp),
                    )
                    SendMicroLabel("Resolving…", color = TaliseColors.fgDim, kerning = 0.0)
                }
                r != null -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        Icons.Filled.CheckCircle,
                        contentDescription = null,
                        tint = TaliseColors.greenMint,
                        modifier = Modifier.size(11.dp),
                    )
                    Text(
                        r.displayName ?: r.address,
                        style = TaliseType.mono(11.sp, FontWeight.Light),
                        color = TaliseColors.greenMint,
                        maxLines = 1,
                    )
                    Text(
                        shortAddress(r.address),
                        style = TaliseType.mono(10.sp, FontWeight.Light),
                        color = TaliseColors.fgDim,
                        maxLines = 1,
                    )
                }
                draft.recipientInput.length >= 3 -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        Icons.Outlined.ErrorOutline,
                        contentDescription = null,
                        tint = TaliseColors.danger,
                        modifier = Modifier.size(11.dp),
                    )
                    Text(
                        "No match yet for \"${draft.recipientInput}\"",
                        style = TaliseType.mono(11.sp, FontWeight.Light),
                        color = TaliseColors.danger,
                        maxLines = 1,
                    )
                }
                else -> Spacer(Modifier.height(14.dp))
            }
        }

        // Pay mode toggle (off-ramp Phase 3) — only with a primary bank.
        if (recipientHasBank) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 14.dp)
                    .background(TaliseColors.surface, RoundedCornerShape(16.dp))
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                PayModeTab(
                    title = "On-chain",
                    sub = "in seconds",
                    selected = payMode == PayMode.Onchain,
                    onClick = {
                        payMode = PayMode.Onchain
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    },
                    modifier = Modifier.weight(1f),
                )
                PayModeTab(
                    title = "Their bank",
                    sub = "NGN",
                    selected = payMode == PayMode.Bank,
                    onClick = {
                        payMode = PayMode.Bank
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Eyebrow(
            "Recent",
            modifier = Modifier.padding(horizontal = 28.dp).padding(top = 26.dp),
        )

        // Contacts
        Box(Modifier.fillMaxWidth().weight(1f)) {
            when {
                loadingContacts -> Row(
                    Modifier.padding(horizontal = 28.dp).padding(top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CircularProgressIndicator(
                        color = TaliseColors.fgDim,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(
                        "Loading contacts…",
                        style = TaliseType.mono(11.sp, FontWeight.Light),
                        color = TaliseColors.fgDim,
                    )
                }
                contacts.isEmpty() -> Text(
                    "No recent recipients yet, your first send will appear here.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgDim,
                    modifier = Modifier.padding(horizontal = 28.dp).padding(top = 12.dp),
                )
                else -> LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 8.dp),
                ) {
                    itemsIndexed(contacts, key = { _, c -> c.address }) { index, c ->
                        ContactRow(c, onClick = { pickContact(c) })
                        if (index != contacts.lastIndex) {
                            LiquidGlassDivider(inset = 70.dp)
                        }
                    }
                }
            }
        }

        // Next button
        CapsuleButton(
            title = if (recipientHasBank && payMode == PayMode.Bank) "Pay their bank" else "Next",
            enabled = canAdvance,
            onClick = {
                if (!canAdvance) return@CapsuleButton
                // A manual Next cancels any pending contact-pick auto-advance
                // so it can't double-fire navigation after this tap.
                pendingPickToken = null
                focusManager.clearFocus()
                if (recipientHasBank && payMode == PayMode.Bank) {
                    showBankSheet = true
                } else {
                    onNext()
                }
            },
            modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
        )
    }

    // "Their bank" payout sheet — settles there and closes the whole flow.
    if (showBankSheet) {
        val r = draft.resolved
        val bank = r?.recipientBank
        if (r != null && bank != null && bank.hasPrimary) {
            val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
            ModalBottomSheet(
                onDismissRequest = { showBankSheet = false },
                sheetState = sheetState,
                containerColor = TaliseColors.bg,
            ) {
                val typed = draft.recipientInput.trim()
                SendToBankView(
                    recipient = typed.ifEmpty { r.address },
                    recipientDisplay = r.displayName ?: shortAddress(r.address),
                    bankLabel = bank.label,
                    onDone = {
                        // Bank payout completed (or cancelled) — close the
                        // whole Send flow so the user lands back on Home.
                        showBankSheet = false
                        onClose()
                    },
                )
            }
        }
    }
}

/** One tab of the [On-chain · instant] vs [Their bank · NGN] control. */
@Composable
private fun PayModeTab(
    title: String,
    sub: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .background(
                if (selected) TaliseColors.greenMint else androidx.compose.ui.graphics.Color.Transparent,
                RoundedCornerShape(12.dp),
            )
            .clickable { onClick() }
            .padding(vertical = 9.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            title,
            style = TaliseType.heading(14.sp, FontWeight.Medium),
            color = if (selected) TaliseColors.inkOnGreen else TaliseColors.fg,
        )
        Text(
            sub,
            style = TaliseType.mono(10.sp, FontWeight.Light),
            color = if (selected) TaliseColors.inkOnGreen.copy(alpha = 0.6f) else TaliseColors.fgMuted,
        )
    }
}

/** One recent-contact row: initials disc, name, short address, sent count. */
@Composable
private fun ContactRow(c: SendContactDTO, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(38.dp).background(TaliseColors.surface2, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initials(c),
                style = TaliseType.heading(13.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                c.display,
                style = TaliseType.body(15.sp, FontWeight.Normal),
                color = TaliseColors.fg,
                maxLines = 1,
            )
            Text(
                shortAddress(c.address),
                style = TaliseType.mono(10.sp, FontWeight.Light),
                color = TaliseColors.fgDim,
                maxLines = 1,
            )
        }
        if (c.sentCount > 0) {
            Text(
                "${c.sentCount} sent",
                style = TaliseType.mono(10.sp, FontWeight.Light),
                color = TaliseColors.fgDim,
            )
        }
    }
}

private fun initials(c: SendContactDTO): String {
    val src = c.name ?: c.address
    val cleaned = src.replace("@talise.sui", "").replace(".sui", "")
    val parts = cleaned.split(" ").filter { it.isNotEmpty() }
    if (parts.size >= 2) {
        return "${parts[0].first()}${parts[1].first()}".uppercase()
    }
    val trimmed = cleaned.dropWhile { it == '0' || it == 'x' }
    return trimmed.take(2).uppercase()
}
