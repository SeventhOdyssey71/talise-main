package io.talise.app.feature.stream

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.R
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
 * Streamed USDsui payments — a pixel port of iOS `StreamView.swift`:
 *   • `StreamScreen` hosts the setup flow (iOS `StreamSetupView`): recipient
 *     (@handle / 0x), a total, and a schedule (OVER a window, EVERY interval).
 *     An always-visible status block explains why the stream isn't startable
 *     yet or previews the tranches; slide-to-confirm starts it for real over
 *     /api/streams/create-prepare (+ escrow funding or on-chain create) +
 *     /api/streams/record, then shows "Streaming started".
 *   • `StreamsListScreen` (iOS `StreamsListView`): live progress per stream,
 *     recipient claim with a per-second cooldown, sender cancel + refund.
 *
 * Nav signature: `StreamScreen(onClose: () -> Unit)`. iOS reaches the list via
 * a separate "My streams" cover; until Android nav grows that route, a quiet
 * "My streams" pill in the setup header opens the list in place.
 */

private val DURATIONS = listOf("1 hour" to 60, "1 day" to 1440, "1 week" to 10080, "30 days" to 43200)
private val INTERVALS = listOf("1 min" to 1, "10 min" to 10, "1 hour" to 60, "1 day" to 1440)

@Composable
fun StreamScreen(onClose: () -> Unit) {
    var showList by remember { mutableStateOf(false) }
    if (showList) {
        StreamsListView(onDone = { showList = false })
    } else {
        StreamSetupView(onDone = onClose, onShowList = { showList = true })
    }
}

/** Standalone entry for the "My streams" list — for nav wiring (iOS `StreamsListView`). */
@Composable
fun StreamsListScreen(onClose: () -> Unit) {
    StreamsListView(onDone = onClose)
}

// MARK: - Setup flow (iOS StreamSetupView)

