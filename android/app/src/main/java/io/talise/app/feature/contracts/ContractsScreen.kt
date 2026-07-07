package io.talise.app.feature.contracts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.core.model.RecipientResolution
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Contracts hub — a 1:1 port of iOS `ContractsView`. Recurring contractor
 * pay: a list of contract cards (title, payee, rate/cadence, status pill,
 * paid-vs-total progress, periods-paid, cancel-and-refund), a "New contract"
 * CTA, and the loading / empty / error states iOS renders. "New contract"
 * opens the create flow (`CreateContract`): resolve a payee (@handle or 0x),
 * set a rate, cadence, and number of periods, preview the schedule, then
 * slide to fund and sign into the "Contract started" confirmation.
 *
 * Backend rail is REAL: GET/POST /api/contracts + the underlying stream
 * funding pipeline (/api/streams/create-prepare → local zkLogin sign →
 * /api/streams/record) via [ContractsViewModel].
 *
 * Nav signature: `ContractsScreen(onClose: () -> Unit)`.
 */

private val CADENCES = listOf("Hour" to "hourly", "Day" to "daily", "Week" to "weekly", "Month" to "monthly")

/** cadence → interval in minutes (a month is a flat 30 days). */
private val CADENCE_MINUTES = mapOf("hourly" to 60, "daily" to 1440, "weekly" to 10080, "monthly" to 43200)

private fun usd2(v: Double): String = "$" + String.format(java.util.Locale.US, "%,.2f", v)
private fun shortAddr(a: String): String = if (a.length > 10) "${a.take(6)}…${a.takeLast(4)}" else a

