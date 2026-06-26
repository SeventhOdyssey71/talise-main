package io.talise.app.core.auth

import io.talise.app.core.model.ExchangeRequest
import io.talise.app.core.model.NonceRequest
import io.talise.app.core.model.UserDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.AppSession
import io.talise.app.core.store.SecureStore
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters

/**
 * zkLogin coordinator — Android counterpart of iOS `ZkLoginCoordinator`.
 *
 * Native Google flow (mirrors the iOS Apple path — no in-app browser):
 *   1. [prepareGoogle] — ensure ephemeral Ed25519 key, read the live Sui epoch
 *      (`maxEpoch = epoch + 2`), generate `jwtRandomness`, and ask the server to
 *      compute the zkLogin Poseidon nonce (`/api/auth/mobile/nonce`).
 *   2. The SignIn screen obtains a Google ID token bound to that nonce via
 *      Credential Manager ([GoogleSignInService]).
 *   3. [exchangeGoogle] — POST `/api/auth/mobile/exchange` → bearer + user.
 *
 * Transaction signing reuses [SuiCrypto.signTransaction] so bytes match iOS exactly;
 * the server wraps the ZK proof in `/api/zk/sponsor-execute` (phase 2).
 */
object ZkLoginCoordinator {

    /** Pre-auth material for one Google sign-in attempt. */
    data class GooglePrep(val nonce: String, val maxEpoch: Int, val randomness: String)

    private fun ephemeralKey(): Ed25519PrivateKeyParameters {
        val stored = SecureStore.ephemeralSk
        return if (stored != null) {
            SuiCrypto.loadPrivateKey(stored)
        } else {
            val fresh = SuiCrypto.newEphemeralPrivateKey()
            SecureStore.ephemeralSk = SuiCrypto.privateKeyB64(fresh)
            fresh
        }
    }

    fun ephemeralPubKeyB64(): String = SuiCrypto.publicKeyB64(ephemeralKey())

    /** Step 1 — epoch + randomness + server-computed zkLogin nonce. */
    suspend fun prepareGoogle(): GooglePrep {
        val currentEpoch = ApiClient.api.epoch().epoch.toLong()
        val maxEpoch = (currentEpoch + 2).toInt()
        val randomness = SuiCrypto.newJwtRandomness()
        val nonce = ApiClient.api.nonce(
            NonceRequest(ephemeralPubKeyB64 = ephemeralPubKeyB64(), maxEpoch = maxEpoch, randomness = randomness)
        ).nonce
        return GooglePrep(nonce = nonce, maxEpoch = maxEpoch, randomness = randomness)
    }

    /** Step 3 — exchange the nonce-bound Google ID token for a Talise session. */
    suspend fun exchangeGoogle(idToken: String, maxEpoch: Int, jwtRandomness: String): UserDTO {
        val res = ApiClient.api.exchange(
            ExchangeRequest(
                idToken = idToken,
                ephemeralPubKeyB64 = ephemeralPubKeyB64(),
                jwtRandomness = jwtRandomness,
                maxEpoch = maxEpoch,
                provider = "google",
            )
        )
        SecureStore.bearer = res.bearer
        SecureStore.maxEpoch = maxEpoch
        SecureStore.jwtRandomness = jwtRandomness
        val user = res.user ?: ApiClient.api.me()
        AppSession.handleSignedIn(user)
        return user
    }

    /** Sign sponsor-ready tx bytes with the ephemeral key (Sui SerializedSignature). */
    fun signTransaction(txBytesB64: String): String =
        SuiCrypto.signTransaction(txBytesB64, ephemeralKey())
}
