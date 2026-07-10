package io.talise.app.feature.earn

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.HeroAmount
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.LiquidGlassPill
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * The combined Add money / Withdraw sheet — a pixel port of iOS
 * `EarnManageSheet`. Opens when the user taps the Earn row. A segmented
 * control switches between:
 *   • Add money — amount field + a one-year earnings projection, gated behind
 *     the one-time opt-in disclosure on the FIRST supply.
 *   • Withdraw  — partial amount, MAX shortcut, and "Claim rewards".
 * Deposit POSTs /api/earn/supply/prepare; withdraw POSTs
 * /api/earn/withdraw/prepare — both → sponsor → local zkLogin sign → execute.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun EarnManageSheet(
    venue: EarnVenueDTO,
    bestApy: Double,
    vm: EarnViewModel,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    val depositing by vm.depositing.collectAsStateWithLifecycle()
    val withdrawing by vm.withdrawing.collectAsStateWithLifecycle()
    val error by vm.sheetError.collectAsStateWithLifecycle()
    val success by vm.sheetSuccess.collectAsStateWithLifecycle()
    val withdrawDone by vm.withdrawDone.collectAsStateWithLifecycle()
    val vmResetTick by vm.slideResetTick.collectAsStateWithLifecycle()

    var mode by remember { mutableStateOf(ManageMode.Add) }
    var depositText by remember { mutableStateOf("") }
    var partial by remember { mutableStateOf("") }
    var showDisclosure by remember { mutableStateOf(false) }
    var localResetTick by remember { mutableIntStateOf(0) }
    var slideReset by remember { mutableStateOf(false) }

    // On-chain position in USDsui (1:1 USD).
    val supplied = venue.supplied ?: 0.0
    val apy = venue.apy
    val earnedSoFar = venue.earned
    val earningSinceMs = venue.earningSinceMs?.takeIf { it > 0 }
    val dailyEarning = venue.earningPerDay ?: (supplied * apy / 365.0)
    val projectedYear = supplied * apy

    // Plural "money word" — Android renders USD, so "dollars" (iOS localizes
    // via CurrencySettings).
    val moneyWord = "dollars"

    // Typed deposit amount (USD; USDsui is 1:1). Single source of truth for
    // the projection, the button label, and the /supply/prepare body.
    val depositUsd = depositText.toDoubleOrNull()?.takeIf { it > 0 } ?: 0.0
    val canDeposit = depositUsd > 0 && !depositing
    val depositLabel = if (depositUsd > 0) "Add ${earnUsd2(depositUsd)}" else "Start earning"
    val depositAnnual: Double? = if (depositUsd > 0 && apy > 0) depositUsd * apy else null

    // User-typed partial-withdraw amount. Tiny epsilon so a MAX tap whose
    // round-trip gains a sub-cent rounding doesn't get rejected.
    val partialUsd = partial.toDoubleOrNull()?.takeIf { it > 0 } ?: 0.0
    val canWithdrawPartial = partialUsd > 0 && partialUsd <= supplied + 0.0001 && !withdrawing

    // "Withdraw earned" gates: venue exposes `earned`, above the dust floor,
    // no withdraw in flight.
    val canWithdrawEarned = (earnedSoFar ?: 0.0) >= WITHDRAW_EARNED_DUST_USD && !withdrawing
    val claimRewardsTitle = if (canWithdrawEarned && earnedSoFar != null) {
        "Claim ${earnUsd2(earnedSoFar)} rewards"
    } else {
        "Claim rewards"
    }

    // Live "Earned so far" — ticks every second off the earning streak start.
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            nowMs = System.currentTimeMillis()
            delay(1000)
        }
    }
    // Live accrued yield = principal × APY × (elapsed this streak / year),
    // falling back to the server snapshot. Clamped at the principal.
    fun liveEarned(now: Long): Double {
        val since = earningSinceMs
        if (since == null || apy <= 0 || supplied <= 0) return earnedSoFar ?: 0.0
        val yearMs = 365.0 * 24 * 60 * 60 * 1000
        val elapsed = (now - since).coerceAtLeast(0.0)
        return minOf(supplied, supplied * apy * (elapsed / yearMs))
    }

    // Give the user a beat to see the withdraw success banner, then close
    // (iOS sleeps 1.2s → dismiss).
    LaunchedEffect(withdrawDone) {
        if (withdrawDone) {
            delay(1200)
            onDismiss()
        }
    }

    // Spring the slide-to-complete knob home after a failed / disclosure-gated
    // attempt.
    val resetTick = vmResetTick + localResetTick
    LaunchedEffect(resetTick) {
        if (resetTick > 0) {
            slideReset = true
            delay(80)
            slideReset = false
        }
    }

    Column(Modifier.fillMaxWidth().animateContentSize()) {
        Column(
            Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(top = 24.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            // ── Header: the one hero figure per sheet ──
            if (mode == ManageMode.Add && supplied <= 0) {
                // First deposit: lead with the rate you'll earn.
                Column(Modifier.fillMaxWidth().earnHeroGlass().padding(22.dp)) {
                    HeroAmount(
                        eyebrow = "Earn rate",
                        value = "%.2f%%".format(apy * 100),
                        caption = "On your $moneyWord · withdraw anytime",
                    )
                }
            } else {
                // Existing position: show what they hold / have earned.
                val heroUsd = earnedSoFar ?: supplied
                Column(Modifier.fillMaxWidth().earnHeroGlass().padding(22.dp)) {
                    HeroAmount(
                        eyebrow = if (earnedSoFar != null) "Your earnings" else "Your position",
                        value = "%,.2f".format(heroUsd),
                        symbol = "$",
                        caption = if (earnedSoFar != null) {
                            "Earnings accrued on ${earnUsd2(supplied)}"
                        } else {
                            "Supplied and earning"
                        },
                    )
                }
            }

            // Segmented Add / Withdraw — only when there's a position to
            // withdraw. Idle venues open straight into Add money.
            if (supplied > 0) {
                ModePicker(mode = mode, onSelect = { mode = it })
                PositionCard(
                    supplied = supplied,
                    apy = apy,
                    earnedSoFar = earnedSoFar,
                    earningSinceMs = earningSinceMs,
                    liveEarned = liveEarned(nowMs),
                    projectedYear = projectedYear,
                    dailyEarning = dailyEarning,
                )
            }

            if (mode == ManageMode.Add || supplied <= 0) {
                AddField(
                    depositText = depositText,
                    onChange = { depositText = it },
                    depositAnnual = depositAnnual,
                )
            } else {
                PartialField(
                    partial = partial,
                    onChange = { partial = it },
                    supplied = supplied,
                    // Locale.US: default-locale format on comma-decimal locales yields
                    // "12,34", which toDoubleOrNull() rejects, bricking the MAX path.
                    onMax = { partial = String.format(java.util.Locale.US, "%.2f", supplied) },
                )
            }

            error?.let {
                Text(it, style = TaliseType.body(12.sp, FontWeight.Light), color = TaliseColors.danger)
            }
            success?.let { SuccessBanner(digest = it, added = mode == ManageMode.Add || supplied <= 0) }

            Spacer(Modifier.height(16.dp))
        }

        // ── Pinned bottom action bar ──
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 22.dp)
                .padding(top = 12.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (mode == ManageMode.Add || supplied <= 0) {
                // Slide to complete — the slide IS the intent gesture (same
                // trust model as Send); zkLogin still signs the tx underneath.
                if (canDeposit) {
                    SlideToConfirm(
                        title = "Slide to start earning",
                        tint = TaliseColors.accent,
                        reset = slideReset,
                        onConfirm = {
                            if (hasAcceptedEarnDisclosure(context)) {
                                vm.deposit(venue.venue, depositUsd)
                            } else {
                                // First supply: surface the one-time disclosure
                                // and spring the knob back — accepting runs the
                                // deposit.
                                showDisclosure = true
                                localResetTick += 1
                            }
                        },
                    )
                } else {
                    LiquidGlassButton(
                        title = if (depositing) "Adding…" else depositLabel,
                        tint = TaliseColors.accent,
                        loading = depositing,
                        enabled = false,
                        onClick = {},
                    )
                }
            } else {
                // ONE primary CTA (the partial withdraw); the claim-rewards
                // shortcut sits beneath, same size, quieter.
                LiquidGlassButton(
                    title = when {
                        withdrawing -> "Working…"
                        partial.isEmpty() -> "Withdraw"
                        else -> "Withdraw \$$partial"
                    },
                    tint = TaliseColors.accent,
                    loading = withdrawing,
                    enabled = canWithdrawPartial,
                    onClick = { vm.withdraw(venue.venue, partialUsd, supplied) },
                )
                // Claim ONLY the yield rewards — the server computes the exact
                // earned USDsui at request time, so principal is never touched.
                LiquidGlassButton(
                    title = claimRewardsTitle,
                    tint = null,
                    enabled = !withdrawing && canWithdrawEarned,
                    onClick = { vm.withdrawEarned(venue.venue, earnedSoFar ?: 0.0) },
                )
            }
        }
    }

    // One-time opt-in disclosure before the FIRST deposit — presented from
    // inside this sheet so, on accept, the supply continues in context. The
    // supply NEVER runs without this explicit acceptance.
    if (showDisclosure) {
        ModalBottomSheet(
            onDismissRequest = { showDisclosure = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = TaliseColors.bg,
        ) {
            EarnDisclosureSheet(
                apy = bestApy,
                moneyWord = moneyWord,
                onAccept = {
                    markEarnDisclosureAccepted(context)
                    showDisclosure = false
                    vm.deposit(venue.venue, depositUsd)
                },
                onCancel = { showDisclosure = false },
            )
        }
    }
}

