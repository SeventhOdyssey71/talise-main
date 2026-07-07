package io.talise.app.feature.profile

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// MARK: - One bank option (NIBSS code + display name)

/** Matches the `OfframpBank` shape used by the Withdraw flow — `bankCode` is the plain NIBSS code. */
internal data class LinkBank(val name: String, val bankCode: String)

/** Shared NIBSS bank list — same set the iOS Withdraw off-ramp uses. */
internal object NIBSSBanks {
    val all: List<LinkBank> = listOf(
        LinkBank("Access Bank", "044"),
        LinkBank("Guaranty Trust Bank", "058"),
        LinkBank("First Bank of Nigeria", "011"),
        LinkBank("Zenith Bank", "057"),
        LinkBank("United Bank For Africa", "033"),
        LinkBank("Wema Bank", "035"),
        LinkBank("Sterling Bank", "232"),
        LinkBank("Fidelity Bank", "070"),
        LinkBank("First City Monument Bank", "214"),
        LinkBank("Stanbic IBTC Bank", "039"),
        LinkBank("Union Bank", "032"),
        LinkBank("Polaris Bank", "076"),
        LinkBank("Ecobank", "050"),
        LinkBank("Keystone Bank", "082"),
        LinkBank("Heritage Bank", "030"),
        LinkBank("Unity Bank", "215"),
        LinkBank("Providus Bank", "101"),
        LinkBank("Kuda", "090267"),
        LinkBank("OPay", "100004"),
        LinkBank("PalmPay", "100033"),
        LinkBank("Moniepoint", "090405"),
    )
}

// MARK: - Linked bank accounts management screen

/**
 * Off-ramp Phase 2 — manage the bank accounts linked to the user's Talise @handle.
 * Exact port of iOS `BankAccountsView`: lists linked accounts (bank + ••••last4 +
 * a verified check), add a new one (bank picker + account number → name-resolved
 * prepare → attestation sign → confirm), and remove one with a confirm.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BankAccountsSheet(onDismiss: () -> Unit) {
    var accounts by remember { mutableStateOf<List<BankAccountDTO>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var showAdd by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<BankAccountDTO?>(null) }
    var removingId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        loadError = null
        try {
            accounts = profileApi.bankAccounts()
            loading = false
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            if (httpCode(t) == 401) {
                loadError = "Sign in to manage your bank accounts."
            } else if (accounts.isEmpty()) {
                // Soft-fail on first load; show error only if we have nothing.
                loadError = "Couldn't load your bank accounts."
            }
            loading = false
        }
    }

    fun remove(acct: BankAccountDTO) {
        removing = null
        removingId = acct.id
        scope.launch {
            try {
                profileApi.removeBankAccount(acct.id)
                accounts = accounts.filterNot { it.id == acct.id }
            } catch (t: Throwable) {
                loadError = "Couldn't remove that account. Please try again."
            }
            removingId = null
        }
    }

    LaunchedEffect(Unit) { load() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = TaliseColors.bg,
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f)) {
            SheetTopBar(title = "Bank accounts", onDone = onDismiss)
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
                    .padding(top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                when {
                    loading -> BankLoadingState()
                    accounts.isEmpty() -> BankEmptyState()
                    else -> BankAccountsList(
                        accounts = accounts,
                        removingId = removingId,
                        onRemove = { removing = it },
                    )
                }

                // Add bank account CTA
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                        .clip(CircleShape)
                        .background(TaliseColors.fg, CircleShape)
                        .clickable { showAdd = true },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    Icon(
                        Icons.Filled.Add,
                        contentDescription = null,
                        tint = TaliseColors.bg,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        "Add bank account",
                        style = TaliseType.heading(15.sp, FontWeight.Medium),
                        color = TaliseColors.bg,
                    )
                }

                loadError?.let {
                    Text(
                        it,
                        style = TaliseType.body(12.sp, FontWeight.Light),
                        color = TaliseColors.danger,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                Spacer(Modifier.height(40.dp))
            }
        }
    }

    removing?.let { acct ->
        AlertDialog(
            onDismissRequest = { removing = null },
            containerColor = TaliseColors.surface,
            title = {
                Text(
                    "Remove this account?",
                    style = TaliseType.heading(17.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
            },
            text = {
                Text(
                    "${acct.bankName} ••••${acct.last4} will be unlinked from your @handle.",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            },
            confirmButton = {
                TextButton(onClick = { remove(acct) }) {
                    Text("Remove", style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { removing = null }) {
                    Text("Cancel", style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
                }
            },
        )
    }

    if (showAdd) {
        AddBankAccountSheet(
            onLinked = { newAccount ->
                // Optimistically insert, then re-sync to pick up server fields.
                if (accounts.none { it.id == newAccount.id }) {
                    accounts = listOf(newAccount) + accounts
                }
                scope.launch { load() }
            },
            onDismiss = { showAdd = false },
        )
    }
}

/** Inline top bar for full-height sheets — matches iOS inline nav title + Done. */
@Composable
internal fun SheetTopBar(title: String, onDone: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 4.dp, bottom = 8.dp),
    ) {
        Text(
            title,
            style = TaliseType.heading(16.sp, FontWeight.SemiBold),
            color = TaliseColors.fg,
            modifier = Modifier.align(Alignment.Center),
        )
        Text(
            "Done",
            style = TaliseType.body(15.sp, FontWeight.Medium),
            color = TaliseColors.accent,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .clickable(onClick = onDone),
        )
    }
}

