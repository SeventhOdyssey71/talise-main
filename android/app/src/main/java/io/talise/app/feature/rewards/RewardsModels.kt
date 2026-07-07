package io.talise.app.feature.rewards

import kotlinx.serialization.Serializable

/**
 * Rewards DTOs — ported 1:1 from iOS `APIModels.swift` (RewardsSummary +
 * Phase 3 Savings Goals / Insights + Phase 4 Redemption catalogue + the
 * on-chain GoalVault bodies). Feature-scoped: only the rewards surface
 * consumes these shapes.
 */

@Serializable
data class RewardsSummary(
    val code: String? = null,
    val pointsTotal: Int = 0,
    val referralCount: Int = 0,
    val recentEvents: List<RewardsEvent> = emptyList(),
    /** Tier (Bronze/Silver/Gold/Platinum). Null for old server builds. */
    val tier: RewardsTier? = null,
    /** Lifetime tally — what the user has sent / saved through Talise, USD. */
    val lifetimeSentUsd: Double? = null,
    val lifetimeSavedUsd: Double? = null,
    /** Round-up & Save toggle state. Drives the Roundup card. */
    val roundup: RoundupConfig? = null,
    /** Lifetime amount auto-swept via round-up (USD). */
    val roundupSavedUsd: Double? = null,
    val pointRates: PointRates? = null,
)

@Serializable
data class RewardsTier(
    val id: String,          // "bronze" | "silver" | "gold" | "plat"
    val label: String,
    val pointsToNext: Int? = null, // null at top tier
    val nextLabel: String? = null,
)

@Serializable
data class RoundupConfig(
    val enabled: Boolean,
    val percentage: Int,     // 1-10
)

@Serializable
data class PointRates(
    val send: Int,
    val invest: Int,
    val withdraw: Int,
    val roundup: Int,
    val goal: Int,
)

@Serializable
data class RewardsEvent(
    val id: String,
    val kind: String,
    val points: Int,
    val createdAt: String,
)

// ── Phase 3: Savings Goals + Insights ───────────────────────────────────────

/** One savings goal (named bucket). USD figures, localized by the caller. */
@Serializable
data class SavingsGoal(
    val id: String,
    val name: String,
    val targetUsd: Double,
    val currentUsd: Double,
    /** Optional epoch-ms deadline. Drives the "23 days left" countdown. */
    val deadlineMs: Double? = null,
    /** Optional accent hex (e.g. "#2DC07A"). Null → TaliseColors.accent. */
    val color: String? = null,
    val createdAtMs: Double = 0.0,
    val archived: Boolean = false,
    /** Server-derived "reached target" flag; falls back to local math. */
    val completed: Boolean? = null,
    /** On-chain GoalVault object id once vault-backed. Null until the first
     *  real deposit creates the vault. */
    val vaultObjectId: String? = null,
    /** True when the goal's funds are earning NAVI yield. */
    val yieldOn: Boolean? = null,
) {
    /** 0…1 fill ratio for the progress ring. Caps at 1 on overshoot. */
    val progress: Double
        get() = if (targetUsd > 0) (currentUsd / targetUsd).coerceIn(0.0, 1.0) else 0.0

    /** Whether this goal has hit its target — drives the Completed section. */
    val isComplete: Boolean
        get() = completed ?: (targetUsd > 0 && currentUsd >= targetUsd)

    /** "23 days left" / "Past due" / null if no deadline. */
    val deadlineLabel: String?
        get() {
            val deadline = deadlineMs ?: return null
            val now = System.currentTimeMillis().toDouble()
            val diffDays = ((deadline - now) / (1000.0 * 60 * 60 * 24)).toInt()
            return when {
                diffDays < 0 -> "Past due"
                diffDays == 0 -> "Due today"
                diffDays == 1 -> "1 day left"
                else -> "$diffDays days left"
            }
        }
}

/** Wrapper for GET /api/rewards/goals. */
@Serializable
data class SavingsGoalsResponse(val goals: List<SavingsGoal> = emptyList())

/** POST body for /api/rewards/goals (create). */
@Serializable
data class SavingsGoalCreateRequest(
    val name: String,
    val targetUsd: Double,
    val deadlineMs: Double? = null,
    val color: String? = null,
)