private enum class ManageMode { Add, Withdraw }

/** USD floor for showing "Claim rewards" — below this the value is dust. */
private const val WITHDRAW_EARNED_DUST_USD = 0.01

// ── Pieces ──────────────────────────────────────────────────────────────────

@Composable
private fun ModePicker(mode: ManageMode, onSelect: (ManageMode) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(TaliseColors.surface2)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        SegmentButton("Add money", selected = mode == ManageMode.Add, modifier = Modifier.weight(1f)) {
            onSelect(ManageMode.Add)
        }
        SegmentButton("Withdraw", selected = mode == ManageMode.Withdraw, modifier = Modifier.weight(1f)) {
            onSelect(ManageMode.Withdraw)
        }
    }
}

@Composable
private fun SegmentButton(
    title: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(38.dp)
            .clip(RoundedCornerShape(10.dp))
            // Selected pill: FLAT solid accent fill, no specular.
            .background(if (selected) TaliseColors.accent else TaliseColors.surface2)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = if (selected) TaliseColors.bg else TaliseColors.fgMuted,
        )
    }
}

/** Add-money amount field + a one-year earnings projection. */
@Composable
private fun AddField(
    depositText: String,
    onChange: (String) -> Unit,
    depositAnnual: Double?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Eyebrow("Add to earnings", modifier = Modifier.padding(horizontal = 4.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .earnFieldGlass()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "$",
                style = TaliseType.heading(22.sp, FontWeight.Medium),
                color = TaliseColors.fgDim,
            )
            BasicTextField(
                value = depositText,
                onValueChange = onChange,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                textStyle = TaliseType.heading(22.sp, FontWeight.Medium)
                    .copy(color = TaliseColors.fg, letterSpacing = (-0.6).sp),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    if (depositText.isEmpty()) {
                        Text(
                            "0.00",
                            style = TaliseType.heading(22.sp, FontWeight.Medium),
                            color = TaliseColors.fgDim,
                        )
                    }
                    inner()
                },
            )
            Text("USD", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
        }
        if (depositAnnual != null) {
            ProjectionBand(depositAnnual)
        }
    }
}