@Composable
private fun BankLoadingState() {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CircularProgressIndicator(color = TaliseColors.fg, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
        Text(
            "Loading your accounts…",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun BankEmptyState() {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow("Linked bank accounts")
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(TaliseColors.surface, RoundedCornerShape(20.dp))
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                Icons.Filled.AccountBalance,
                contentDescription = null,
                tint = TaliseColors.fgMuted,
                modifier = Modifier.size(24.dp).padding(bottom = 2.dp),
            )
            Text(
                "No accounts linked yet",
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
            Text(
                "Link a Nigerian bank account to your @handle so you can cash out faster.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
    }
}

@Composable
private fun BankAccountsList(
    accounts: List<BankAccountDTO>,
    removingId: String?,
    onRemove: (BankAccountDTO) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow("Linked bank accounts")
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(TaliseColors.surface, RoundedCornerShape(20.dp)),
        ) {
            accounts.forEachIndexed { idx, acct ->
                if (idx > 0) SectionDivider()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    BankAvatar(bankCode = acct.bankCode, bankName = acct.bankName, size = 38.dp, cornerRadius = 11.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                acct.accountName,
                                style = TaliseType.body(14.sp, FontWeight.Medium),
                                color = TaliseColors.fg,
                                maxLines = 1,
                            )
                            if (acct.attested) {
                                Icon(
                                    Icons.Filled.CheckCircle,
                                    contentDescription = null,
                                    tint = TaliseColors.accent,
                                    modifier = Modifier.size(12.dp),
                                )
                            }
                        }
                        Text(
                            "${acct.bankName} ••••${acct.last4}",
                            style = TaliseType.mono(11.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                            maxLines = 1,
                        )
                    }
                    if (removingId == acct.id) {
                        CircularProgressIndicator(
                            color = TaliseColors.fgMuted,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(16.dp),
                        )
                    } else {
                        Box(
                            Modifier.size(30.dp).clickable { onRemove(acct) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filled.Delete,
                                contentDescription = "Remove",
                                tint = Color(0xFFE08D8A),
                                modifier = Modifier.size(15.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Add bank account flow

/**
 * Two-step add flow inside its own sheet:
 *   1. Bank picker + 10-digit account number.
 *   2. `/link/prepare` resolves the account name (shown as "✓ NAME") for the user
 *      to confirm, then "Link account" signs the attestation (sponsored `bytes` OR
 *      a personal `attestMessage`) and POSTs `/link/confirm` with the digest/signature.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AddBankAccountSheet(onLinked: (BankAccountDTO) -> Unit, onDismiss: () -> Unit) {
    var selectedBank by remember { mutableStateOf<LinkBank?>(null) }
    var accountNumber by remember { mutableStateOf("") }
    var showBankPicker by remember { mutableStateOf(false) }

    // Prepare / resolved-name state.
    var preparing by remember { mutableStateOf(false) }
    var prepared by remember { mutableStateOf<BankLinkPrepareResp?>(null) }
    var prepareError by remember { mutableStateOf<String?>(null) }

    // Confirm (sign + record) state.
    var linking by remember { mutableStateOf(false) }
    var linkError by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val canPrepare = selectedBank != null && accountNumber.length == 10 && !preparing

    fun prepare() {
        val bank = selectedBank ?: return
        preparing = true
        prepareError = null
        linkError = null
        scope.launch {
            try {
                prepared = profileApi.bankLinkPrepare(
                    BankLinkPrepareBody(bankCode = bank.bankCode, accountNumber = accountNumber)
                )
            } catch (t: Throwable) {
                val code = httpCode(t)
                prepareError = when {
                    code == 401 -> "Sign in to link a bank account."
                    code != null -> friendlyBankError(code, httpErrorMessage(t))
                    else -> "Couldn't verify that account. Check the number and bank."
                }
            }
            preparing = false
        }
    }

    fun link() {
        val p = prepared ?: return
        linking = true
        linkError = null
        scope.launch {
            try {
                // Sign the attestation. The server returns EITHER sponsored `bytes`
                // (sign + submit → tx digest) OR an `attestMessage` string (sign as
                // a personal message → zkLogin signature). Use whichever is present.
                val digest: String = when {
                    !p.bytes.isNullOrEmpty() ->
                        ProfileSigning.signAndSponsorExecute(p.bytes)
                    !p.attestMessage.isNullOrEmpty() ->
                        ProfileSigning.signPersonalMessage(p.attestMessage)
                    else -> {
                        linkError = "Couldn't prepare the attestation. Please try again."
                        linking = false
                        return@launch
                    }
                }
                val record = profileApi.bankLinkConfirm(
                    BankLinkConfirmBody(
                        bankCode = p.bankCode,
                        accountNumber = p.accountNumber,
                        accountName = p.accountName,
                        digest = digest,
                    )
                )
                linking = false
                onLinked(record)
                onDismiss()
                return@launch
            } catch (t: Throwable) {
                val code = httpCode(t)
                linkError = when {
                    code == 401 -> "Sign in to link a bank account."
                    code != null -> friendlyBankError(code, httpErrorMessage(t))
                    t is IllegalStateException -> t.message
                        ?: "Couldn't link that account right now. Please try again."
                    else -> "Couldn't link that account right now. Please try again."
                }
            }
            linking = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = TaliseColors.bg,
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.94f)) {
            // Top bar — title + Cancel (iOS toolbar).
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 4.dp, bottom = 8.dp),
            ) {
                Text(
                    "Add bank account",
                    style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                    color = TaliseColors.fg,
                    modifier = Modifier.align(Alignment.Center),
                )
                Text(
                    "Cancel",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .clickable(onClick = onDismiss),
                )
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    FieldLabel("Bank")
                    // Bank picker row
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .bankFieldSurface()
                            .clickable { showBankPicker = true }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        selectedBank?.let { bank ->
                            BankAvatar(bankCode = bank.bankCode, bankName = bank.name, size = 34.dp, cornerRadius = 9.dp)
                        }
                        Text(
                            selectedBank?.name ?: "Select bank",
                            style = TaliseType.body(15.sp),
                            color = if (selectedBank == null) TaliseColors.fgDim else TaliseColors.fg,
                            modifier = Modifier.weight(1f),
                        )
                        Icon(
                            Icons.Filled.KeyboardArrowDown,
                            contentDescription = null,
                            tint = TaliseColors.fgMuted,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FieldLabel("Account number")
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .bankFieldSurface()
                            .padding(horizontal = 16.dp, vertical = 16.dp),
                    ) {
                        if (accountNumber.isEmpty()) {
                            Text(
                                "10-digit account number",
                                style = TaliseType.body(15.sp),
                                color = TaliseColors.fgDim,
                            )
                        }
                        BasicTextField(
                            value = accountNumber,
                            onValueChange = { new ->
                                val cleaned = new.filter { it.isDigit() }.take(10)
                                accountNumber = cleaned
                                // Editing the number invalidates a prior resolve.
                                if (prepared != null) prepared = null
                                prepareError = null
                            },
                            singleLine = true,
                            textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                            cursorBrush = SolidColor(TaliseColors.accent),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    // Resolved holder name — "✓ NAME" once `/link/prepare` returns.
                    prepared?.let { p ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                            modifier = Modifier.padding(start = 2.dp),
                        ) {
                            Icon(
                                Icons.Filled.CheckCircle,
                                contentDescription = null,
                                tint = TaliseColors.accent,
                                modifier = Modifier.size(13.dp),
                            )
                            Text(
                                p.accountName,
                                style = TaliseType.body(13.sp, FontWeight.Medium),
                                color = TaliseColors.accent,
                                maxLines = 1,
                            )
                        }
                    }
                }

                prepareError?.let { ErrorLine(it) }
                linkError?.let { ErrorLine(it) }

                Spacer(Modifier.height(8.dp))

                // Before resolve → "Check account" (calls /link/prepare).
                // After resolve → "Link account" (signs attestation + /link/confirm).
                if (prepared == null) {
                    BankPrimaryButton(
                        title = if (preparing) "Checking…" else "Check account",
                        busy = preparing,
                        enabled = canPrepare,
                        onClick = { prepare() },
                    )
                } else {
                    BankPrimaryButton(
                        title = if (linking) "Linking…" else "Link account",
                        busy = linking,
                        enabled = !linking,
                        onClick = { link() },
                    )
                }

                Spacer(Modifier.height(28.dp))
            }
        }
    }

    if (showBankPicker) {
        LinkBankPickerSheet(
            banks = NIBSSBanks.all,
            selected = selectedBank,
            onSelect = { bank ->
                selectedBank = bank
                // Bank changed — invalidate any resolved name.
                prepared = null
                prepareError = null
            },
            onDismiss = { showBankPicker = false },
        )
    }
}

@Composable
private fun FieldLabel(s: String) {
    Text(
        s,
        style = TaliseType.mono(10.sp, FontWeight.Light),
        letterSpacing = 1.3.sp,
        color = TaliseColors.fgDim,
    )
}

@Composable
private fun ErrorLine(s: String) {
    Text(
        s,
        style = TaliseType.body(12.sp, FontWeight.Light),
        color = TaliseColors.danger,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun BankPrimaryButton(title: String, busy: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(CircleShape)
            .background(TaliseColors.fg.copy(alpha = if (enabled) 1f else 0.4f), CircleShape)
            .clickable(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
    ) {
        if (busy) {
            CircularProgressIndicator(color = TaliseColors.bg, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        }
        Text(title, style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.bg)
    }
}

/**
 * Flat input-field surface — solid `surface` plate + 1px `line` hairline +
 * rounded corners. Mirrors iOS `fieldSurfaceBank`.
 */
private fun Modifier.bankFieldSurface(cornerRadius: Dp = 16.dp): Modifier {
    val shape = RoundedCornerShape(cornerRadius)
    return this
        .clip(shape)
        .background(TaliseColors.surface, shape)
        .border(1.dp, TaliseColors.line, shape)
}

// MARK: - Searchable bank picker

/**
 * Clean, searchable bank list presented as a sheet. Letter-avatar + name + a
 * checkmark on the selected one; tapping selects and dismisses.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LinkBankPickerSheet(
    banks: List<LinkBank>,
    selected: LinkBank?,
    onSelect: (LinkBank) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(query, banks) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) banks else banks.filter { it.name.lowercase().contains(q) }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = TaliseColors.bg,
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 6.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Select bank",
                    style = TaliseType.heading(18.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(TaliseColors.surface2)
                        .clickable(onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = null,
                        tint = TaliseColors.fg,
                        modifier = Modifier.size(13.dp),
                    )
                }
            }

            Row(
                Modifier
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 8.dp)
                    .fillMaxWidth()
                    .bankFieldSurface()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Filled.Search,
                    contentDescription = null,
                    tint = TaliseColors.fgMuted,
                    modifier = Modifier.size(14.dp),
                )
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) {
                        Text("Search banks", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                    }
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                        cursorBrush = SolidColor(TaliseColors.accent),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            LazyColumn(Modifier.weight(1f).padding(top = 4.dp)) {
                items(filtered, key = { it.bankCode }) { bank ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                onSelect(bank)
                                onDismiss()
                            }
                            .padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        BankAvatar(bankCode = bank.bankCode, bankName = bank.name, size = 36.dp, cornerRadius = 10.dp)
                        Text(
                            bank.name,
                            style = TaliseType.body(15.sp),
                            color = TaliseColors.fg,
                            modifier = Modifier.weight(1f),
                        )
                        if (bank.bankCode == selected?.bankCode) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = null,
                                tint = TaliseColors.accent,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Bank branding (logos + avatar)

/**
 * Bank codes we ship a brand logo for (vendored Nigerian-Bank-Logos set).
 * Everything else falls back to a letter.
 */
private fun bankLogoRes(bankCode: String): Int? = when (bankCode) {
    "011" -> R.drawable.bank_011
    "033" -> R.drawable.bank_033
    "035" -> R.drawable.bank_035
    "039" -> R.drawable.bank_039
    "044" -> R.drawable.bank_044
    "050" -> R.drawable.bank_050
    "057" -> R.drawable.bank_057
    "058" -> R.drawable.bank_058
    "070" -> R.drawable.bank_070
    "214" -> R.drawable.bank_214
    "215" -> R.drawable.bank_215
    "232" -> R.drawable.bank_232
    "301" -> R.drawable.bank_301
    // Fintechs / MFBs (raster brand marks): OPay, PalmPay, Moniepoint, Kuda
    "100004" -> R.drawable.bank_100004
    "100033" -> R.drawable.bank_100033
    "090405" -> R.drawable.bank_090405
    "090267" -> R.drawable.bank_090267
    else -> null
}

/**
 * A bank's brand logo when we have one, else a letter-circle fallback. Square
 * rounded tile — brand marks sit on a clean white tile (Apple-Wallet style)
 * so they read on any surface.
 */
@Composable
internal fun BankAvatar(
    bankCode: String,
    bankName: String,
    size: Dp = 40.dp,
    cornerRadius: Dp = 11.dp,
) {
    val shape = RoundedCornerShape(cornerRadius)
    val logo = bankLogoRes(bankCode)
    if (logo != null) {
        Box(
            Modifier
                .size(size)
                .clip(shape)
                .background(Color.White, shape)
                .border(1.dp, TaliseColors.line, shape),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(logo),
                contentDescription = bankName,
                modifier = Modifier.fillMaxSize().padding(size * 0.16f),
            )
        }
    } else {
        Box(
            Modifier
                .size(size)
                .clip(shape)
                .background(TaliseColors.accentSoft, shape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                bankName.take(1).uppercase(),
                style = TaliseType.heading((size.value * 0.4f).sp, FontWeight.Medium),
                color = TaliseColors.accent,
            )
        }
    }
}
