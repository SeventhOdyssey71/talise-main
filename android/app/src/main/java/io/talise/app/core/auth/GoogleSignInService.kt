package io.talise.app.core.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import io.talise.app.config.AppConfig

/**
 * Google sign-in via Credential Manager — returns a Google ID token whose `nonce`
 * claim is the zkLogin Poseidon nonce ([ZkLoginCoordinator.prepareGoogle]). Uses the
 * **web** OAuth client id (`AppConfig.googleWebClientId`) so the derived Sui address
 * matches iOS + web.
 */
object GoogleSignInService {
    class NotConfigured : IllegalStateException("GOOGLE_WEB_CLIENT_ID is not set")
    class UnexpectedCredential : IllegalStateException("Unexpected credential type from Credential Manager")

    suspend fun getIdToken(context: Context, nonce: String): String {
        val webClientId = AppConfig.googleWebClientId
        if (webClientId.isBlank()) throw NotConfigured()

        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false) // allow any Google account, not just previously-used
            .setServerClientId(webClientId)
            .setNonce(nonce)
            .setAutoSelectEnabled(false)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        val result = CredentialManager.create(context).getCredential(context, request)
        val cred = result.credential
        if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            return GoogleIdTokenCredential.createFrom(cred.data).idToken
        }
        throw UnexpectedCredential()
    }
}
