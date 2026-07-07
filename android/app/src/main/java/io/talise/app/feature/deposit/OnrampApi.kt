package io.talise.app.feature.deposit

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Thin service over the api/onramp endpoints, Android counterpart of
 * iOS `OnrampAPI`.
 *
 * Stripe Crypto Onramp has no first-party mobile SDK. Our integration is the
 * hosted standalone onramp URL (https://crypto.link.com…) which we open in
 * the system browser from the deposit flow. The destination wallet is locked
 * server-side to the authenticated user's `sui_address`, so the client only
 * optionally suggests a USD `amount`.
 */
interface OnrampApi {
    /**
     * `POST /api/onramp/hosted-session` → `{ redirectUrl, id }`.
     *
     * Pass `amount` in USD (1…10 000). Server clamps to that range and rounds
     * to the nearest cent. Null falls through to Stripe's $20 default.
     */
    @POST("api/onramp/hosted-session")
    suspend fun hostedSession(@Body body: OnrampHostedSessionRequest): OnrampHostedSessionResponse
}

/** Request body for `POST /api/onramp/hosted-session`. `amount` is optional. */
@Serializable
data class OnrampHostedSessionRequest(val amount: Double?)

/**
 * Response from `POST /api/onramp/hosted-session`. `redirectUrl` is the
 * `crypto.link.com` hosted-onramp URL we mount in the browser. `id` is the
 * Stripe `cos_…` session id — kept for receipt logging / future polling.
 */
@Serializable
data class OnrampHostedSessionResponse(val redirectUrl: String, val id: String)