/** "You'll earn a year" band — year is the hero, day/month sit beneath. */
@Composable
private fun ProjectionBand(annual: Double) {
    Column(
        Modifier
            .fillMaxWidth()
            .earnHeroGlass(radius = 16.dp)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "ESTIMATED EARNINGS / YEAR",
            style = TaliseType.mono(10.sp),
            letterSpacing = 2.0.sp,
            color = TaliseColors.fgMuted,
        )
        Text(
            earnUsd(annual),
            style = TaliseType.heading(18.sp, FontWeight.Medium),
            letterSpacing = (-0.6).sp,
            color = TaliseColors.accent,
            maxLines = 1,
        )
        Text(
            "${earnUsd(annual / 365.0)} a day · ${earnUsd(annual / 12.0)} a month",
            style = TaliseType.mono(11.sp),
            letterSpacing = (-0.32).sp,
            color = TaliseColors.fgDim,
            maxLines = 1,
        )
    }
}

/** The position breakdown card — Deposited / Earned so far (live) / projections / APY. */
@Composable
private fun PositionCard(
    supplied: Double,
    apy: Double,
    earnedSoFar: Double?,
    earningSinceMs: Double?,
    liveEarned: Double,
    projectedYear: Double,
    dailyEarning: Double,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .earnHeroGlass(radius = 20.dp)
            .padding(horizontal = 20.dp, vertical = 4.dp),
    ) {
        // Principal — what the user has deposited.
        PositionRow(label = "Deposited", value = earnUsd2(supplied))

        // Earned so far — LIVE, ticking every second so the user watches it
        // grow. Honest + churn-proof (the streak resets on a full withdrawal).
        if (earnedSoFar != null || earningSinceMs != null) {
            EarnRowDivider(inset = 18.dp)
            PositionRow(label = "Earned so far", value = earnUsd(liveEarned), accent = true)
        }

        // Forward projection — what you'd earn in a year at this rate.
        if (supplied > 0 && apy > 0) {
            EarnRowDivider(inset = 18.dp)
            PositionRow(label = "At this rate · 1 year", value = earnUsd2(projectedYear))
            EarnRowDivider(inset = 18.dp)
            PositionRow(label = "Per day", value = earnUsd(dailyEarning))
        }

        EarnRowDivider(inset = 18.dp)
        PositionRow(label = "APY", value = "%.2f%%".format(apy * 100), accent = true)
    }
}