@Composable
fun ContractsScreen(onClose: () -> Unit) {
    val vm: ContractsViewModel = viewModel()
    val ui by vm.list.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.load() }

    if (creating) {
        CreateContract(
            vm = vm,
            onClose = {
                creating = false
                vm.resetCreate()
                vm.load()
            },
        )
        return
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp).padding(top = 18.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Header(
                eyebrow = "Contracts",
                title = "Hire & pay over time",
                subtitle = "Set a rate and a number of periods. Payments drip automatically, no network fee.",
                onClose = onClose,
            )

            LiquidGlassButton(title = "New contract", onClick = { creating = true }, tint = TaliseColors.greenMint)

            when {
                ui.loading -> LoadingState()
                ui.error != null -> ErrorState(ui.error!!) { vm.load() }
                ui.rows.isEmpty() -> EmptyState()
                else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ui.rows.forEach { c ->
                        ContractRow(
                            c = c,
                            cancelling = ui.cancelling.contains(c.id),
                            cancelEnabled = ui.cancelling.isEmpty(),
                            onCancel = { vm.cancel(c) },
                        )
                    }
                }
            }

            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun Header(eyebrow: String, title: String, subtitle: String?, onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Eyebrow(eyebrow, color = TaliseColors.fgDim)
            Text(
                title,
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.8).sp,
                color = TaliseColors.fg,
            )
            if (subtitle != null) {
                Text(subtitle, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            }
        }
        Box(
            Modifier.size(32.dp).background(TaliseColors.surface2, CircleShape).clickable { onClose() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fg, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun LoadingState() {
    Box(contentAlignment = Alignment.Center) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            repeat(2) {
                Box(Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface))
            }
        }
        CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun ErrorState(msg: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(top = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(msg, style = TaliseType.body(13.sp), color = TaliseColors.fgMuted, textAlign = TextAlign.Center)
        LiquidGlassButton(title = "Try again", onClick = onRetry, tint = null, fullWidth = false)
    }
}

@Composable
private fun EmptyState() {
    Column(
        Modifier.fillMaxWidth().padding(top = 50.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Outlined.Description, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(40.dp))
        Text("No contracts yet", style = TaliseType.heading(18.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            "Create one to pay a contractor or employee on a schedule.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

@Composable
private fun ContractRow(
    c: ContractDTO,
    cancelling: Boolean,
    cancelEnabled: Boolean,
    onCancel: () -> Unit,
) {
    val paid = c.paidUsd ?: 0.0
    val progress = if (c.totalUsd > 0) minOf(1.0, paid / c.totalUsd).toFloat() else 0f
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    c.title,
                    style = TaliseType.heading(16.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${c.payeeHandle ?: shortAddr(c.payeeAddress)} · ${usd2(c.rateUsd)} / ${c.cadenceLabel ?: c.cadence}",
                    style = TaliseType.mono(10.sp),
                    color = TaliseColors.fgDim,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(c.status)
        }
        Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.06f))) {
            if (progress > 0f) {
                Box(Modifier.fillMaxWidth(progress).height(6.dp).clip(CircleShape).background(TaliseColors.greenMint))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${usd2(paid)} of ${usd2(c.totalUsd)}", style = TaliseType.mono(10.sp), color = TaliseColors.fgMuted)
            Spacer(Modifier.weight(1f))
            Text("${c.periodsPaid ?: 0}/${c.periods} periods", style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
        }
        if (c.status == "active") {
            Spacer(Modifier.height(4.dp))
            LiquidGlassButton(
                title = if (cancelling) "Cancelling…" else "Cancel & refund remainder",
                onClick = onCancel,
                tint = null,
                enabled = cancelEnabled,
                loading = cancelling,
            )
        }
    }
}

@Composable
private fun StatusPill(status: String) {
    val tint = when (status) {
        "active" -> TaliseColors.accent
        "completed" -> TaliseColors.greenMint
        else -> TaliseColors.fgDim
    }
    Text(
        status.replaceFirstChar { it.uppercase() },
        style = TaliseType.mono(9.sp, FontWeight.Light),
        letterSpacing = 0.6.sp,
        color = tint,
        modifier = Modifier.clip(CircleShape).background(tint.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

// MARK: - Create contract

@Composable
private fun CreateContract(vm: ContractsViewModel, onClose: () -> Unit) {
    val ui by vm.create.collectAsStateWithLifecycle()

    var recipientQuery by remember { mutableStateOf("") }
    var resolved by remember { mutableStateOf<RecipientResolution?>(null) }
    var resolving by remember { mutableStateOf(false) }
    var resolveFailed by remember { mutableStateOf(false) }

    var title by remember { mutableStateOf("") }
    var rateText by remember { mutableStateOf("") }
    var cadence by remember { mutableStateOf("weekly") }
    var periodsText by remember { mutableStateOf("4") }

    val rateUsd = rateText.toDoubleOrNull() ?: 0.0
    val periods = periodsText.toIntOrNull() ?: 0
    val totalUsd = rateUsd * periods
    val canCreate = resolved != null && title.isNotEmpty() && rateUsd >= 0.01 && periods >= 1 &&
        (totalUsd / maxOf(1, periods)) >= 0.01

    // Debounced payee resolution — mirrors iOS scheduleResolve(debounce:).
    LaunchedEffect(recipientQuery) {
        resolved = null
        resolveFailed = false
        val q = recipientQuery.trim()
        if (q.isEmpty()) { resolving = false; return@LaunchedEffect }
        delay(400)
        resolving = true
        try {
            resolved = ApiClient.api.resolveRecipient(q)
            resolveFailed = false
        } catch (t: CancellationException) {
            throw t
        } catch (t: Throwable) {
            resolved = null
            resolveFailed = true
        } finally {
            resolving = false
        }
    }

    if (ui.created) {
        CreatedView(
            totalUsd = totalUsd,
            payee = resolved?.label ?: "payee",
            periods = periods,
            onDone = onClose,
        )
        return
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp).padding(top = 18.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Header(eyebrow = "New contract", title = "Set up recurring pay", subtitle = null, onClose = onClose)

            RecipientField(
                query = recipientQuery,
                onQueryChange = { recipientQuery = it },
                resolving = resolving,
                resolved = resolved,
                resolveFailed = resolveFailed,
            )

            FieldsCard(
                title = title, onTitleChange = { title = it },
                rateText = rateText, onRateChange = { rateText = it },
                cadence = cadence, onCadenceChange = { cadence = it },
                periodsText = periodsText, onPeriodsChange = { new -> periodsText = new.filter { it.isDigit() }.take(4) },
            )

            PreviewCard(periods = periods, rateUsd = rateUsd, totalUsd = totalUsd)

            if (ui.error != null) {
                Text(ui.error!!, style = TaliseType.body(12.sp), color = TaliseColors.danger)
            }

            Spacer(Modifier.height(90.dp))
        }

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(TaliseColors.bg)
                .padding(horizontal = 22.dp).padding(top = 12.dp, bottom = 24.dp),
        ) {
            Box(Modifier.alpha(if (ui.creating || !canCreate) 0.5f else 1f)) {
                SlideToConfirm(
                    title = if (ui.creating) "Funding…" else "Slide to fund & sign",
                    enabled = canCreate && !ui.creating,
                    tint = TaliseColors.greenMint,
                    reset = ui.error != null && !ui.creating,
                    onConfirm = {
                        val to = resolved?.address ?: return@SlideToConfirm
                        vm.createContract(
                            to = to,
                            toHandle = resolved?.displayName,
                            title = title,
                            rateUsd = rateUsd,
                            cadence = cadence,
                            periods = periods,
                            intervalMinutes = CADENCE_MINUTES[cadence] ?: 10080,
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun RecipientField(
    query: String,
    onQueryChange: (String) -> Unit,
    resolving: Boolean,
    resolved: RecipientResolution?,
    resolveFailed: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text("PAYEE", style = TaliseType.mono(9.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    if (query.isEmpty()) {
                        Text("@handle or 0x address", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                    }
                    inner()
                },
            )
            when {
                resolving -> CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                resolved != null -> Icon(Icons.Filled.CheckCircle, null, tint = TaliseColors.accent, modifier = Modifier.size(18.dp))
                resolveFailed -> Icon(Icons.Filled.Cancel, null, tint = TaliseColors.danger, modifier = Modifier.size(18.dp))
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
        when {
            resolved != null -> Text("Resolved: ${resolved.label}", style = TaliseType.mono(10.sp), color = TaliseColors.accent)
            resolveFailed -> Text(
                "Couldn't find that payee. Check the @handle or address.",
                style = TaliseType.mono(10.sp), color = TaliseColors.danger,
            )
        }
    }
}

@Composable
private fun FieldsCard(
    title: String, onTitleChange: (String) -> Unit,
    rateText: String, onRateChange: (String) -> Unit,
    cadence: String, onCadenceChange: (String) -> Unit,
    periodsText: String, onPeriodsChange: (String) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Labeled("ROLE / TITLE") {
            BasicTextField(
                value = title,
                onValueChange = onTitleChange,
                singleLine = true,
                textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    if (title.isEmpty()) Text("e.g. Designer, Q3 retainer", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                    inner()
                },
            )
        }
        Labeled("RATE (USDsui per period)") {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("$", style = TaliseType.heading(18.sp), color = TaliseColors.fgMuted)
                BasicTextField(
                    value = rateText,
                    onValueChange = onRateChange,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TaliseType.display(22.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (rateText.isEmpty()) Text("0.00", style = TaliseType.display(22.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                        inner()
                    },
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("PER", style = TaliseType.mono(9.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CADENCES.forEach { (label, value) ->
                    val on = cadence == value
                    Text(
                        label,
                        style = TaliseType.body(13.sp, if (on) FontWeight.Medium else FontWeight.Light),
                        color = if (on) TaliseColors.inkOnGreen else TaliseColors.fg,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (on) TaliseColors.greenMint else TaliseColors.surface2)
                            .clickable { onCadenceChange(value) }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                    )
                }
            }
        }
        Labeled("NUMBER OF PERIODS") {
            BasicTextField(
                value = periodsText,
                onValueChange = onPeriodsChange,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    if (periodsText.isEmpty()) Text("4", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                    inner()
                },
            )
        }
    }
}

@Composable
private fun Labeled(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(label, style = TaliseType.mono(9.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
        content()
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
    }
}

@Composable
private fun PreviewCard(periods: Int, rateUsd: Double, totalUsd: Double) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        Modifier.fillMaxWidth()
            .clip(shape)
            .background(TaliseColors.accent.copy(alpha = 0.10f))
            .border(1.dp, TaliseColors.accent.copy(alpha = 0.22f), shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Filled.Bolt, null, tint = TaliseColors.accent, modifier = Modifier.size(12.dp))
            Text(
                "$periods payments of ${usd2(rateUsd)}",
                style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.fg,
            )
        }
        Text(
            "${usd2(totalUsd)} total, funded upfront and released one period at a time. No network fee, Talise sponsors the gas.",
            style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun CreatedView(totalUsd: Double, payee: String, periods: Int, onDone: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(horizontal = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            Modifier.size(96.dp).clip(CircleShape).background(TaliseColors.greenMint.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(56.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("Contract started", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fg)
        Spacer(Modifier.height(8.dp))
        Text(
            "${usd2(totalUsd)} to $payee · $periods periods",
            style = TaliseType.body(13.sp), color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 30.dp),
        )
        Spacer(Modifier.weight(1f))
        LiquidGlassButton(title = "Done", onClick = onDone, tint = TaliseColors.greenMint)
        Spacer(Modifier.height(24.dp))
    }
}
