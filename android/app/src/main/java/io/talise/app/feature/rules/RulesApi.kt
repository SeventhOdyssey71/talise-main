package io.talise.app.feature.rules

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Programmable money — "rules" that run themselves, NON-CUSTODIALLY. Ported
 * 1:1 from iOS `RulesAPI.swift`. A rule pairs a TRIGGER (a schedule: an
 * interval in minutes OR a day-of-month) with an ACTION (v1: `send` a fixed
 * amount to a recipient on that schedule — "pay rent on the 1st").
 *
 * Each rule is backed by an on-chain `standing_order` object the user owns:
 * the pot is funded up front and the recipient + amount are baked on chain.
 * `execute_due` is PERMISSIONLESS; there is NO cron and NO scheduler key: the
 * app triggers any DUE rules when it opens (executePrepare → sign →
 * recordExecuted). Cancelling refunds the entire remaining pot.
 *
 *   • GET    /api/rules            → { rules:[…], enabled }
 *   • POST   /api/rules            → PREPARE: sponsor-ready create bytes
 *   • POST   /api/rules/record     → activate with the signed funding digest
 *   • POST   /api/rules/{id}/cancel→ owner-signed cancel bytes (refund pot)
 *   • DELETE /api/rules/{id}       → clear the row (after a signed cancel)
 *   • POST   /api/rules/{id}/pause / /resume
 *   • POST   /api/rules/{id}/execute / /executed
 *
 * Feature-gated server-side: GET returns `{ rules: [], enabled: false }` and
 * POST 503s until the automations engine is configured.
 */

// MARK: - DTOs

/** The send action's stored config. `amountMicros` is a BigInt-as-string (6dp micros). */
@Serializable
data class RuleActionConfig(
    val toAddress: String? = null,
    val toHandle: String? = null,
    val amountMicros: String? = null,
) {
    /** The payout amount in USD, parsed from the micro string. */
    val amountUsd: Double?
        get() = amountMicros?.toDoubleOrNull()?.let { it / 1_000_000.0 }
}

/** Mirrors `MoneyRule` from web/lib/money-rules.ts (and iOS `RuleDTO`). */
@Serializable
data class RuleDTO(
    val id: String,
    val name: String,
    val triggerType: String,
    val intervalMinutes: Int? = null,
    val dayOfMonth: Int? = null,
    val actionType: String,
    val actionConfig: RuleActionConfig? = null,
    val state: String,
    val nextDueAt: Double? = null,
    val executionCount: Int? = null,
    val lastRunAt: Double? = null,
    val lastStatus: String? = null,
    val lastError: String? = null,
    val createdAt: Double? = null,
) {
    val isActive: Boolean get() = state == "active"
    val isPaused: Boolean get() = state == "paused"

    /** The payout amount this rule sends each run (from the send action). */
    val amountUsd: Double get() = actionConfig?.amountUsd ?: 0.0

    /** Who this rule pays — the resolved handle if known, else a short address. */
    val recipientLabel: String
        get() {
            val h = actionConfig?.toHandle
            if (!h.isNullOrEmpty()) return h
            val a = actionConfig?.toAddress
            if (!a.isNullOrEmpty()) {
                return if (a.length > 14) a.take(8) + "…" + a.takeLast(4) else a
            }
            return "recipient"
        }

    /** A human cadence line: "Every day", "Every 7 days", "On the 1st". */
    val cadenceLine: String
        get() {
            val dom = dayOfMonth
            if (dom != null && dom >= 1) return "On the ${ruleOrdinal(dom)} of each month"
            val m = intervalMinutes
            if (m == null || m <= 0) return "On a schedule"
            return when (m) {
                1 -> "Every minute"
                60 -> "Every hour"
                1440 -> "Every day"
                10080 -> "Every week"
                else -> when {
                    m % 1440 == 0 -> "Every ${m / 1440} days"
                    m % 60 == 0 -> "Every ${m / 60} hours"
                    else -> "Every $m minutes"
                }
            }
        }
}

internal fun ruleOrdinal(n: Int): String {
    val suffix = when {
        n % 100 in 11..13 -> "th"
        n % 10 == 1 -> "st"
        n % 10 == 2 -> "nd"
        n % 10 == 3 -> "rd"
        else -> "th"
    }
    return "$n$suffix"
}

@Serializable
data class RulesListResponse(
    val rules: List<RuleDTO> = emptyList(),
    /** True when automations are configured + live server-side. */
    val enabled: Boolean = false,
)

/**
 * The DB/ledger mirror echoed by prepare; the client signs the bytes then
 * posts this (plus the digest + firstDueMs) to `/api/rules/record`. The
 * on-chain object is the source of truth for recipient + amount.
 */
