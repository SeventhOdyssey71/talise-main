package io.talise.app.feature.rewards

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Spa
import androidx.compose.material.icons.outlined.Spa as SpaOutlined
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.HeroAmount
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Phase 3 — Savings Goals, iOS `GoalsSection`.
 *
 * Horizontal carousel of named savings buckets plus a dashed "+ New goal"
 * tile. Tap a card → action sheet (deposit / withdraw / earn toggle /
 * archive); completed goals move into their own row below.
 *
 * Public so the Invest screen (where iOS mounts it) can embed it:
 * `io.talise.app.feature.rewards.GoalsSection()`.
 */
@Composable
fun GoalsSection(vm: GoalsViewModel = viewModel()) {
    val list by vm.list.collectAsStateWithLifecycle()

    var selected by remember { mutableStateOf<SavingsGoal?>(null) }
    var showingNewGoal by remember { mutableStateOf(false) }

    val activeGoals = list.goals.filter { !it.isComplete }
    val completedGoals = list.goals.filter { it.isComplete }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader("Savings goals")
        Row(
            Modifier
                .fillMaxWidth()
                .height(148.dp)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (list.loading && list.goals.isEmpty()) {
                GoalCardSkeleton()
                GoalCardSkeleton()
            } else {
                activeGoals.forEach { goal ->
                    GoalCard(goal, onTap = {
                        vm.openSheet(goal)
                        selected = goal
                    })
                }
            }
            NewGoalTile(onTap = { showingNewGoal = true })
        }

        // Completed goals leave the active row and live here.
        if (completedGoals.isNotEmpty()) {
            SectionHeader("Completed")
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(148.dp)
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                completedGoals.forEach { goal ->
                    GoalCard(
                        goal,
                        onTap = {
                            vm.openSheet(goal)
                            selected = goal
                        },
                        modifier = Modifier.alpha(0.7f),
                    )
                }
            }
        }

        if (!list.error.isNullOrEmpty()) {
            Text(
                list.error ?: "",
                style = TaliseType.mono(10.sp, FontWeight.Light),
                color = TaliseColors.danger,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }

    selected?.let { goal ->
        GoalActionSheet(
            goal = goal,
            vm = vm,
            onDismiss = {
                selected = null
                vm.load()
            },
        )
    }

    if (showingNewGoal) {
        NewGoalScreen(
            vm = vm,
            onDismiss = {
                showingNewGoal = false
                vm.resetCreate()
                vm.load()
            },
        )
    }
}

// ── Goal card ────────────────────────────────────────────────────────────────

@Composable
private fun GoalCard(goal: SavingsGoal, onTap: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier
            .width(168.dp)
            .height(148.dp)
            .earnHeroGlass(20.dp)
            .clickable { onTap() }
            .padding(18.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    goal.name,
                    style = TaliseType.heading(15.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    maxLines = 1,
                )
                goal.deadlineLabel?.let { label ->
                    Text(
                        label,
                        style = TaliseType.mono(10.sp),
                        letterSpacing = (-0.32).sp,
                        color = TaliseColors.fgDim,
                    )
                }
            }
            ProgressRing(progress = goal.progress, modifier = Modifier.size(36.dp))
        }

        Spacer(Modifier.weight(1f))

        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                local2(goal.currentUsd),
                style = TaliseType.heading(18.sp, FontWeight.Medium),
                letterSpacing = (-0.5).sp,
                color = TaliseColors.fg,
                maxLines = 1,
            )
            Text(
                "of ${local2(goal.targetUsd)}",
                style = TaliseType.mono(10.sp),
                letterSpacing = (-0.32).sp,
                color = TaliseColors.fgDim,
                maxLines = 1,
            )
        }
    }
}

/** Goal progress ring — honest math, no fake floor (iOS `ProgressRing`). */
@Composable
private fun ProgressRing(progress: Double, modifier: Modifier = Modifier) {
    val clamped = progress.coerceIn(0.0, 1.0).toFloat()
    Box(modifier, contentAlignment = Alignment.Center) {
        androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
            val stroke = 4.dp.toPx()
            val inset = stroke / 2f
            drawCircle(
                color = Color.White.copy(alpha = 0.08f),
                radius = (size.minDimension - stroke) / 2f,
                style = Stroke(width = stroke),
            )
            drawArc(
                color = Color(0xFF79D96C),
                startAngle = -90f,
                sweepAngle = 360f * clamped,
                useCenter = false,
                topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
                size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke),
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
        Text(
            "${(clamped * 100).toInt()}%",
            style = TaliseType.mono(9.sp),
            color = TaliseColors.accent,
        )
    }
}

