package io.talise.app.feature.rules

import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Sign-and-execute helpers for EXTERNALLY-prepared, sponsor-ready PTB bytes —
 * the Android counterpart of iOS `ZkLoginCoordinator.signAndExecuteRaw` /
 * `executeSponsorReady` / `signAndSubmitSend`.
 *
 * The caller has already POSTed to some `*-prepare` / `create` / `cancel` /
 * `execute` route and received sponsor-ready `bytesB64`. We sign LOCALLY with
 * the ephemeral zkLogin Ed25519 key ([ZkLoginCoordinator.signTransaction] —
 * intent prefix [0,0,0] || tx_bytes → BLAKE2b-256 → Ed25519 → SerializedSig)
 * and forward to `/api/zk/sponsor-execute`, where the server assembles the
 * zkLogin proof from its stored JWT+salt and broadcasts. Non-custodial: the
 * key never leaves the device.
 *
 * NOTE for the core owner: this belongs in `core/auth/ZkLoginCoordinator`
 * (see parity notes) — it lives here because cheques/rules/contracts are the
 * first callers and feature dirs can't edit core.
 */

@Serializable
internal data class SponsorExecuteMeta(
    val kind: String? = null,
    val amountUsd: Double? = null,
)

@Serializable
internal data class SponsorExecuteRequest(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: SponsorExecuteMeta? = null,
)

@Serializable
internal data class SponsorExecuteResponse(
    val digest: String? = null,
    val error: String? = null,
)

internal interface ZkSponsorApi {
    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: SponsorExecuteRequest): SponsorExecuteResponse
}

internal object TaliseSigning {

    private val zk: ZkSponsorApi by lazy { ApiClient.create(ZkSponsorApi::class.java) }

    /**
     * Sign sponsor-ready bytes and execute through the Onara pipeline.
     * Mirrors iOS `executeSponsorReady(bytesB64:intent:)` — `kind`/`amountUsd`
     * become the `meta` block ({} when absent, exactly like iOS). Returns the
     * on-chain digest.
     */
    suspend fun executeSponsorReady(
        bytesB64: String,
        kind: String? = null,
        amountUsd: Double? = null,
    ): String {
        val userSignature = ZkLoginCoordinator.signTransaction(bytesB64)
        val randomness = SecureStore.jwtRandomness
            ?: error("Sign in again, your session needs a refresh.")
        val res = zk.sponsorExecute(
            SponsorExecuteRequest(
                bytesB64 = bytesB64,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = SponsorExecuteMeta(kind = kind, amountUsd = amountUsd),
            ),
        )
        return res.digest ?: error(res.error ?: "the transaction did not go through")
    }

    /**
     * Plain gasless USDsui send to an address — mirrors iOS
     * `signAndSubmitSend(to:amountUsd:intent:)`, used by the escrow funding
     * rails (cheque escrow, contract stream escrow). Same pipeline as
     * `SendViewModel`: sponsor-prepare → local sign → gasless-submit.
     */
    suspend fun signAndSubmitSend(to: String, amountUsd: Double): String {
        val prep = ApiClient.api.sponsorPrepare(SponsorPrepareRequest(to = to, amount = amountUsd))
        val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the send")
        val userSignature = ZkLoginCoordinator.signTransaction(bytes)
        val randomness = SecureStore.jwtRandomness
            ?: error("Sign in again, your session needs a refresh.")
        val res = ApiClient.api.gaslessSubmit(
            GaslessSubmitRequest(
                bytesB64 = bytes,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = SendMeta(kind = "send", amountUsd = amountUsd),
            ),
        )
        return res.digest ?: error(res.error ?: "the send did not go through")
    }
}
