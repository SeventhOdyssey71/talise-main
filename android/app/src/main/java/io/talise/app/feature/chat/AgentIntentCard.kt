package io.talise.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.util.Locale

/**
 * Renders a parsed Talise Agent intent beneath the assistant's message — the
 * Android port of iOS `AgentIntentCard`.
 *
 *   • Read-only intents (balance / yield / activity) auto-run inline on
 *     appear and show their results — no confirm, no signing.
 *   • Write intents call `POST /api/agent/plan` to validate + price, render a
 *     per-step preview, and gate execution behind simple Accept / Decline
 *     buttons — enabled only when the server says the plan is `confirmable`.
 *
 * "Agent proposes, server validates, human confirms."
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentIntentCard(
    intent: AgentIntent,
    executed: List<AgentActionResult>? = null,
    /**
     * Runs the validated plan on a scope that survives this composable
     * ([ChatViewModel.executeIntent]) — the card can scroll out of the
     * LazyColumn mid-transfer, and money movement must not die with it.
     */
    executePlan: (AgentPlanDTO, AgentIntent, onResult: (List<AgentActionResult>?, String?) -> Unit) -> Unit,
) {
    var stage by remember { mutableStateOf(Stage.Loading) }
    var plan by remember { mutableStateOf<AgentPlanDTO?>(null) }
    var resultLines by remember { mutableStateOf<List<String>>(emptyList()) }
    var actionResults by remember { mutableStateOf<List<AgentActionResult>>(emptyList()) }
    var receiptFor by remember { mutableStateOf<AgentActionResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        // Already ran in a prior session — open straight to the receipt and
        // never re-fetch a plan or re-prompt for a transfer that's done.
        if (!executed.isNullOrEmpty()) {
            actionResults = executed
            stage = Stage.Done
            return@LaunchedEffect
        }
        if (intent.isReadOnlyOnly) {
            try {
                resultLines = AgentExecutor.runReadOnly(intent.steps)
                stage = Stage.ReadOnly
            } catch (t: Throwable) {
                error = t.message ?: "Couldn't load that right now."
                stage = Stage.Failed
            }
        } else {
            try {
                plan = AgentApi.instance.plan(AgentPlanRequest(steps = intent.steps))
                stage = Stage.Plan
            } catch (t: Throwable) {
                error = t.message ?: "Couldn't check that plan right now."
                // Surface as a one-line failed plan card.
                plan = AgentPlanDTO(confirmable = false, steps = emptyList(), totalSendUsd = 0.0, limit = null, summary = "Couldn't check this plan.")
                stage = Stage.Failed
            }
        }
    }

    fun decline() {
        if (stage == Stage.Running) return
        error = null
        stage = Stage.Declined
    }

    fun confirm() {
        val p = plan ?: return
        if (stage == Stage.Running) return
        stage = Stage.Running
        error = null
        // Persisting the outcome on the transcript happens inside the runner
        // (ChatViewModel), so a reopen shows the receipt even if this card is
        // gone by the time the transfer completes.
        executePlan(p, intent) { results, failure ->
            if (results != null) {
                actionResults = results
                stage = Stage.Done
            } else {
                error = failure ?: "Couldn't complete that. Please try again."
                // Keep the plan visible so the user can tap Accept to retry.
                stage = Stage.Plan
            }
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .rampCard()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (stage) {
            Stage.Loading -> LoadingRow(intent)
            Stage.ReadOnly -> ReadOnlyBody(resultLines)
            Stage.Plan, Stage.Running, Stage.Failed -> PlanBody(
                plan = plan,
                error = error,
                running = stage == Stage.Running,
                onDecline = { decline() },
                onConfirm = { confirm() },
            )
            Stage.Done -> DoneBody(actionResults, onReceipt = { receiptFor = it })
            Stage.Declined -> Text(
                "Okay, I didn't run that. Tell me what to change.",
                style = TaliseType.body(14.sp),
                color = TaliseColors.fgMuted,
            )
        }
    }

    receiptFor?.let { r ->
        ModalBottomSheet(
            onDismissRequest = { receiptFor = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = TaliseColors.bg,
        ) {
            AgentReceiptSheet(
                amountUsd = r.amountUsd ?: 0.0,
                recipient = r.recipient.orEmpty(),
                digest = r.digest.orEmpty(),
                title = receiptTitle(r.kind),
            )
        }
    }
}

private enum class Stage { Loading, Plan, Running, Done, ReadOnly, Failed, Declined }

@Composable
private fun LoadingRow(intent: AgentIntent) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CircularProgressIndicator(
            modifier = Modifier.size(14.dp),
            color = TaliseColors.fgDim,
            strokeWidth = 1.5.dp,
        )
        Text(
            if (intent.isReadOnlyOnly) "Looking that up…" else "Checking this plan…",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
    }
}

@Composable
private fun ReadOnlyBody(resultLines: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        resultLines.forEach { line ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier
                        .padding(top = 6.dp)
                        .size(5.dp)
                        .background(TaliseColors.fgDim, CircleShape),
                )
                Text(line, style = TaliseType.body(14.sp), color = TaliseColors.fg)
            }
        }
        if (resultLines.isEmpty()) {
            Text("Nothing to show.", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
    }
}

