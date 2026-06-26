package io.talise.app.core.auth

import io.talise.app.core.model.ExchangeRequest
import io.talise.app.core.model.UserDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import io.talise.app.core.session.AppSession
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters

/**
 * zkLogin coordinator — Android counterpart of iOS `ZkLoginCoordinator`.
 *
 * Sign-in (driven by the SignIn screen, which obtains a Google ID token via
 * Credential Manager): generate/persist the ephemeral Ed25519 key, then exchange
 * the ID token + ephemeral pubkey + randomness + maxEpoch for a bearer token.
 *
 * Transaction signing reuses [SuiCrypto.signTransaction] so the bytes match iOS
 * exactly; the server wraps the ZK proof in `/api/zk/sponsor-execute` (phase 2).
 */
object ZkLoginCoordinator {

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

    /** Base64 ephemeral pubkey to embed in the OAuth nonce (built by the server/Google flow). */
    fun ephemeralPubKeyB64(): String = SuiCrypto.publicKeyB64(ephemeralKey())

    /**
     * Exchange a Google ID token for a Talise session. `maxEpoch` + `jwtRandomness`
     * must match what was bound into the OAuth nonce. On success the bearer is stored
     * and the session advances. Returns the signed-in user.
     */
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
        val user = res.user ?: ApiClient.api.me()
        AppSession.handleSignedIn(user)
        return user
    }

    /** Sign sponsor-ready tx bytes with the ephemeral key (Sui SerializedSignature). */
    fun signTransaction(txBytesB64: String): String =
        SuiCrypto.signTransaction(txBytesB64, ephemeralKey())
}