@Composable
private fun PositionRow(label: String, value: String, accent: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = TaliseType.body(14.sp, FontWeight.Light),
            letterSpacing = (-0.48).sp,
            color = TaliseColors.fgMuted,
        )
        Spacer(Modifier.weight(1f))
        Text(
            value,
            style = TaliseType.body(14.sp, FontWeight.Light),
            letterSpacing = (-0.56).sp,
            color = if (accent) TaliseColors.accent else TaliseColors.fg,
            maxLines = 1,
        )
    }
}

/** Withdraw amount field with the Available line + MAX shortcut. */
@Composable
private fun PartialField(
    partial: String,
    onChange: (String) -> Unit,
    supplied: Double,
    onMax: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Eyebrow("Withdraw amount", modifier = Modifier.padding(horizontal = 4.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .earnFieldGlass()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "$",
                    style = TaliseType.heading(22.sp, FontWeight.Medium),
                    color = TaliseColors.fgDim,
                )
                BasicTextField(
                    value = partial,
                    onValueChange = onChange,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TaliseType.heading(22.sp, FontWeight.Medium)
                        .copy(color = TaliseColors.fg, letterSpacing = (-0.6).sp),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (partial.isEmpty()) {
                            Text(
                                "0.00",
                                style = TaliseType.heading(22.sp, FontWeight.Medium),
                                color = TaliseColors.fgDim,
                            )
                        }
                        inner()
                    },
                )
                Text("USD", style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                MicroLabel("Available ${earnUsd2(supplied)}", color = TaliseColors.fgDim)
                Spacer(Modifier.weight(1f))
                LiquidGlassPill(title = "MAX", tint = TaliseColors.accent, onClick = onMax)
            }
        }
    }
}

@Composable
private fun SuccessBanner(digest: String, added: Boolean) {
    Row(
        Modifier
            .fillMaxWidth()
            .earnHeroGlass(radius = 20.dp)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(36.dp).background(TaliseColors.accent.copy(alpha = 0.18f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(14.dp),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (added) "Added to earnings" else "Withdrawn",
                style = TaliseType.body(14.sp, FontWeight.Light),
                letterSpacing = (-0.48).sp,
                color = TaliseColors.fg,
            )
            Text(
                digest.take(20) + "…",
                style = TaliseType.mono(11.sp),
                letterSpacing = (-0.32).sp,
                color = TaliseColors.fgDim,
            )
        }
    }
}

// ── Earn FLAT surface kit (iOS EarnHeroGlass / EarnFieldGlass / RowDivider) ──

/**
 * FLAT hero plate for the one big figure per screen — a solid `surface` panel,
 * no material, no tint wash, no specular edge (iOS `.earnHeroGlass`).
 */
internal fun Modifier.earnHeroGlass(radius: Dp = 24.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this.clip(shape).background(TaliseColors.surface, shape)
}

/**
 * FLAT input-field chrome for amount fields — a solid raised `surface2` fill
 * (iOS `.earnFieldGlass`).
 */
internal fun Modifier.earnFieldGlass(radius: Dp = 16.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this.clip(shape).background(TaliseColors.surface2, shape)
}

/** Hairline row divider — iOS `RowDivider(inset:)`. */
@Composable
internal fun EarnRowDivider(inset: Dp = 0.dp) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = inset)
            .height(1.dp)
            .background(TaliseColors.line),
    )
}