@Composable
private fun StreamSetupView(
    onDone: () -> Unit,
    onShowList: () -> Unit,
    vm: StreamSetupViewModel = viewModel(),
) {
    var recipientQuery by remember { mutableStateOf("") }
    var resolved by remember { mutableStateOf<RecipientResolution?>(null) }
    var resolving by remember { mutableStateOf(false) }
    var resolveFailed by remember { mutableStateOf(false) }
    var amountText by remember { mutableStateOf("") }
    var durationMin by remember { mutableStateOf(60) }   // default: 1 hour
    var intervalMin by remember { mutableStateOf(10) }   // default: every 10 minutes
    var slideReset by remember { mutableStateOf(false) }

    val starting by vm.starting.collectAsStateWithLifecycle()
    val started by vm.started.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()

    val totalUsd = amountText.toDoubleOrNull() ?: 0.0
    val numTranches = maxOf(1, durationMin / maxOf(1, intervalMin))
    val trancheUsd = if (numTranches > 0) totalUsd / numTranches else 0.0
    val validSchedule = totalUsd > 0 && trancheUsd >= 0.01 && resolved != null && numTranches in 1..5000

    val intervalLabel = INTERVALS.firstOrNull { it.second == intervalMin }?.first ?: "$intervalMin min"
    val durationLabel = DURATIONS.firstOrNull { it.second == durationMin }?.first ?: "$durationMin min"

    // Resolve the recipient automatically as the user types (debounced ~0.4s);
    // cancelling in-flight lookups so the latest query always wins and the
    // inline state never lies — mirrors iOS `scheduleResolve`.
    LaunchedEffect(recipientQuery) {
        resolved = null
        resolveFailed = false
        val q = recipientQuery.trim()
        if (q.isEmpty()) {
            resolving = false
            return@LaunchedEffect
        }
        delay(400)
        resolving = true
        try {
            val r = ApiClient.api.resolveRecipient(q)
            resolved = r
            resolveFailed = false
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            resolved = null
            resolveFailed = true
        } finally {
            resolving = false
        }
    }

    // Spring the knob home after a failed start so the user can retry.
    LaunchedEffect(error) {
        if (error != null) {
            slideReset = true
            delay(80)
            slideReset = false
        }
    }

    if (started) {
        StartedView(
            totalUsd = totalUsd,
            recipient = resolved?.label ?: "recipient",
            numTranches = numTranches,
            onDone = onDone,
        )
        return
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        ) {
            // Back affordance + "My streams" — iOS relies on the sheet drag
            // indicator and a separate cover; keep both reachable here.
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 18.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(34.dp).background(TaliseColors.surface2, CircleShape).clickable { onDone() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = TaliseColors.fg,
                        modifier = Modifier.size(15.dp),
                    )
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "My streams",
                    style = TaliseType.body(12.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(TaliseColors.surface2)
                        .clickable { onShowList() }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }

            Column(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(top = 14.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                // ── Header ──
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Eyebrow("Stream a payment", color = TaliseColors.fgDim)
                    Text(
                        "Money over time",
                        style = TaliseType.heading(24.sp, FontWeight.Medium),
                        letterSpacing = (-0.8).sp,
                        color = TaliseColors.fg,
                    )
                    Text(
                        "Drip a salary, an allowance, a payout, no network fee, Talise sponsors the gas.",
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }

                // ── Recipient ──
                RecipientField(
                    query = recipientQuery,
                    onQueryChange = { recipientQuery = it },
                    resolving = resolving,
                    resolved = resolved,
                    resolveFailed = resolveFailed,
                )

                // ── Total ──
                AmountField(amountText = amountText, onAmountChange = { amountText = it })

                // ── Schedule ──
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface).padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    SchedulePicker("OVER", durationMin, DURATIONS) { durationMin = it }
                    SchedulePicker("EVERY", intervalMin, INTERVALS) { intervalMin = it }
                }

                // ── Status / preview ──
                if (validSchedule) {
                    PreviewCard(
                        numTranches = numTranches,
                        trancheUsd = trancheUsd,
                        totalUsd = totalUsd,
                        intervalLabel = intervalLabel,
                        durationLabel = durationLabel,
                    )
                } else {
                    StatusLine(
                        statusMessage(
                            recipientQuery = recipientQuery,
                            resolving = resolving,
                            resolved = resolved,
                            totalUsd = totalUsd,
                            trancheUsd = trancheUsd,
                            numTranches = numTranches,
                        ),
                    )
                }

                if (error != null) {
                    Text(error!!, style = TaliseType.body(12.sp), color = TaliseColors.danger)
                }

                Spacer(Modifier.height(90.dp))
            }
        }

        // ── Slide to start (bottom bar) ──
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(TaliseColors.bg.copy(alpha = 0f), TaliseColors.bg),
                    ),
                )
                .padding(horizontal = 22.dp).padding(top = 12.dp, bottom = 24.dp),
        ) {
            SlideToConfirm(
                title = if (starting) "Starting…" else "Slide to start streaming",
                enabled = validSchedule && !starting,
                tint = TaliseColors.greenMint,
                reset = slideReset,
                onConfirm = {
                    val to = resolved?.address ?: return@SlideToConfirm
                    vm.start(
                        to = to,
                        recipientHandle = resolved?.displayName,
                        totalUsd = totalUsd,
                        intervalMin = intervalMin,
                        numTranches = numTranches,
                    )
                },
            )
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
        Text("TO", style = TaliseType.mono(9.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
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
                resolving -> CircularProgressIndicator(
                    color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(16.dp),
                )
                resolved != null -> Icon(Icons.Filled.CheckCircle, null, tint = TaliseColors.accent, modifier = Modifier.size(18.dp))
                resolveFailed -> Icon(Icons.Filled.Cancel, null, tint = TaliseColors.danger, modifier = Modifier.size(18.dp))
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
        when {
            resolving -> Text("Looking up recipient…", style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
            resolved != null -> Text("Resolved: ${resolved.label}", style = TaliseType.mono(10.sp), color = TaliseColors.accent)
            resolveFailed -> Text(
                "Couldn't find that recipient. Check the @handle or address.",
                style = TaliseType.mono(10.sp), color = TaliseColors.danger,
            )
        }
    }
}

@Composable
private fun AmountField(amountText: String, onAmountChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text("TOTAL (USDsui)", style = TaliseType.mono(9.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("$", style = TaliseType.heading(18.sp), color = TaliseColors.fgMuted)
            BasicTextField(
                value = amountText,
                onValueChange = onAmountChange,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                textStyle = TaliseType.display(22.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    if (amountText.isEmpty()) {
                        Text("0.00", style = TaliseType.display(22.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                    }
                    inner()
                },
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
    }
}

@Composable
private fun SchedulePicker(
    label: String,
    value: Int,
    options: List<Pair<String, Int>>,
    onSelect: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = TaliseType.mono(9.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            options.forEach { (title, v) ->
                val on = value == v
                Text(
                    title,
                    style = TaliseType.body(13.sp, if (on) FontWeight.Medium else FontWeight.Light),
                    color = if (on) TaliseColors.inkOnGreen else TaliseColors.fg,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(if (on) TaliseColors.greenMint else TaliseColors.surface2)
                        .clickable { onSelect(v) }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }
}

/**
 * Always-visible block under the schedule — explains exactly why the stream
 * isn't startable, or previews the tranches when valid. The screen never
 * looks empty or dead.
 */
private fun statusMessage(
    recipientQuery: String,
    resolving: Boolean,
    resolved: RecipientResolution?,
    totalUsd: Double,
    trancheUsd: Double,
    numTranches: Int,
): String = when {
    recipientQuery.trim().isEmpty() -> "Enter a recipient, an @handle or a 0x address."
    resolving -> "Looking up that recipient…"
    resolved == null -> "Enter a recipient we can find before streaming."
    totalUsd <= 0 -> "Enter an amount to stream."
    trancheUsd < 0.01 ->
        "Each payment works out to ${streamUsd(trancheUsd)}, below the $0.01 minimum. Raise the total or stream less often."
    numTranches > 5000 -> "That's $numTranches payments, too many. Stream less often or over a shorter window."
    else -> "Set a recipient, amount and schedule to start."
}

@Composable
private fun StatusLine(text: String) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(TaliseColors.surface).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(Icons.Outlined.Info, null, tint = TaliseColors.fgMuted, modifier = Modifier.size(14.dp).padding(top = 2.dp))
        Text(text, style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted)
    }
}

@Composable
private fun PreviewCard(
    numTranches: Int,
    trancheUsd: Double,
    totalUsd: Double,
    intervalLabel: String,
    durationLabel: String,
) {
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
                "$numTranches payments of ${streamUsd2(trancheUsd)}",
                style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.fg,
            )
        }
        Text(
            "one every $intervalLabel, finishing in $durationLabel. First payment fires now.",
            style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.fgMuted,
        )
        Text(
            "${streamUsd2(totalUsd)} total, no network fee, Talise sponsors the gas.",
            style = TaliseType.mono(9.sp), color = TaliseColors.accent,
        )
    }
}

@Composable
private fun StartedView(
    totalUsd: Double,
    recipient: String,
    numTranches: Int,
    onDone: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(horizontal = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            Modifier.size(96.dp).clip(CircleShape).background(TaliseColors.accent.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(R.drawable.hi_stream),
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(52.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        Text("Streaming started", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fg)
        Spacer(Modifier.height(8.dp))
        Text(
            "${streamUsd2(totalUsd)} to $recipient · $numTranches payments",
            style = TaliseType.body(13.sp), color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 30.dp),
        )
        Spacer(Modifier.weight(1f))
        LiquidGlassButton(title = "Done", onClick = onDone, tint = TaliseColors.greenMint)
        Spacer(Modifier.height(24.dp))
    }
}

// MARK: - Active streams list (iOS StreamsListView)

@Composable
private fun StreamsListView(
    onDone: () -> Unit,
    vm: StreamsListViewModel = viewModel(),
) {
    val streams by vm.streams.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val cancellingId by vm.cancellingId.collectAsStateWithLifecycle()
    val claimingId by vm.claimingId.collectAsStateWithLifecycle()
    val cancelError by vm.cancelError.collectAsStateWithLifecycle()
    val claimedMark by vm.claimedMark.collectAsStateWithLifecycle()

    // Live cooldown: "Claim available" while a tranche is due, otherwise
    // "Next claim in Xs" — re-evaluated every second (iOS TimelineView).
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            nowMs = System.currentTimeMillis()
            delay(1000)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState()),
    ) {
        // Back affordance — iOS relies on the cover's drag dismissal.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 18.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(34.dp).background(TaliseColors.surface2, CircleShape).clickable { onDone() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = TaliseColors.fg,
                    modifier = Modifier.size(15.dp),
                )
            }
        }

        Column(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(top = 14.dp, bottom = 30.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Eyebrow("Your streams", color = TaliseColors.fgDim)
            when {
                loading -> Box(Modifier.fillMaxWidth().padding(top = 40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = TaliseColors.fg, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                }
                streams.isEmpty() -> Column(
                    Modifier.fillMaxWidth().padding(top = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text("No streams yet", style = TaliseType.body(14.sp), color = TaliseColors.fg)
                    Text("Start one to drip money over time.", style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
                }
                else -> streams.forEach { s ->
                    StreamRow(
                        s = s,
                        nowMs = nowMs,
                        claimedMark = claimedMark[s.id] ?: 0,
                        cancellingId = cancellingId,
                        claimingId = claimingId,
                        onCancel = { vm.cancel(s) },
                        onClaim = { vm.claim(s) },
                    )
                }
            }
            if (cancelError != null) {
                Text(cancelError!!, style = TaliseType.body(12.sp), color = TaliseColors.danger)
            }
        }
    }
}

@Composable
private fun StreamRow(
    s: StreamDTO,
    nowMs: Long,
    claimedMark: Int,
    cancellingId: String?,
    claimingId: String?,
    onCancel: () -> Unit,
    onClaim: () -> Unit,
) {
    val total = s.totalUsd ?: 0.0
    val released = s.releasedUsd ?: 0.0
    val progress = if (total > 0) minOf(1.0, released / total) else 0.0

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
                Text(
                    if (s.role == "recipient") "Streaming in" else "Streaming out",
                    style = TaliseType.mono(9.sp), letterSpacing = 1.sp, color = TaliseColors.fgDim,
                )
                Text(
                    s.recipientHandle ?: shortAddr(s.recipientAddress),
                    style = TaliseType.heading(15.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                s.state.replaceFirstChar { it.uppercase() },
                style = TaliseType.mono(9.sp),
                color = if (s.state == "active") TaliseColors.accent else TaliseColors.fgMuted,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(TaliseColors.surface2)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }

        // Progress bar.
        BoxWithConstraints(Modifier.fillMaxWidth().height(6.dp)) {
            Box(Modifier.fillMaxSize().clip(CircleShape).background(Color.White.copy(alpha = 0.06f)))
            Box(
                Modifier
                    .width(maxWidth * progress.toFloat())
                    .height(6.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.greenMint),
            )
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${streamUsd2(released)} of ${streamUsd2(total)}",
                style = TaliseType.mono(10.sp), color = TaliseColors.fgMuted,
            )
            Spacer(Modifier.weight(1f))
            Text(
                "${s.tranchesDone ?: 0}/${s.numTranches ?: 0} payments",
                style = TaliseType.mono(10.sp), color = TaliseColors.fgDim,
            )
        }

        // Recipient: pull the funds the Clock has accrued. Streaming is
        // CLOCK-BASED + cron-less — the claim transfers everything now due into
        // the recipient's wallet (Onara-sponsored, free). Idempotent.
        if (s.role == "recipient" && s.state == "active") {
            Box(Modifier.padding(top = 4.dp)) {
                ClaimControl(
                    s = s,
                    nowMs = nowMs,
                    claimed = claimedMark,
                    claimingId = claimingId,
                    onClaim = onClaim,
                )
            }
        }

        // Sender-only cancel on a live stream. Stops further releases and
        // returns the undistributed remainder to the sender.
        if (s.role != "recipient" && (s.state == "active" || s.state == "paused")) {
            LiquidGlassButton(
                title = if (cancellingId == s.id) "Cancelling…" else "Cancel & refund remainder",
                tint = null,
                loading = cancellingId == s.id,
                enabled = cancellingId == null,
                onClick = onCancel,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/** The Claim button / cooldown for one incoming stream, recomputed every second. */
@Composable
private fun ClaimControl(
    s: StreamDTO,
    nowMs: Long,
    claimed: Int,
    claimingId: String?,
    onClaim: () -> Unit,
) {
    val num = s.numTranches ?: 0
    val accrued = liveAccrued(s, nowMs)
    when {
        accrued > claimed -> {
            // A tranche is due now — claimable.
            LiquidGlassButton(
                title = if (claimingId == s.id) "Claiming…" else "Claim available",
                tint = TaliseColors.greenMint,
                loading = claimingId == s.id,
                enabled = claimingId == null,
                onClick = onClaim,
            )
        }
        claimed < num -> {
            // Nothing due yet — count down to the next tranche's clock time.
            val secs = maxOf(0, kotlin.math.ceil((nextDueMs(s, accrued) - nowMs) / 1000.0).toInt())
            LockedClaimButton("Next claim in ${countdownLabel(secs)}")
        }
        else -> LockedClaimButton("Fully streamed")
    }
}

@Composable
private fun LockedClaimButton(title: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(TaliseColors.surface2),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.Schedule,
            contentDescription = null,
            tint = TaliseColors.fgMuted,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            title,
            style = TaliseType.body(15.sp, FontWeight.Medium),
            color = TaliseColors.fgMuted,
        )
    }
}

private fun shortAddr(a: String?): String {
    if (a == null || a.length <= 10) return a ?: "-"
    return "${a.take(6)}…${a.takeLast(4)}"
}
