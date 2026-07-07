package io.talise.app.feature.rewards

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Percent
import androidx.compose.material.icons.filled.Spa
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.core.net.ApiClient
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException

/** Redemption catalogue data — mirrors iOS `RedemptionsSection`'s `@State`. */
class RedemptionsViewModel : ViewModel() {

    data class State(
        val items: List<RedeemSKU> = emptyList(),
        val loading: Boolean = false,
        val error: String? = null,
        val redeemingSku: String? = null,
        val lastRedeemError: String? = null,
        /** Bumps after each successful redeem so the parent can refetch. */
        val redeemedTick: Int = 0,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        loadCatalogue()
    }

    fun loadCatalogue() {
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            runCatching { rewardsApi.catalogue() }
                .onSuccess { _state.value = _state.value.copy(items = it.items, loading = false, error = null) }
                .onFailure { t -> _state.value = _state.value.copy(loading = false, error = t.message) }
        }
    }

    fun redeem(sku: RedeemSKU, onRedeemed: () -> Unit, onDone: () -> Unit) {
        _state.value = _state.value.copy(redeemingSku = sku.sku, lastRedeemError = null)
        viewModelScope.launch {
            try {
                rewardsApi.redeem(RedeemRequest(sku = sku.sku))
                _state.value = _state.value.copy(redeemingSku = null, redeemedTick = _state.value.redeemedTick + 1)
                onDone()
                // Refresh both the local catalogue (canAfford flips on remaining
                // cards) and the parent summary via onRedeemed.
                loadCatalogue()
                onRedeemed()
            } catch (e: HttpException) {
                _state.value = _state.value.copy(
                    redeemingSku = null,
                    lastRedeemError = parseErrorMessage(e) ?: "Couldn't redeem. Try again.",
                )
            } catch (t: Throwable) {
                _state.value = _state.value.copy(redeemingSku = null, lastRedeemError = t.message)
            }
        }
    }

    /** Pull the friendly `error` field out of the server's JSON body. */
    private fun parseErrorMessage(e: HttpException): String? {
        val body = runCatching { e.response()?.errorBody()?.string() }.getOrNull() ?: return null
        return runCatching {
            ApiClient.json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
        }.getOrNull() ?: body
    }
}

