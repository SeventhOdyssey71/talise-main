package io.talise.app.feature.chat

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Feature-scoped Retrofit surface for the Talise Agent — mirrors what iOS
 * `AgentPlanAPI` / `AgentExecutor` call:
 *
 *   • POST /api/agent/plan             — validate + price a proposed intent
 *   • POST /api/earn/supply/prepare    — build a save (NAVI supply) tx kind
 *   • POST /api/earn/withdraw/prepare  — build a withdraw tx kind
 *   • POST /api/earn/withdraw-earned/prepare — build a claim-rewards tx kind
 *   • POST /api/zk/sponsor             — sponsor a tx kind → signable bytes
 *   • POST /api/zk/sponsor-execute     — assemble the zkLogin proof + broadcast
 *   • POST /api/agent/cashout/prepare  — create the Linq order + deposit wallet
 *   • POST /api/requests               — mint a shareable payment link
 *
 * The agent never auto-sends: it emits an intent (`AgentStep[]`), the client
 * posts it to /api/agent/plan, and the server returns a VALIDATED, priced
 * preview WITHOUT moving any money. "Agent proposes, server validates, human
 * confirms."
 */
interface AgentApi {
    @POST("api/agent/plan")
    suspend fun plan(@Body body: AgentPlanRequest): AgentPlanDTO

    @POST("api/earn/supply/prepare")
    suspend fun earnSupplyPrepare(@Body body: EarnSupplyBody): BuildKindResponse

    @POST("api/earn/withdraw/prepare")
    suspend fun earnWithdrawPrepare(@Body body: EarnWithdrawBody): BuildKindResponse

    @POST("api/earn/withdraw-earned/prepare")
    suspend fun earnWithdrawEarnedPrepare(@Body body: EarnClaimBody): BuildKindResponse

    @POST("api/zk/sponsor")
    suspend fun zkSponsor(@Body body: ZkSponsorRequest): ZkSponsorResponse

    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: SponsorExecuteRequest): SponsorExecuteResponse

    @POST("api/agent/cashout/prepare")
    suspend fun cashoutPrepare(@Body body: CashoutPrepareBody): CashoutPrepareResponse

    @POST("api/requests")
    suspend fun createRequest(@Body body: CreateRequestBody): CreateRequestResponse

    companion object {
        /** Shared instance over the app Retrofit stack (bearer + 401 handling). */
        val instance: AgentApi by lazy { ApiClient.create(AgentApi::class.java) }
    }
}

// ── Plan DTOs (mirror `AgentPlan` in web/lib/agent/plan.ts + iOS AgentPlanAPI) ──

@Serializable
data class AgentPlanRequest(val steps: List<AgentStep>)

/** A validated, priced preview of a proposed intent. Moves no money. */
@Serializable
data class AgentPlanDTO(
    /** True only if every step is ok/read_only and the cap check passes. */
    val confirmable: Boolean = false,
    val steps: List<PlannedStepDTO> = emptyList(),
    /** Total USD leaving the wallet across send steps (cap checked on this). */
    val totalSendUsd: Double = 0.0,
    /** Present when the send total would breach a tier cap. */
    val limit: PlanLimitDTO? = null,
    /** Short human summary for the confirm-card header. */
    val summary: String = "",
)

/**
 * One validated step. `status` drives the row treatment:
 *   • `ok`         — safe to confirm (write).
 *   • `read_only`  — run inline, no signature.
 *   • `blocked`    — a hard stop (own wallet, screen, over cap).
 *   • `needs_info` — a missing/invalid param (bad amount, unresolved handle).
 */
@Serializable
data class PlannedStepDTO(
    val kind: String = "",
    val label: String = "",
    val status: String = "",
    val detail: String? = null,
    /** Resolved recipient (send steps only) — what the executor sends to. */
    val resolved: ResolvedRecipientDTO? = null,
    /** USD this step moves out of the wallet (send/save/withdraw); 0 read-only. */
    val amountUsd: Double? = null,
) {
    val isOk: Boolean get() = status == "ok"
    val isReadOnly: Boolean get() = status == "read_only"
    val isBlocked: Boolean get() = status == "blocked" || status == "needs_info"
}

@Serializable
data class ResolvedRecipientDTO(
    val address: String = "",
    val displayName: String = "",
)

@Serializable
data class PlanLimitDTO(
    val window: String = "daily", // "daily" | "monthly"
    val limit: Double = 0.0,
    val used: Double = 0.0,
    val tier: Int = 0,
)

// ── Earn prepare bodies (mirror iOS AgentExecutor's inline Encodables) ──

@Serializable
data class EarnSupplyBody(val venue: String, val amount: Double)

@Serializable
data class EarnWithdrawBody(val venue: String, val amount: Double? = null)

@Serializable
data class EarnClaimBody(val venue: String)

/** Server-built tx kind, sponsored via /api/zk/sponsor before signing. */
@Serializable
data class BuildKindResponse(
    val transactionKindB64: String? = null,
    val error: String? = null,
)

// ── zk sponsor + execute (the Onara-sponsored rail iOS `signAndSubmit` uses) ──

@Serializable
data class ZkSponsorRequest(val transactionKindB64: String)

@Serializable
data class ZkSponsorResponse(
    val bytes: String? = null,
    val error: String? = null,
)

/** Rewards-accounting hint forwarded to sponsor-execute (iOS `RewardsMeta`). */
@Serializable
data class ExecuteMeta(
    val kind: String, // "send" | "invest" | "withdraw"
    val amountUsd: Double,
    val venue: String? = null,
)

@Serializable
data class SponsorExecuteRequest(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: ExecuteMeta? = null,
    /** Cached Shinami proof — skips the 2-4s mint when still valid. */
    val cachedProof: JsonObject? = null,
)

@Serializable
data class SponsorExecuteResponse(
    val digest: String? = null,
    val error: String? = null,
    /** Freshly minted proof to cache for the next submission. */
    val freshProof: JsonObject? = null,
)

// ── Cash-out (server creates the Linq order + deposit wallet) ──

@Serializable
data class CashoutPrepareBody(val amountUsd: Double)

@Serializable
data class CashoutPrepareResponse(
    val walletAddress: String = "",
    val amountUsdsui: Double = 0.0,
    val amountNgn: Double? = null,
    val bankLast4: String? = null,
    val error: String? = null,
)

// ── Payment link (request rail — no signing, no money moves) ──

@Serializable
data class CreateRequestBody(
    val amountUsd: Double,
    val requesterNote: String? = null,
)

@Serializable
data class CreateRequestResponse(
    val payUrl: String? = null,
    val error: String? = null,
)