/** Loading placeholder shaped exactly like a `GoalCard` (iOS `GoalCardSkeleton`). */
@Composable
private fun GoalCardSkeleton() {
    Column(
        Modifier
            .width(168.dp)
            .height(148.dp)
            .earnHeroGlass(20.dp)
            .alpha(0.6f)
            .padding(18.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            SkeletonCapsule(width = 80.dp, height = 10.dp)
            Spacer(Modifier.weight(1f))
            Box(Modifier.size(36.dp).background(TaliseColors.surface2, CircleShape))
        }
        Spacer(Modifier.weight(1f))
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SkeletonCapsule(width = 70.dp, height = 12.dp)
            SkeletonCapsule(width = 50.dp, height = 8.dp)
        }
    }
}

/** Dashed "+ New goal" tile at the end of the carousel (iOS `NewGoalTile`). */
@Composable
private fun NewGoalTile(onTap: () -> Unit) {
    val accent = TaliseColors.accent
    Column(
        Modifier
            .width(168.dp)
            .height(148.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.bg)
            .drawBehind {
                drawRoundRect(
                    color = accent.copy(alpha = 0.35f),
                    cornerRadius = CornerRadius(20.dp.toPx()),
                    style = Stroke(
                        width = 1.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
                    ),
                )
            }
            .clickable { onTap() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(36.dp).background(TaliseColors.surface2, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(14.dp))
        }
        Spacer(Modifier.height(10.dp))
        Text("New goal", style = TaliseType.heading(13.sp, FontWeight.Medium), color = TaliseColors.fg)
        Spacer(Modifier.height(10.dp))
        Text(
            "Name a bucket",
            style = TaliseType.mono(10.sp),
            letterSpacing = (-0.32).sp,
            color = TaliseColors.fgDim,
            textAlign = TextAlign.Center,
        )
    }
}

// ── Action sheet (deposit / withdraw / earn / archive) ───────────────────────