@Serializable
data class RuleRecord(
    val name: String,
    val trigger: String,
    val intervalMinutes: Int? = null,
    val dayOfMonth: Int? = null,
    val toAddress: String,
    val toHandle: String? = null,
    val amountUsd: Double,
)

/** PREPARE response: sponsor-ready `standing_order::create` bytes to sign. */
@Serializable
data class RulePrepareResponse(
    val mode: String? = null,
    val bytes: String,
    val firstDueMs: Double,
    val record: RuleRecord,
)

/** CANCEL response: the owner-signed `cancel` bytes (refunds the pot). */
@Serializable
data class RuleCancelResponse(
    val mode: String? = null,
    val bytes: String,
)

/** EXECUTE response: the sponsor-ready, permissionless `execute_due` bytes to sign. */
@Serializable
data class RuleExecuteResponse(
    val mode: String? = null,
    val bytes: String,
)

// MARK: - Request / response wrappers

@Serializable
data class RulePrepareBody(
    val name: String,
    val trigger: String,
    val action: String,
    val intervalMinutes: Int? = null,
    val dayOfMonth: Int? = null,
    val toRecipient: String,
    val amountUsd: Double,
    val prefundUsd: Double,
)

@Serializable
data class RuleRecordBody(
    val digest: String,
    val firstDueMs: Double,
    val name: String,
    val trigger: String,
    val intervalMinutes: Int? = null,
    val dayOfMonth: Int? = null,
    val toAddress: String,
    val toHandle: String? = null,
    val amountUsd: Double,
)

@Serializable
data class RuleExecutedBody(val digest: String)

@Serializable
data class RuleResponse(val rule: RuleDTO)

@Serializable
class RuleEmptyBody

@Serializable
data class RuleOkResponse(val ok: Boolean? = null)

interface RulesApi {
    /** List the caller's money rules. `enabled` is false when gated off server-side. */
    @GET("api/rules")
    suspend fun list(): RulesListResponse

    /** STEP 1 — PREPARE a scheduled-send rule (returns bytes to sign + record). */
    @POST("api/rules")
    suspend fun prepareCreate(@Body body: RulePrepareBody): RulePrepareResponse

    /** STEP 2 — activate the rule with the signed funding digest. */
    @POST("api/rules/record")
    suspend fun recordCreate(@Body body: RuleRecordBody): RuleResponse

    /** Build the owner-signed `cancel` bytes (stops + refunds the remaining pot). */
    @POST("api/rules/{id}/cancel")
    suspend fun cancelPrepare(@Path("id") id: String, @Body body: RuleEmptyBody = RuleEmptyBody()): RuleCancelResponse

    @POST("api/rules/{id}/pause")
    suspend fun pause(@Path("id") id: String, @Body body: RuleEmptyBody = RuleEmptyBody()): RuleResponse

    @POST("api/rules/{id}/resume")
    suspend fun resume(@Path("id") id: String, @Body body: RuleEmptyBody = RuleEmptyBody()): RuleResponse

    @DELETE("api/rules/{id}")
    suspend fun delete(@Path("id") id: String): RuleOkResponse

    /** Build the sponsor-ready, PERMISSIONLESS `execute_due` bytes for a due rule. */
    @POST("api/rules/{id}/execute")
    suspend fun executePrepare(@Path("id") id: String, @Body body: RuleEmptyBody = RuleEmptyBody()): RuleExecuteResponse

    /** Record a confirmed on-chain release — advances the rule's next-due mirror. */
    @POST("api/rules/{id}/executed")
    suspend fun recordExecuted(@Path("id") id: String, @Body body: RuleExecutedBody): RuleResponse
}

/** USD amount pinned to en_US, e.g. "$1,234.50" — mirrors iOS `TaliseFormat.usd2`. */
internal fun usd2(v: Double): String = "$" + String.format(java.util.Locale.US, "%,.2f", v)

/**
 * Pull an honest, user-facing message out of a failed rules call — the
 * Android stand-in for iOS `APIError.honestMoneyError`: surface the server's
 * `{"error": "…"}` when present, else the fallback.
 */
internal fun rulesErrorFor(t: Throwable, fallback: String): String {
    if (t is HttpException) {
        val body = runCatching { t.response()?.errorBody()?.string() }.getOrNull()
        runCatching {
            val e = ApiClient.json.parseToJsonElement(body.orEmpty())
                .jsonObject["error"]?.jsonPrimitive?.contentOrNull
            if (!e.isNullOrEmpty()) return e
        }
    }
    return fallback
}
