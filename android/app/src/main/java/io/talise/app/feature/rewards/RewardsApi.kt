package io.talise.app.feature.rewards

import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Feature-scoped Retrofit surface for the Rewards tab — the same endpoints
 * iOS `RewardsView` / `GoalsSection` / `InsightsSection` / `RedemptionsSection`
 * / `RoundupCard` call.
 */
interface RewardsApi {
    @GET("api/referral/summary")
    suspend fun summary(): RewardsSummary

    // Savings goals
    @GET("api/rewards/goals")
    suspend fun goals(): SavingsGoalsResponse

    @POST("api/rewards/goals")
    suspend fun createGoal(@Body body: SavingsGoalCreateRequest): SavingsGoalMutationResponse

    /** Tracking deposit / withdrawal (DB rail, no on-chain vault). */
    @POST("api/rewards/goals/{id}")
    suspend fun goalDeposit(@Path("id") id: String, @Body body: GoalDepositRequest): SavingsGoalMutationResponse

    /** Update / archive. */
    @PATCH("api/rewards/goals/{id}")
    suspend fun updateGoal(@Path("id") id: String, @Body body: SavingsGoalUpdateRequest): SavingsGoalMutationResponse

    // On-chain GoalVault rail (prepare → sign locally → sponsor-execute → confirm)
    @POST("api/goals/vault/prepare")
    suspend fun vaultPrepare(@Body body: GoalVaultPrepareRequest): GoalVaultPrepareResponse

    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: SponsorExecuteRequest): SponsorExecuteResponse

    @POST("api/goals/vault/confirm")
    suspend fun vaultConfirm(@Body body: GoalVaultConfirmBody): GoalVaultConfirmResponse

    // Insights
    @GET("api/rewards/insights")
    suspend fun insights(): MonthInsights

    // Redemptions
    @GET("api/rewards/catalogue")
    suspend fun catalogue(): RedemptionsCatalogue

    @POST("api/rewards/redeem")
    suspend fun redeem(@Body body: RedeemRequest): RedemptionResponse

    // Round-up & Save
    @POST("api/rewards/roundup")
    suspend fun roundup(@Body body: RoundupUpdateRequest): RoundupUpdateResponse
}

/** Shared instance — one Retrofit service for the whole rewards feature. */
internal val rewardsApi: RewardsApi by lazy { ApiClient.create(RewardsApi::class.java) }

/**
 * Structured vault-rail failure — the Android analogue of iOS
 * `ZkLoginCoordinator.CoordinatorError.structured(_, code, _)`. `code` is the
 * server's JSON `code` field when present, else `HTTP_<status>`; the goal
 * flows use it to fall back to the DB tracking rail (GOAL_VAULT_DISABLED,
 * HTTP_404, …) exactly like iOS.
 */
internal class GoalRailException(val code: String, message: String) : Exception(message)

/** Extract a friendly `error` + `code` from a Retrofit HTTP failure body. */
internal fun HttpException.asGoalRail(): GoalRailException {
    val body = runCatching { response()?.errorBody()?.string() }.getOrNull()
    // Default to HTTP_<status> so the 404/503 fallbacks still match when the
    // body carries no structured code.
    var railCode = "HTTP_${code()}"
    var railMessage = message ?: "request failed"
    if (!body.isNullOrBlank()) {
        runCatching {
            val json = ApiClient.json.parseToJsonElement(body).jsonObject
            json["code"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }?.let { railCode = it }
            json["error"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }?.let { railMessage = it }
        }
    }
    return GoalRailException(railCode, railMessage)
}

/** The structured code for a throwable, or null when it has none. */
internal fun railCode(t: Throwable): String? = when (t) {
    is GoalRailException -> t.code
    is HttpException -> "HTTP_${t.code()}"
    else -> null
}

/**
 * On-chain GoalVault op — `create` (mint + fund), `deposit`, `withdraw`,
 * `yield-start`, or `yield-withdraw`. Mirrors iOS
 * `ZkLoginCoordinator.signAndSubmitGoalVault`:
 *
 *   POST /api/goals/vault/prepare { op, goalId, amountUsd, name?, targetUsd? } → { bytes }
 *   sign(bytes) locally with the ephemeral zkLogin key
 *   POST /api/zk/sponsor-execute { bytesB64, … } → { digest }
 *
 * Returns the tx digest; the caller records it via POST /api/goals/vault/confirm.
 */
internal suspend fun signAndSubmitGoalVault(
    op: String,
    goalId: String,
    amountUsd: Double,
    name: String? = null,
    targetUsd: Double? = null,
): String {
    // 1. Build the sponsored PTB server-side.
    val prep = try {
        rewardsApi.vaultPrepare(GoalVaultPrepareRequest(op = op, goalId = goalId, amountUsd = amountUsd, name = name, targetUsd = targetUsd))
    } catch (e: HttpException) {
        throw e.asGoalRail()
    }
    if (!prep.error.isNullOrEmpty()) throw GoalRailException(prep.code ?: "PREPARE_FAILED", prep.error)
    val bytes = prep.bytes ?: throw GoalRailException("PREPARE_FAILED", "malformed vault/prepare response")

    // 2. Sign locally — identical byte shape to the Send path.
    val userSignature = ZkLoginCoordinator.signTransaction(bytes)
    val randomness = SecureStore.jwtRandomness
        ?: throw GoalRailException("NO_SESSION", "Session needs a refresh. Sign in again.")

    // 3. Execute via the sponsored rail; the server assembles the zkLogin proof.
    val exec = try {
        rewardsApi.sponsorExecute(
            SponsorExecuteRequest(
                bytesB64 = bytes,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
            ),
        )
    } catch (e: HttpException) {
        throw e.asGoalRail()
    }
    if (!exec.error.isNullOrEmpty()) throw GoalRailException(exec.code ?: "EXECUTE_FAILED", exec.error)
    return exec.digest?.takeIf { it.isNotEmpty() }
        ?: throw GoalRailException("EXECUTE_FAILED", "no digest in response")
}