private enum class GoalMode { Add, Withdraw }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GoalActionSheet(
    goal: SavingsGoal,
    vm: GoalsViewModel,
    onDismiss: () -> Unit,
) {
    val sheet by vm.sheet.collectAsStateWithLifecycle()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var depositText by remember(goal.id) { mutableStateOf("") }
    var mode by remember(goal.id) { mutableStateOf(GoalMode.Add) }

    val cleaned = depositText.replace(",", ".")
    val amount = cleaned.toDoubleOrNull() ?: 0.0
    val canDeposit = amount > 0

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = TaliseColors.bg,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(top = 4.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            // Inline nav bar — goal name centered, Done trailing (iOS toolbar).
            Box(Modifier.fillMaxWidth()) {
                Text(
                    goal.name,
                    style = TaliseType.heading(17.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                    maxLines = 1,
                    modifier = Modifier.align(Alignment.Center),
                )
                Text(
                    "Done",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    color = TaliseColors.accent,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .clickable { onDismiss() },
                )
            }

            // Summary — saved so far + honest progress.
            Column(
                Modifier
                    .fillMaxWidth()
                    .earnHeroGlass(24.dp)
                    .padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                HeroAmount(
                    eyebrow = "Saved so far",
                    value = local2(goal.currentUsd),
                    caption = "of ${local2(goal.targetUsd)} target",
                    captionAccent = false,
                )
                QuietProgressBar(progress = goal.progress)
                val pts = sheet.lastPointsAwarded
                if (pts != null && pts > 0) {
                    Text(
                        "+$pts points earned",
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.accent,
                    )
                }
            }

            // Add / Withdraw.
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionHeader(if (mode == GoalMode.Add) "Add to goal" else "Withdraw from goal")
                Column(
                    Modifier
                        .fillMaxWidth()
                        .earnHeroGlass(20.dp)
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    // Segmented toggle — pick the action, one field below.
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(TaliseColors.fg.copy(alpha = 0.06f), RoundedCornerShape(16.dp))
                            .padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        ModeTab("Add money", selected = mode == GoalMode.Add, modifier = Modifier.weight(1f)) { mode = GoalMode.Add }
                        ModeTab("Withdraw", selected = mode == GoalMode.Withdraw, modifier = Modifier.weight(1f)) { mode = GoalMode.Withdraw }
                    }

                    // Amount field.
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .earnFieldGlass()
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            "$",
                            style = TaliseType.heading(28.sp, FontWeight.Medium),
                            color = TaliseColors.fgDim,
                        )
                        BasicTextField(
                            value = depositText,
                            onValueChange = { new -> depositText = new.filter { it.isDigit() || it == '.' || it == ',' } },
                            textStyle = TaliseType.heading(28.sp, FontWeight.Medium).copy(
                                color = TaliseColors.fg,
                                letterSpacing = (-0.8).sp,
                            ),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                            cursorBrush = SolidColor(TaliseColors.accent),
                            modifier = Modifier.weight(1f),
                            decorationBox = { inner ->
                                Box {
                                    if (depositText.isEmpty()) {
                                        Text(
                                            "0.00",
                                            style = TaliseType.heading(28.sp, FontWeight.Medium),
                                            letterSpacing = (-0.8).sp,
                                            color = TaliseColors.fgDim,
                                        )
                                    }
                                    inner()
                                }
                            },
                        )
                    }

                    Text(
                        if (mode == GoalMode.Add) {
                            "Tracking only. Funds stay in your earning balance and keep earning points + yield."
                        } else {
                            "Moves tracked savings back to your spendable balance."
                        },
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )

                    LiquidGlassButton(
                        title = when {
                            sheet.busy && mode == GoalMode.Add -> "Adding…"
                            sheet.busy -> "Withdrawing…"
                            mode == GoalMode.Add -> "Add to goal"
                            else -> "Withdraw"
                        },
                        onClick = {
                            if (mode == GoalMode.Add) vm.deposit(goal, amount) else vm.withdraw(goal, amount)
                        },
                        tint = TaliseColors.accent,
                        loading = sheet.busy,
                        enabled = !sheet.busy && canDeposit,
                    )
                }
            }

            // Earn / stop-earning toggle — only for vault-backed goals.
            if (goal.vaultObjectId != null) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .earnHeroGlass(16.dp)
                        .alpha(if (sheet.busy || goal.currentUsd <= 0) 0.6f else 1f)
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        if (sheet.earnOn) Icons.Filled.Spa else Icons.Outlined.SpaOutlined,
                        contentDescription = null,
                        tint = if (sheet.earnOn) TaliseColors.accent else TaliseColors.fgDim,
                        modifier = Modifier.size(20.dp),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            if (sheet.earnOn) "Earning yield" else "Earn yield on this goal",
                            style = TaliseType.body(15.sp, FontWeight.Medium),
                            color = TaliseColors.fg,
                        )
                        Text(
                            "Your savings grow · withdraw anytime",
                            style = TaliseType.body(12.sp, FontWeight.Light),
                            color = TaliseColors.fgDim,
                        )
                    }
                    if (sheet.busy) {
                        CircularProgressIndicator(color = TaliseColors.accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                    } else {
                        Switch(
                            checked = sheet.earnOn,
                            onCheckedChange = { want ->
                                if (want != sheet.earnOn) vm.toggleYield(goal, want)
                            },
                            enabled = !sheet.busy && goal.currentUsd > 0,
                            colors = SwitchDefaults.colors(
                                checkedTrackColor = TaliseColors.accent,
                                checkedThumbColor = Color.White,
                            ),
                        )
                    }
                }
            }

            // Archive.
            Text(
                "Archive goal",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.danger,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !sheet.busy) { vm.archive(goal) { onDismiss() } }
                    .padding(vertical = 10.dp),
            )

            sheet.error?.let { error ->
                Text(
                    error,
                    style = TaliseType.body(12.sp, FontWeight.Light),
                    color = TaliseColors.danger,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }

    // Full-screen success covers — deposit and withdraw share the target hero.
    sheet.depositDone?.let { amountText ->
        Dialog(
            onDismissRequest = {
                vm.clearDepositDone()
                onDismiss()
            },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            GoalSuccessView(
                amountText = amountText,
                goalName = goal.name,
                onDismiss = {
                    vm.clearDepositDone()
                    onDismiss()
                },
            )
        }
    }
    sheet.withdrawDone?.let { amountText ->
        Dialog(
            onDismissRequest = {
                vm.clearWithdrawDone()
                onDismiss()
            },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            GoalSuccessView(
                kind = GoalSuccessKind.Withdraw,
                amountText = amountText,
                goalName = goal.name,
                onDismiss = {
                    vm.clearWithdrawDone()
                    onDismiss()
                },
            )
        }
    }
}

