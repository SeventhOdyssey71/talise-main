package io.talise.app.feature.invoices

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

/**
 * Invoices endpoints — mirrors the DTOs declared inline in iOS
 * `InvoicesView.swift` (/api/invoices, /api/invoices/[id], /settle).
 */

/** A rich Work invoice (`work_invoices`), the `WorkInvoice` shape from GET/POST /api/invoices. */
@Serializable
data class WorkInvoiceDTO(
    val id: String,
    val amountUsd: Double,
    val currency: String,
    val customerName: String? = null,
    val customerEmail: String? = null,
    val lineItems: List<InvoiceLineItem>? = null,
    val memo: String? = null,
    /** "open" | "paid" | "void" */
    val status: String,
    val dueMs: Double? = null,
    val createdAt: Double,
    val payDigest: String? = null,
)

@Serializable
data class InvoiceLineItem(
    val description: String,
    val qty: Double,
    val unitUsd: Double,
)

@Serializable
data class InvoicesListResp(val invoices: List<WorkInvoiceDTO>)

@Serializable
data class InvoiceCreateResp(
    val ok: Boolean,
    val invoice: WorkInvoiceDTO,
    val payUrl: String? = null,
)

/** GET /api/invoices/[id] — the owner view returns `{ invoice, owner }`. */
@Serializable
data class InvoiceDetailResp(
    val invoice: PublicInvoiceDTO,
    val owner: Boolean,
)

@Serializable
data class PublicInvoiceDTO(
    val id: String,
    val amountUsd: Double,
    val currency: String,
    val customerName: String? = null,
    val lineItems: List<InvoiceLineItem>? = null,
    val memo: String? = null,
    val status: String,
    val dueMs: Double? = null,
    val createdAt: Double,
    val issuer: InvoiceIssuer? = null,
)

@Serializable
data class InvoiceIssuer(
    val handle: String,
    val address: String,
    val name: String? = null,
)

@Serializable
data class InvoiceSettleResp(
    val ok: Boolean,
    val status: String,
    val digest: String? = null,
)

/**
 * Rich-invoice body — the route routes to work_invoices for any signed-in
 * user when a rich field is present. We send amountUsd (no line items) +
 * optional name/memo.
 */
@Serializable
data class InvoiceCreateBody(
    val amountUsd: Double,
    val customerName: String? = null,
    val memo: String? = null,
)

@Serializable
data class InvoiceSettleBody(val digest: String)

interface InvoicesApi {
    @GET("api/invoices")
    suspend fun list(): InvoicesListResp

    @POST("api/invoices")
    suspend fun create(@Body body: InvoiceCreateBody): InvoiceCreateResp

    @GET("api/invoices/{id}")
    suspend fun detail(@Path("id") id: String): InvoiceDetailResp

    @POST("api/invoices/{id}/settle")
    suspend fun settle(@Path("id") id: String, @Body body: InvoiceSettleBody): InvoiceSettleResp
}

/** Stable public pay link for an invoice (talise.io/i/<id>). */
internal fun payUrl(id: String): String = "https://www.talise.io/i/$id"

/**
 * Shared error mapping for Work (invoices + contracts), ported from iOS
 * `friendlyWorkError`: map rollout / not-found responses to reassuring copy;
 * surface real, actionable server messages (rate limits, validation) verbatim.
 */
internal fun friendlyWorkError(code: Int, message: String?, noun: String): String {
    val lower = message.orEmpty().lowercase()
    if (code == 503 || lower.contains("not configured") || lower.contains("disabled")) {
        return "This is rolling out, check back soon."
    }
    if (code == 429) return "Too many requests, give it a moment and try again."
    // Body is often JSON like {"error":"…"} — pull the message out.
    runCatching {
        val e = ApiClient.json.parseToJsonElement(message.orEmpty())
            .jsonObject["error"]?.jsonPrimitive?.contentOrNull
        if (!e.isNullOrEmpty()) return e
    }
    if (!message.isNullOrEmpty()) return message
    return "Couldn't load the $noun right now."
}

/** Map any throwable from an invoices call to user-facing copy. */
internal fun workErrorFor(t: Throwable, noun: String, fallback: String): String =
    if (t is HttpException) {
        friendlyWorkError(t.code(), runCatching { t.response()?.errorBody()?.string() }.getOrNull(), noun)
    } else {
        fallback
    }