/**
 * Phase 4 — Redemption catalogue, iOS `RedemptionsSection`. Grouped list of
 * perks the user can spend points on: kind-styled badge, label, one-line
 * description, and a trailing "X pts" pill (tappable when affordable) or a
 * dim "X pts" hint when locked. Tap → confirm sheet → redeem → parent refetch.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RedemptionsSection(
    pointsTotal: Int,
    onRedeemed: () -> Unit,
    vm: RedemptionsViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var confirming by remember { mutableStateOf<RedeemSKU?>(null) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader("Redeem points", trailing = {
            if (state.loading) {
                CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 1.5.dp, modifier = Modifier.size(12.dp))
            }
        })

        when {
            state.loading && state.items.isEmpty() -> RedemptionsSkeletonCard()
            state.items.isEmpty() && state.error == null -> RedemptionsEmptyState(null)
            state.items.isEmpty() -> RedemptionsEmptyState(state.error)
            else -> {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .earnHeroGlass(20.dp)
                        .padding(horizontal = 18.dp),
                ) {
                    state.items.forEachIndexed { index, item ->
                        RedeemRow(
                            item = item,
                            pointsTotal = pointsTotal,
                            redeeming = state.redeemingSku == item.sku,
                            onTapRedeem = { confirming = item },
                        )
                        if (index < state.items.size - 1) RowDivider()
                    }
                }
            }
        }

        state.lastRedeemError?.let { err ->
            Text(
                err,
                style = TaliseType.mono(11.sp, FontWeight.Light),
                color = TaliseColors.danger,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }

    confirming?.let { sku ->
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
        ModalBottomSheet(
            onDismissRequest = { confirming = null },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
        ) {
            ConfirmRedemptionSheet(
                sku = sku,
                pointsTotal = pointsTotal,
                redeeming = state.redeemingSku == sku.sku,
                onConfirm = { vm.redeem(sku, onRedeemed = onRedeemed, onDone = { confirming = null }) },
                onCancel = { confirming = null },
            )
        }
    }
}

// ── Rows ─────────────────────────────────────────────────────────────────────

@Composable
private fun RedeemRow(
    item: RedeemSKU,
    pointsTotal: Int,
    redeeming: Boolean,
    onTapRedeem: () -> Unit,
) {
    val affordable = item.canAfford || item.pointsCost <= pointsTotal
    val needed = (item.pointsCost - pointsTotal).coerceAtLeast(0)
    RewardsListRow(
        icon = skuIcon(item.icon),
        kind = if (affordable) RewardsBadgeKind.Earn else RewardsBadgeKind.Locked,
        title = item.label,
        subtitle = item.description,
        modifier = Modifier.alpha(if (affordable) 1.0f else 0.55f),
        trailing = {
            if (affordable) {
                GlassPill(
                    title = if (redeeming) "…" else "${item.pointsCost} pts",
                    onClick = onTapRedeem,
                    tint = TaliseColors.accent,
                    compact = true,
                )
            } else {
                // Non-interactive dim text — not a fake button.
                Text(
                    "$needed pts",
                    style = TaliseType.mono(11.sp),
                    color = TaliseColors.fgDim,
                )
            }
        },
    )
}

// ── Loading skeleton / empty state ───────────────────────────────────────────

@Composable
private fun RedemptionsSkeletonCard() {
    Column(
        Modifier
            .fillMaxWidth()
            .earnHeroGlass(20.dp)
            .alpha(0.6f)
            .padding(horizontal = 18.dp),
    ) {
        repeat(2) { index ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 60.dp)
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(Modifier.size(36.dp).background(TaliseColors.surface2, CircleShape))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SkeletonCapsule(width = 80.dp, height = 10.dp)
                    SkeletonCapsule(width = 50.dp, height = 8.dp)
                }
                Spacer(Modifier.weight(1f))
            }
            if (index < 1) RowDivider()
        }
    }
}

@Composable
private fun RedemptionsEmptyState(error: String?) {
    Column(
        Modifier
            .fillMaxWidth()
            .earnHeroGlass(20.dp)
            .padding(horizontal = 16.dp, vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            error ?: "No perks available right now",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
        )
        Text(
            "Earn points by sending and saving. Perks unlock as you go.",
            style = TaliseType.mono(10.sp),
            color = TaliseColors.fgDim,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

// ── Confirm sheet ────────────────────────────────────────────────────────────

@Composable
private fun ConfirmRedemptionSheet(
    sku: RedeemSKU,
    pointsTotal: Int,
    redeeming: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "CONFIRM REDEMPTION",
                style = TaliseType.mono(10.sp),
                letterSpacing = 2.0.sp,
                color = TaliseColors.fgMuted,
            )
            Text(
                sku.label,
                style = TaliseType.heading(22.sp, FontWeight.Medium),
                letterSpacing = (-0.8).sp,
                color = TaliseColors.fg,
            )
            Text(
                sku.description,
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        Column(
            Modifier
                .fillMaxWidth()
                .earnHeroGlass(20.dp)
                .padding(horizontal = 18.dp),
        ) {
            RewardsListRow(
                icon = skuIcon(sku.icon),
                kind = RewardsBadgeKind.Earn,
                title = "Cost",
                trailing = {
                    Text(
                        "${sku.pointsCost} pts",
                        style = TaliseType.body(14.sp, FontWeight.Light),
                        letterSpacing = (-0.56).sp,
                        color = TaliseColors.accent,
                    )
                },
            )
            RowDivider()
            RewardsListRow(
                icon = Icons.Filled.CreditCard,
                kind = RewardsBadgeKind.Neutral,
                title = "Balance after",
                trailing = {
                    Text(
                        "${(pointsTotal - sku.pointsCost).coerceAtLeast(0)} pts",
                        style = TaliseType.body(14.sp, FontWeight.Light),
                        letterSpacing = (-0.56).sp,
                        color = TaliseColors.fg,
                    )
                },
            )
        }

        LiquidGlassButton(
            title = if (redeeming) "Redeeming…" else "Confirm redemption",
            onClick = onConfirm,
            tint = TaliseColors.accent,
            loading = redeeming,
            enabled = !redeeming,
        )

        Text(
            "Cancel",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onCancel() }
                .height(36.dp)
                .padding(top = 8.dp),
        )
        Spacer(Modifier.height(12.dp))
    }
}

/** Map the server's SF-symbol icon slugs to Material glyphs. */
private fun skuIcon(name: String?): ImageVector = when (name) {
    "gift" -> Icons.Filled.CardGiftcard
    "creditcard" -> Icons.Filled.CreditCard
    "bolt", "bolt.fill" -> Icons.Filled.Bolt
    "percent" -> Icons.Filled.Percent
    "star", "star.fill" -> Icons.Filled.Star
    "sparkles" -> Icons.Filled.AutoAwesome
    "leaf", "leaf.fill" -> Icons.Filled.Spa
    else -> Icons.Filled.CardGiftcard
}