@Composable
private fun PlanBody(
    plan: AgentPlanDTO?,
    error: String?,
    running: Boolean,
    onDecline: () -> Unit,
    onConfirm: () -> Unit,
) {
    if (plan == null) {
        // A failed read-only run lands here with no plan — show the honest error.
        if (error != null) {
            Text(error, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Summary header
        Text(plan.summary, style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.fg)

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            plan.steps.forEach { step -> StepRow(step) }
        }

        plan.limit?.let { limit ->
            val window = limit.window.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
            Text(
                "$window limit ${AgentExecutor.usd2(limit.limit)} · used ${AgentExecutor.usd2(limit.used)}.",
                style = TaliseType.mono(10.sp, FontWeight.Light).copy(letterSpacing = 0.2.sp),
                color = TaliseColors.fgDim,
            )
        }

        if (error != null) {
            Text(error, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
        }

        if (plan.confirmable) {
            ConfirmButtons(plan, running = running, onDecline = onDecline, onConfirm = onConfirm)
            GaslessNote()
        }
    }
}

/**
 * Accept / Decline — simple buttons. Accept runs the validated plan; Decline
 * dismisses it without moving money.
 */
@Composable
private fun ConfirmButtons(
    plan: AgentPlanDTO,
    running: Boolean,
    onDecline: () -> Unit,
    onConfirm: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(top = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .weight(1f)
                .height(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(TaliseColors.surface2)
                .clickable(enabled = !running) { onDecline() },
            contentAlignment = Alignment.Center,
        ) {
            Text("Decline", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = TaliseColors.fgMuted)
        }

        Box(
            Modifier
                .weight(1f)
                .height(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(TaliseColors.greenMint)
                .alpha(if (running) 0.7f else 1f)
                .clickable(enabled = !running) { onConfirm() },
            contentAlignment = Alignment.Center,
        ) {
            if (running) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        color = TaliseColors.bg,
                        strokeWidth = 1.5.dp,
                    )
                    Text("Working…", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = TaliseColors.bg)
                }
            } else {
                val title = if (plan.totalSendUsd > 0) "Accept · ${AgentExecutor.usd2(plan.totalSendUsd)}" else "Accept"
                Text(title, style = TaliseType.body(15.sp, FontWeight.SemiBold), color = TaliseColors.bg)
            }
        }
    }
}

@Composable
private fun StepRow(step: PlannedStepDTO) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            step.isBlocked -> Icon(
                Icons.Filled.Warning, contentDescription = null,
                tint = TaliseColors.danger, modifier = Modifier.padding(top = 1.dp).size(15.dp),
            )
            step.isReadOnly -> Icon(
                Icons.Outlined.Visibility, contentDescription = null,
                tint = TaliseColors.fgDim, modifier = Modifier.padding(top = 2.dp).size(14.dp),
            )
            else -> Icon(
                Icons.Filled.CheckCircle, contentDescription = null,
                tint = TaliseColors.greenMint, modifier = Modifier.padding(top = 1.dp).size(15.dp),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                step.label,
                style = TaliseType.body(14.sp),
                color = if (step.isReadOnly) TaliseColors.fgMuted else TaliseColors.fg,
            )
            val detail = step.detail
            if (!detail.isNullOrEmpty()) {
                Text(
                    detail,
                    style = TaliseType.body(12.sp, FontWeight.Light),
                    color = if (step.isBlocked) TaliseColors.danger else TaliseColors.fgDim,
                )
            }
        }
    }
}

@Composable
private fun GaslessNote() {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Bolt, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(12.dp))
        Spacer(Modifier.width(7.dp))
        Text(
            "No network fee. Talise sponsors the gas.",
            style = TaliseType.mono(10.sp, FontWeight.Light).copy(letterSpacing = 0.2.sp),
            color = TaliseColors.fgDim,
        )
    }
}

@Composable
private fun DoneBody(actionResults: List<AgentActionResult>, onReceipt: (AgentActionResult) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.Verified, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(18.dp))
            Text("Done", style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.fg)
        }
        actionResults.forEach { r ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(r.line, style = TaliseType.body(14.sp), color = TaliseColors.fgMuted)
                // A confirmed on-chain money step gets a "Share receipt" chip.
                if (r.digest != null && (r.amountUsd ?: 0.0) > 0) {
                    ResultChip(icon = Icons.Filled.Share, label = "Share receipt") { onReceipt(r) }
                }
                // A payment-link (request) step gets a "Share link" chip.
                r.link?.let { link ->
                    ResultChip(icon = Icons.Filled.Link, label = "Share link") {
                        val share = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(android.content.Intent.EXTRA_TEXT, link)
                        }
                        context.startActivity(android.content.Intent.createChooser(share, "Share link"))
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultChip(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.greenMint)
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon(icon, contentDescription = null, tint = TaliseColors.bg, modifier = Modifier.size(14.dp))
        Text(label, style = TaliseType.body(13.sp, FontWeight.SemiBold), color = TaliseColors.bg)
    }
}

private fun receiptTitle(kind: String): String = when (kind) {
    "send" -> "Sent"
    "save" -> "Saved"
    "withdraw" -> "Withdrew"
    "claim_rewards" -> "Claimed"
    else -> "Done"
}
