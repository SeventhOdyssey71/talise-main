package io.talise.app.feature.withdraw

import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import retrofit2.HttpException

/**
 * The signing rail for the withdraw flow — Android's mirror of the two iOS
 * `ZkLoginCoordinator` primitives the cash-out screens call:
 *
 *   • [signAndSubmitSend] — iOS `signAndSubmitSend(to:amountUsd:intent:sponsorFallback:true)`.
 *     One server call builds the PTB and picks the rail (`mode`): "gasless" →
 *     /api/send/gasless-submit, "sponsored" → /api/zk/sponsor-execute. The
 *     bytes are signed LOCALLY with the ephemeral zkLogin key (non-custodial).
 *   • [signAndExecuteRaw] — iOS `signAndExecuteRaw(bytesB64:meta:)` for
 *     externally-prepared sponsor-ready bytes (Bridge swap / USDC send).
 */
internal object WithdrawRail {
    val api: WithdrawApi = ApiClient.create(WithdrawApi::class.java)

    suspend fun signAndSubmitSend(to: String, amountUsd: Double): String {
        // 1. Prepare: server builds the PTB, gasless first, sponsored fallback
        //    (a cash-out is fee-free to the user and MUST land regardless of
        //    the shape of their balance).
        val prep = api.sponsorPrepare(WithdrawPrepareRequest(to = to, amount = amountUsd))
        prep.error?.takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) }
        val bytes = prep.bytes ?: throw IllegalStateException("malformed sponsor-prepare response")

        // 2. Sign locally with the ephemeral key.
        val userSignature = ZkLoginCoordinator.signTransaction(bytes)
        val randomness = SecureStore.jwtRandomness
            ?: throw IllegalStateException("Sign in again, your session needs a refresh.")
        val pubKey = ZkLoginCoordinator.ephemeralPubKeyB64()

        // 3. Submit on the rail the server chose.
        return if (prep.mode == "gasless") {
            val res = api.gaslessSubmit(
                GaslessSubmitRequest(
                    bytesB64 = bytes,
                    ephemeralPubKeyB64 = pubKey,
                    maxEpoch = SecureStore.maxEpoch,
                    randomness = randomness,
                    userSignature = userSignature,
                    meta = SendMeta(kind = "send", amountUsd = amountUsd),
                ),
            )
            res.digest ?: throw IllegalStateException(res.error ?: "the send did not go through")
        } else {
            val res = api.sponsorExecute(
                SponsorExecuteRequest(
                    bytesB64 = bytes,
                    ephemeralPubKeyB64 = pubKey,
                    maxEpoch = SecureStore.maxEpoch,
                    randomness = randomness,
                    userSignature = userSignature,
                ),
            )
            res.digest ?: throw IllegalStateException(res.error ?: "the send did not go through")
        }
    }

    suspend fun signAndExecuteRaw(bytesB64: String, meta: WithdrawMeta): String {
        val userSignature = ZkLoginCoordinator.signTransaction(bytesB64)
        val randomness = SecureStore.jwtRandomness
            ?: throw IllegalStateException("Sign in again, your session needs a refresh.")
        val res = api.sponsorExecute(
            SponsorExecuteRequest(
                bytesB64 = bytesB64,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = meta,
            ),
        )
        return res.digest ?: throw IllegalStateException(res.error ?: "the transaction did not go through")
    }

    /** The raw error body of a failed call, for [friendlyOfframpError]. */
    fun httpBody(e: HttpException): String? =
        runCatching { e.response()?.errorBody()?.string() }.getOrNull()
}
