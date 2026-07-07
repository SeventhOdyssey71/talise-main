package io.talise.app.feature.rules

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Create a scheduled-send rule — a 1:1 port of iOS `RuleEditView`. Pick who
 * it pays, how much, how often, and how much to load into the rule's pot up
 * front. The rule is NON-CUSTODIAL: the pot lives in an on-chain
 * `standing_order` object you own, with the recipient + amount baked on chain.
 *
 * Flow: form → prepareCreate (sponsored `standing_order::create` bytes that
 * fund the pot) → sign with the zkLogin ephemeral key → recordCreate
 * (activate) → success. No per-run signing.
 */

/** Schedule presets. Daily/weekly map to an interval in minutes; monthly sends a day-of-month. */
internal enum class RuleCadence(val label: String, val intervalMinutes: Int?) {
    Daily("Every day", 1440),
    Weekly("Every week", 10080),
    Monthly("Monthly (a day)", null),
}

@Composable
fun RuleEditScreen(onBack: () -> Unit) {
    val vm: RuleEditViewModel = viewModel()
    val ui by vm.ui.collectAsStateWithLifecycle()

    var name by remember { mutableStateOf("") }
    var recipient by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var cadence by remember { mutableStateOf(RuleCadence.Daily) }
    var dayOfMonth by remember { mutableIntStateOf(1) }
    /** How many payments' worth to load into the pot now (default one). */
    var prefundPayments by remember { mutableIntStateOf(1) }

    // Live recipient resolution (mirrors the Payroll team editor).
    var resolved by remember { mutableStateOf<RecipientResolution?>(null) }
    var resolving by remember { mutableStateOf(false) }
    var resolveFailed by remember { mutableStateOf(false) }

    val trimmedName = name.trim()
    val trimmedRecipient = recipient.trim()
    val amountValue = amount.trim().toDoubleOrNull() ?: 0.0
    /** Total loaded into the pot up front = one payment x number of payments. */
    val prefundUsd = amountValue * prefundPayments
    val canCreate = trimmedName.isNotEmpty() && resolved != null && amountValue >= 0.01 && !ui.creating

    // Debounced resolve — .task(id: trimmedRecipient) on iOS.
    LaunchedEffect(trimmedRecipient) {
        if (trimmedRecipient.isEmpty()) {
            resolved = null; resolveFailed = false; resolving = false
            return@LaunchedEffect
        }
        delay(400)
        resolving = true; resolveFailed = false
        try {
            val r = ApiClient.api.resolveRecipient(trimmedRecipient)
            resolved = r; resolveFailed = false
        } catch (t: CancellationException) {
            throw t
        } catch (t: Throwable) {
            resolved = null; resolveFailed = true
        } finally {
            resolving = false
        }
    }

    val created = ui.created
    if (created != null) {
        RuleSuccessView(
            rule = created,
            fundedUsd = ui.fundedUsd,
            fundedPayments = ui.fundedPayments,
            onDone = onBack,
        )
        return
    }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // Back affordance (iOS uses the nav stack's back chrome).
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(TaliseColors.surface2).clickable { onBack() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = TaliseColors.fg, modifier = Modifier.size(15.dp))
            }
        }

        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp).padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // ── Header ──
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("NEW RULE", style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
                Text(
                    "Create a rule",
                    style = TaliseType.heading(24.sp, FontWeight.Medium),
                    letterSpacing = (-0.5).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "Send a fixed amount to someone on a schedule. It runs by itself from its own pot until you pause or cancel it.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            // ── Rule name ──
            Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                CardLabel("RULE NAME")
                FieldBox(height = 48) {
                    BasicTextField(
                        value = name,
                        onValueChange = { name = it },
                        singleLine = true,
                        textStyle = TaliseType.body(16.sp).copy(color = TaliseColors.fg),
                        cursorBrush = SolidColor(TaliseColors.accent),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            if (name.isEmpty()) Text("e.g. Rent", style = TaliseType.body(16.sp), color = TaliseColors.fgDim)
                            inner()
                        },
                    )
                }
            }

            // ── Pay to ──
            Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CardLabel("PAY TO")
                FieldBox(height = 48) {
                    BasicTextField(
                        value = recipient,
                        onValueChange = { recipient = it },
                        singleLine = true,
                        textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
                        cursorBrush = SolidColor(TaliseColors.accent),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            if (recipient.isEmpty()) {
                                Text("@handle, name.talise.sui or 0x…", style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
                            }
                            inner()
                        },
                    )
                }
                when {
                    resolving -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(12.dp))
                        Text("Finding…", style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                    }
                    resolved != null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(12.dp))
                        Text(
                            resolved?.label.orEmpty(),
                            style = TaliseType.body(12.5.sp),
                            color = TaliseColors.fg,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    resolveFailed -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Filled.ErrorOutline, contentDescription = null, tint = TaliseColors.danger, modifier = Modifier.size(12.dp))
                        Text("No one found by that name", style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.danger)
                    }
                }
            }

            // ── Amount each time ──
            Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                CardLabel("AMOUNT EACH TIME")
                FieldBox(height = 54) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("$", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
                        BasicTextField(
                            value = amount,
                            onValueChange = { amount = it },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            textStyle = TaliseType.heading(22.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                            cursorBrush = SolidColor(TaliseColors.accent),
                            modifier = Modifier.weight(1f),
                            decorationBox = { inner ->
                                if (amount.isEmpty()) Text("10.00", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                                inner()
                            },
                        )
                    }
                }
            }

            // ── Schedule ──
            Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CardLabel("HOW OFTEN")
                    Spacer(Modifier.weight(1f))
                    CadencePicker(cadence = cadence, onSelect = { cadence = it })
                }
                if (cadence == RuleCadence.Monthly) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CardLabel("DAY OF MONTH")
                        Spacer(Modifier.weight(1f))
                        Stepper(
                            valueLabel = "$dayOfMonth",
                            onMinus = { if (dayOfMonth > 1) dayOfMonth -= 1 },
                            onPlus = { if (dayOfMonth < 28) dayOfMonth += 1 },
                        )
                    }
                }
            }

            // ── Load the pot ──
            Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CardLabel("LOAD THE POT")
                    Spacer(Modifier.weight(1f))
                    Stepper(
                        valueLabel = "$prefundPayments " + if (prefundPayments == 1) "payment" else "payments",
                        onMinus = { if (prefundPayments > 1) prefundPayments -= 1 },
                        onPlus = { if (prefundPayments < 60) prefundPayments += 1 },
                    )
                }
                if (amountValue >= 0.01) {
                    Text(
                        "Funds the rule's pot: $prefundPayments ${if (prefundPayments == 1) "payment" else "payments"} of ${usd2(amountValue)} (${usd2(prefundUsd)} total).",
                        style = TaliseType.body(12.5.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                } else {
                    Text(
                        "Set an amount to choose how much to load.",
                        style = TaliseType.body(12.5.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }
            }

            // ── Preview ──
            Column(Modifier.fillMaxWidth().rampCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                CardLabel("PREVIEW")
                Text(
                    previewLine(
                        cadence = cadence,
                        dayOfMonth = dayOfMonth,
                        amountValue = amountValue,
                        resolvedLabel = resolved?.label,
                        trimmedRecipient = trimmedRecipient,
                    ),
                    style = TaliseType.body(14.sp),
                    color = TaliseColors.fg,
                )
                if (amountValue > 0 && amountValue < 0.01) {
                    Text(
                        "The amount must be at least $0.01.",
                        style = TaliseType.body(12.sp, FontWeight.Light),
                        color = TaliseColors.danger,
                    )
                }
            }

            if (ui.error != null) {
                Text(
                    ui.error!!,
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.danger,
                )
            }

            Box(Modifier.alpha(if (canCreate) 1f else 0.6f)) {
                SlideToConfirm(
                    title = if (ui.creating) "Creating…" else "Slide to create rule",
                    enabled = canCreate,
                    tint = TaliseColors.accent,
                    reset = ui.error != null && !ui.creating,
                    onConfirm = {
                        vm.create(
                            name = trimmedName,
                            intervalMinutes = cadence.intervalMinutes,
                            dayOfMonth = if (cadence == RuleCadence.Monthly) dayOfMonth else null,
                            toRecipient = trimmedRecipient,
                            amountUsd = amountValue,
                            prefundUsd = prefundUsd,
                            prefundPayments = prefundPayments,
                        )
                    },
                )
            }

            Text(
                "One signature funds the rule's own pot. Payouts release automatically, gaslessly, no signing each time, and the remaining balance is refunded if you cancel.",
                style = TaliseType.mono(11.sp),
                color = TaliseColors.fgMuted,
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun previewLine(
    cadence: RuleCadence,
    dayOfMonth: Int,
    amountValue: Double,
    resolvedLabel: String?,
    trimmedRecipient: String,
): String {
    val who = resolvedLabel ?: trimmedRecipient.ifEmpty { "someone" }
    val amt = if (amountValue > 0) usd2(amountValue) else "$0.00"
    return when (cadence) {
        RuleCadence.Daily -> "$amt to $who, every day."
        RuleCadence.Weekly -> "$amt to $who, every week."
        RuleCadence.Monthly -> "$amt to $who, on the ${ruleOrdinal(dayOfMonth)} of each month."
    }
}

// MARK: - Success

@Composable
private fun RuleSuccessView(
    rule: RuleDTO,
    fundedUsd: Double,
    fundedPayments: Int,
    onDone: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            Modifier.padding(top = 24.dp).size(92.dp).clip(CircleShape)
                .background(TaliseColors.accent.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(38.dp))
        }
        Text("Rule created", style = TaliseType.heading(24.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            "${usd2(rule.amountUsd)} to ${rule.recipientLabel} · ${rule.cadenceLine}",
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 28.dp),
        )

        // The pot is funded — restate that it's non-custodial + refundable.
        Column(
            Modifier.fillMaxWidth().padding(top = 8.dp).rampCard().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CardLabel("POT LOADED")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Icon(Icons.Filled.Verified, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(13.dp))
                Text(
                    "${usd2(fundedUsd)} loaded, $fundedPayments ${if (fundedPayments == 1) "payment" else "payments"}",
                    style = TaliseType.body(13.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
            }
            Text(
                "Payouts are pulled from this rule's own pot. You own it, and the remaining balance is refunded if you cancel.",
                style = TaliseType.body(12.5.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        Row(
            Modifier.fillMaxWidth().padding(top = 4.dp).height(54.dp)
                .clip(CircleShape).background(TaliseColors.greenMint).clickable { onDone() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Text("Done", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = Color.Black)
        }

        Spacer(Modifier.height(24.dp))
    }
}

// MARK: - Small pieces

@Composable
private fun CardLabel(text: String) {
    Text(text, style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
}

@Composable
private fun FieldBox(height: Int, content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(height.dp)
            .clip(RoundedCornerShape(14.dp)).background(TaliseColors.surface2)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) { content() }
}

/** Menu-style cadence picker — iOS `Picker(.menu)` tinted accent. */
@Composable
private fun CadencePicker(cadence: RuleCadence, onSelect: (RuleCadence) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.clip(RoundedCornerShape(10.dp)).clickable { open = true }.padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(cadence.label, style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.accent)
            Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            RuleCadence.entries.forEach { c ->
                DropdownMenuItem(
                    text = { Text(c.label) },
                    trailingIcon = {
                        if (c == cadence) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                    },
                    onClick = { open = false; onSelect(c) },
                )
            }
        }
    }
}

/** Minus / value / plus — the iOS `Stepper` stand-in. */
@Composable
private fun Stepper(valueLabel: String, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StepperButton("-", onMinus)
        Text(valueLabel, style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.fg)
        StepperButton("+", onPlus)
    }
}

@Composable
private fun StepperButton(glyph: String, onClick: () -> Unit) {
    Box(
        Modifier.size(28.dp).clip(CircleShape).background(TaliseColors.surface2).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(glyph, style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.fg)
    }
}