/** PATCH body for /api/rewards/goals/[id] (update / archive). */
@Serializable
data class SavingsGoalUpdateRequest(
    val name: String? = null,
    val targetUsd: Double? = null,
    val deadlineMs: Double? = null,
    val color: String? = null,
    val archive: Boolean? = null,
)

/** POST body for /api/rewards/goals/[id] (tracking deposit or withdrawal). */
@Serializable
data class GoalDepositRequest(
    val amountUsd: Double,
    val action: String? = null,
)

/** Response from a goal mutation (create / patch / deposit). */
@Serializable
data class SavingsGoalMutationResponse(
    val goal: SavingsGoal? = null,
    val pointsAwarded: Int? = null,
)

/** Body for POST /api/goals/vault/confirm — records an on-chain GoalVault op
 *  (create | deposit | withdraw) AFTER its sponsored tx has landed. */
@Serializable
data class GoalVaultConfirmBody(
    val goalId: String,
    val op: String,
    val amountUsd: Double,
    val digest: String,
)

@Serializable
data class GoalVaultConfirmResponse(
    val goal: SavingsGoal? = null,
    val vaultObjectId: String? = null,
)

/** Body for POST /api/goals/vault/prepare — the server builds the sponsored
 *  PTB and returns signable bytes (mirrors iOS `signAndSubmitGoalVault`). */
@Serializable
data class GoalVaultPrepareRequest(
    val op: String,
    val goalId: String,
    val amountUsd: Double,
    val name: String? = null,
    val targetUsd: Double? = null,
)

@Serializable
data class GoalVaultPrepareResponse(
    val bytes: String? = null,
    val error: String? = null,
    val code: String? = null,
)

/** Body for POST /api/zk/sponsor-execute (Onara-sponsored rail). Android has
 *  no local proof cache — the server mints the proof from its stored JWT+salt. */
@Serializable
data class SponsorExecuteRequest(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
)

@Serializable
data class SponsorExecuteResponse(
    val digest: String? = null,
    val error: String? = null,
    val code: String? = null,
)

/** One row in the "top counterparties this month" strip. */
@Serializable
data class InsightsCounterparty(
    val address: String,
    val name: String? = null,
    val count: Int,
    val totalUsd: Double,
) {
    /** "jude" / `0xab12…cdef` fallback for raw addresses. */
    val displayName: String
        get() {
            if (!name.isNullOrEmpty()) return name
            if (address.length <= 14) return address
            return address.take(8) + "…" + address.takeLast(6)
        }
}

/** Month-to-date insights derived from the server's activity feed. */
@Serializable
data class MonthInsights(
    val spentUsd: Double = 0.0,
    val receivedUsd: Double = 0.0,
    val savedUsd: Double = 0.0,
    val monthStartMs: Double = 0.0,
    val sampleSize: Int = 0,
    val topCounterparties: List<InsightsCounterparty> = emptyList(),
)

// ── Phase 4: Redemption catalogue ───────────────────────────────────────────

@Serializable
data class RedeemSKU(
    val sku: String,
    val label: String,
    val description: String,
    val pointsCost: Int,
    /** "instant" | "flagged" | "pending" */
    val kind: String = "instant",
    val icon: String? = null,
    /** null when the SKU has no tier gate. */
    val minTier: String? = null,
    val stackable: Boolean? = null,
    val durationMs: Double? = null,
    /** Server-computed: does the user's current pointsTotal cover this? */
    val canAfford: Boolean = false,
)

@Serializable
data class RedemptionsCatalogue(
    val pointsTotal: Int = 0,
    val items: List<RedeemSKU> = emptyList(),
)

@Serializable
data class RedemptionResponse(
    val ok: Boolean = false,
    val pointsTotal: Int = 0,
    val redemption: RedemptionRow? = null,
)

@Serializable
data class RedemptionRow(
    val id: String,
    val sku: String,
    val pointsSpent: Int,
    val status: String,
    val createdAt: String,
    val fulfilledAt: String? = null,
)

@Serializable
data class RedeemRequest(val sku: String)

// ── Round-up & Save ─────────────────────────────────────────────────────────

/** POST body for /api/rewards/roundup — either field may be omitted. */
@Serializable
data class RoundupUpdateRequest(
    val enabled: Boolean? = null,
    val percentage: Int? = null,
)

@Serializable
data class RoundupUpdateResponse(
    val enabled: Boolean,
    val percentage: Int,
    val savedUsd: Double = 0.0,
)
