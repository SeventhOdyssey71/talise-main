package io.talise.app.feature.cheques

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Cheques endpoints + DTOs — mirror the private Decodables declared inline in
 * iOS `ChequesView.swift` (/api/cheques/create, /confirm-funded, /reclaim,
 * /mine, /preview, /claim/release).
 */

// MARK: - DTOs

@Serializable
data class ChequeCreateResp(
    val chequeId: String,
    val amountUsd: Double,
    val claimUrl: String,
    val secret: String,
    /**
     * Funding rail picked by the backend. "onchain" → sign `fundingBytes`
     * via the sponsor-execute rail; "escrow" (or absent for older backends)
     * → fund `escrowAddress` over the normal send rail.
     */
    val mode: String? = null,
    /** Sponsor-ready `cheque::create` bytes — present only on the on-chain rail. */
    val fundingBytes: String? = null,
    /** Talise escrow address — present only on the escrow rail. */
    val escrowAddress: String? = null,
)

@Serializable
data class ChequeConfirmResp(val ok: Boolean)

/**
 * Reclaim ("Claim back") response. On the on-chain rail the BUILD step
 * returns `mode:"onchain"` + sponsor-ready `reclaimBytes` for the creator to
 * sign; the escrow rail does the refund server-side and returns the final
 * `status` ("voided") with the refund `digest`. All fields optional so both
 * shapes parse from one type.
 */
@Serializable
data class ChequeReclaimResp(
    val ok: Boolean? = null,
    val mode: String? = null,
    val reclaimBytes: String? = null,
    val status: String? = null,
    val digest: String? = null,
    val amountUsd: Double? = null,
)

@Serializable
data class ChequePreviewResp(
    val id: String,
    val amountUsd: Double,
    val status: String,
    val payeeLabel: String? = null,
    val memo: String? = null,
    val signatureName: String? = null,
    val creatorDisplay: String,
    val allowedCountries: List<String> = emptyList(),
    val expiresAt: Double,
    val claimable: Boolean,
)

@Serializable
data class ChequeClaimResp(
    val ok: Boolean,
    val digest: String? = null,
    val amountUsd: Double? = null,
)

/**
 * One row of GET /api/cheques/mine. `createdAt`/`expiresAt` are epoch ms;
 * `reclaimable` is the server's "funded + unclaimed + not expired" flag.
 */
@Serializable
data class MyChequeRow(
    val id: String,
    val amountUsd: Double,
    val status: String,
    val memo: String? = null,
    val payeeLabel: String? = null,
    val createdAt: Double,
    val expiresAt: Double,
    val reclaimable: Boolean = false,
)

@Serializable
data class MyChequesResp(val cheques: List<MyChequeRow> = emptyList())

// MARK: - Request bodies

@Serializable
data class ChequeCreateBody(
    val amountUsd: Double,
    val payeeLabel: String,
    val memo: String? = null,
    val allowedCountries: List<String> = emptyList(),
)

@Serializable
data class ChequeDigestBody(val digest: String)

/** Reclaim: `{}` for the BUILD step, `{digest}` for the CONFIRM step. */
@Serializable
data class ChequeReclaimBody(val digest: String? = null)

@Serializable
data class ChequeClaimBody(
    val secret: String,
    val turnstileToken: String? = null,
)

interface ChequesApi {
    @POST("api/cheques/create")
    suspend fun create(@Body body: ChequeCreateBody): ChequeCreateResp

    @POST("api/cheques/{id}/confirm-funded")
    suspend fun confirmFunded(@Path("id") id: String, @Body body: ChequeDigestBody): ChequeConfirmResp

    @POST("api/cheques/{id}/reclaim")
    suspend fun reclaim(@Path("id") id: String, @Body body: ChequeReclaimBody): ChequeReclaimResp

    @GET("api/cheques/mine")
    suspend fun mine(): MyChequesResp

    @GET("api/cheques/{id}/preview")
    suspend fun preview(@Path("id") id: String, @Query("s") secret: String): ChequePreviewResp