@Composable
private fun ModeTab(title: String, selected: Boolean, modifier: Modifier = Modifier, onTap: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) TaliseColors.accent else Color.Transparent, RoundedCornerShape(12.dp))
            .clickable { onTap() }
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            style = TaliseType.body(15.sp, FontWeight.Medium),
            color = if (selected) Color.Black.copy(alpha = 0.85f) else TaliseColors.fgMuted,
        )
    }
}

// ── New goal screen (full page) ──────────────────────────────────────────────

/**
 * Full-screen "New savings goal" page — iOS `NewGoalScreen` (presented via
 * `.fullScreenCover`). Custom header + centered hero, the two fields, and a
 * pinned primary action.
 */
@Composable
private fun NewGoalScreen(vm: GoalsViewModel, onDismiss: () -> Unit) {
    val create by vm.create.collectAsStateWithLifecycle()

    var name by remember { mutableStateOf("") }
    var targetText by remember { mutableStateOf("") }
    val nameFocus = remember { FocusRequester() }

    val cleaned = targetText.replace(",", ".")
    val target = cleaned.toDoubleOrNull() ?: 0.0
    val canCreate = name.trim().isNotEmpty() && target > 0

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(TaliseColors.bg),
        ) {
            // Header — X in a glass circle, centered micro label.
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(TaliseColors.surface2, CircleShape)
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Close, contentDescription = null, tint = TaliseColors.fgMuted, modifier = Modifier.size(15.dp))
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "New goal",
                    style = TaliseType.mono(10.sp),
                    letterSpacing = 2.0.sp,
                    color = TaliseColors.fgMuted,
                )
                Spacer(Modifier.weight(1f))
                Spacer(Modifier.size(38.dp))
            }

            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp)
                    .padding(top = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                // Hero.
                Column(
                    Modifier.padding(top = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Box(
                        Modifier.size(68.dp).background(TaliseColors.accent.copy(alpha = 0.14f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Flag, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(26.dp))
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "Name a savings bucket",
                            style = TaliseType.heading(22.sp, FontWeight.Medium),
                            letterSpacing = (-0.6).sp,
                            color = TaliseColors.fg,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            "Set a target and watch it fill up.",
                            style = TaliseType.body(14.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                            textAlign = TextAlign.Center,
                        )
                    }
                }

                // Fields.
                Column(
                    Modifier
                        .fillMaxWidth()
                        .earnHeroGlass(22.dp)
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    GoalField(
                        value = name,
                        onValueChange = { name = it },
                        placeholder = "Goal name (e.g. Laptop fund)",
                        modifier = Modifier.focusRequester(nameFocus),
                    )
                    GoalField(
                        value = targetText,
                        onValueChange = { new -> targetText = new.filter { it.isDigit() || it == '.' || it == ',' } },
                        placeholder = "Target amount (USD)",
                        decimal = true,
                    )
                }

                Text(
                    "Tracking only. Your money stays in your earning balance and keeps earning yield + points toward the target.",
                    style = TaliseType.body(12.sp, FontWeight.Light),
                    color = TaliseColors.fgDim,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )

                create.error?.let { error ->
                    Text(
                        error,
                        style = TaliseType.body(12.sp, FontWeight.Light),
                        color = TaliseColors.danger,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            LiquidGlassButton(
                title = if (create.busy) "Creating…" else "Create goal",
                onClick = { vm.createGoal(name, target) { onDismiss() } },
                tint = TaliseColors.accent,
                loading = create.busy,
                enabled = !create.busy && canCreate,
                modifier = Modifier
                    .padding(horizontal = 22.dp)
                    .padding(bottom = 18.dp),
            )

            LaunchedEffect(Unit) { runCatching { nameFocus.requestFocus() } }
        }
    }
}

@Composable
private fun GoalField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    decimal: Boolean = false,
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = TaliseType.body(15.sp, FontWeight.Light).copy(
            color = TaliseColors.fg,
            letterSpacing = (-0.48).sp,
        ),
        keyboardOptions = if (decimal) KeyboardOptions(keyboardType = KeyboardType.Decimal) else KeyboardOptions.Default,
        singleLine = true,
        cursorBrush = SolidColor(TaliseColors.accent),
        modifier = modifier
            .fillMaxWidth()
            .earnFieldGlass()
            .padding(16.dp),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        placeholder,
                        style = TaliseType.body(15.sp, FontWeight.Light),
                        letterSpacing = (-0.48).sp,
                        color = TaliseColors.fgDim,
                    )
                }
                inner()
            }
        },
    )
}