    @POST("api/cheques/{id}/claim/release")
    suspend fun claimRelease(@Path("id") id: String, @Body body: ChequeClaimBody): ChequeClaimResp
}

// MARK: - Error mapping

/**
 * Map "backend isn't live yet" cheque responses (404 / 503 / "disabled" /
 * "not configured") to reassuring rollout copy, instead of leaking "HTTP 404".
 * Real, actionable server messages pass through. Ported from iOS `chequeError`.
 */
internal fun chequeError(code: Int, message: String?, verb: String): String {
    val lower = message.orEmpty().lowercase()
    val rolloutPhrase = lower.contains("not configured") || lower.contains("disabled") ||
        lower.contains("not found") || lower.contains("unavailable")
    if (code == 404 || code == 503 || rolloutPhrase) {
        return "Cheques are rolling out, check back soon."
    }
    // Body is often JSON like {"error":"…"} — pull the message out.
    runCatching {
        val e = ApiClient.json.parseToJsonElement(message.orEmpty())
            .jsonObject["error"]?.jsonPrimitive?.contentOrNull
        if (!e.isNullOrEmpty()) return e
    }
    if (!message.isNullOrEmpty()) return message
    return "Couldn't $verb the cheque right now."
}

/** Map any throwable from a cheques call to user-facing copy. */
internal fun chequeErrorFor(t: Throwable, verb: String, fallback: String): String =
    if (t is HttpException) {
        chequeError(t.code(), runCatching { t.response()?.errorBody()?.string() }.getOrNull(), verb)
    } else {
        fallback
    }

/** Service genuinely not live yet (503 / "disabled") — a bare 404 is ambiguous here. */
internal fun chequeIsRollout(t: Throwable): Boolean {
    if (t !is HttpException) return false
    val lower = runCatching { t.response()?.errorBody()?.string() }.getOrNull().orEmpty().lowercase()
    return t.code() == 503 || lower.contains("disabled") || lower.contains("not configured")
}

/** USD amount pinned to en_US, e.g. "$1,234.50" — mirrors iOS `TaliseFormat.usd2`. */
internal fun usd2(v: Double): String = "$" + String.format(java.util.Locale.US, "%,.2f", v)

/** Parse `…/c/<id>#<secret>` (or `talise://c/<id>#<secret>`). */
internal fun parseChequeLink(s: String): Pair<String, String>? {
    val hash = s.indexOf('#')
    if (hash < 0) return null
    val secret = s.substring(hash + 1)
    val beforeHash = s.substring(0, hash)
    val slash = beforeHash.lastIndexOf("/c/")
    if (slash < 0) return null
    val id = beforeHash.substring(slash + 3)
    if (id.isEmpty() || secret.isEmpty()) return null
    return id to secret
}

// MARK: - Amount in words (cheque convention)

internal fun amountInWords(usd: Double): String {
    val whole = usd.toInt()
    val cents = ((usd - whole) * 100 + 0.5).toInt()
    val dollars = if (whole == 0) "Zero" else numberToWords(whole)
    val centStr = String.format(java.util.Locale.US, "%02d", cents)
    return "$dollars and $centStr/100".replaceFirstChar { it.uppercase() }
}

private fun numberToWords(n: Int): String {
    if (n == 0) return "zero"
    val ones = listOf(
        "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen",
    )
    val tens = listOf("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
    fun under1000(x: Int): String {
        val parts = mutableListOf<String>()
        val h = x / 100
        val r = x % 100
        if (h > 0) parts.add("${ones[h]} hundred")
        if (r >= 20) {
            val t = tens[r / 10]
            val o = r % 10
            parts.add(if (o > 0) "$t-${ones[o]}" else t)
        } else if (r > 0) {
            parts.add(ones[r])
        }
        return parts.joinToString(" ")
    }
    val out = mutableListOf<String>()
    val millions = n / 1_000_000
    val thousands = (n / 1000) % 1000
    val rest = n % 1000
    if (millions > 0) out.add("${under1000(millions)} million")
    if (thousands > 0) out.add("${under1000(thousands)} thousand")
    if (rest > 0) out.add(under1000(rest))
    return out.joinToString(" ")
}
