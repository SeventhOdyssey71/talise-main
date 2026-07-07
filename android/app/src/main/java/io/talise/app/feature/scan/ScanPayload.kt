package io.talise.app.feature.scan

import java.net.URI
import java.net.URLDecoder

/**
 * Normalizes a raw scanned QR string into a recipient string the Send
 * flow already knows how to resolve, an exact port of iOS `ScanPayload`.
 * The Send flow's recipient input accepts three things:
 *   - a bare `0x…` Sui address (resolved locally by [ScanSuiAddress])
 *   - a SuiNS name (`alice.sui`, `alice@talise.sui`)
 *   - a Talise handle (`alice`), resolved server-side via `/api/recipient/resolve`
 *
 * So the parser's job is purely to extract a recipient token (and an
 * optional amount) from whatever encoding the QR used, then hand that
 * token to the Send flow's existing resolver. We do NOT re-implement
 * resolution here.
 */
object ScanPayload {

    /** A parsed, routable scan result. */
    data class Recipient(
        /**
         * The recipient token to seed the Send flow with, an address,
         * SuiNS name, or bare handle. Always non-empty.
         */
        val recipient: String,
        /**
         * Optional amount carried by a `talise://pay` deep link (`?amount=…`).
         */
        val amount: Double?,
    )

    /**
     * Attempts to interpret [raw] as a Talise payment code. Returns null
     * for anything we can't route (random URLs, plain text, etc.) so the
     * scanner can show "Not a Talise payment code" and keep scanning.
     */
    fun parse(raw: String): Recipient? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null

        // 1. talise://pay/<handle>?amount=… deep link.
        parseDeepLink(trimmed)?.let { return it }

        // 1b. https://…talise.io/pay/<handle>?amount=… — the share/QR links
        //     the web app generates (www.talise.io, app.talise.io, or the
        //     bare apex). Without this branch a QR made on app.talise.io
        //     scans as "not a Talise payment code".
        parseWebPayUrl(trimmed)?.let { return it }

        // 2. `sui:` / `sui://` payment URI, the exact form our own Receive
        //    QR encodes (`sui:<address>`) and the de-facto scheme other Sui
        //    wallets emit.
        parseSuiUri(trimmed)?.let { return it }

        // 3. Bare 0x Sui address.
        ScanSuiAddress.normalize(trimmed)?.let { return Recipient(recipient = it, amount = null) }

        // 4. Bare @handle / handle / handle.talise.sui / handle.sui.
        parseHandle(trimmed)?.let { return Recipient(recipient = it, amount = null) }

        return null
    }

    // MARK: - sui: URI

    /**
     * Parses a `sui:<token>` or `sui://<token>` payment URI, where `<token>`
     * is a 0x address (the common case, our Receive QR) or a handle, with an
     * optional `?amount=` query. Returns null for any other scheme so the
     * caller falls through to the bare-address / handle checks.
     */
    private fun parseSuiUri(s: String): Recipient? {
        val comps = UriComponents.from(s) ?: return null
        if (comps.scheme != "sui") return null
        // `sui:0xABC` parses opaque (path holds the token); `sui://0xABC` has host="0xABC".
        val hostToken = comps.host?.takeIf { it.isNotEmpty() }
        val rawToken = (hostToken ?: comps.path).trim('/')
        if (rawToken.isEmpty()) return null

        val recipient = ScanSuiAddress.normalize(rawToken)
            ?: parseHandle(rawToken)
            ?: return null

        return Recipient(recipient = recipient, amount = comps.amount())
    }

    // MARK: - Web pay URL

    /**
     * Parses `https://<any>.talise.io/pay/<handle>` (and the bare apex),
     * including the app-subdomain form `…/app/pay/<handle>` just in case,
     * with optional `?amount=`. Only the /pay tree routes; other Talise
     * URLs (cheque claims, invoices) have their own surfaces and should NOT
     * silently become a Send.
     */
    private fun parseWebPayUrl(s: String): Recipient? {
        val comps = UriComponents.from(s) ?: return null
        if (comps.scheme != "https" && comps.scheme != "http") return null
        val host = comps.host?.lowercase() ?: return null
        if (host != "talise.io" && !host.endsWith(".talise.io")) return null

        // Path → ["pay", "<handle>"] (tolerating a leading "app" segment).
        var parts = comps.path.split('/').filter { it.isNotEmpty() }
        if (parts.firstOrNull() == "app") parts = parts.drop(1)
        if (parts.size != 2 || parts[0].lowercase() != "pay") return null
        val token = runCatching { URLDecoder.decode(parts[1], "UTF-8") }.getOrDefault(parts[1])

        val recipient = ScanSuiAddress.normalize(token)
            ?: parseHandle(token)
            ?: return null

        return Recipient(recipient = recipient, amount = comps.amount())
    }

    // MARK: - Deep link

    private fun parseDeepLink(s: String): Recipient? {
        val comps = UriComponents.from(s) ?: return null
        if (comps.scheme != "talise") return null
        // talise://pay/<handle> parses as host="pay", path="/<handle>".
        if (comps.host?.lowercase() != "pay") return null

        val token = comps.path.trim('/')
        if (token.isEmpty()) return null

        // <token> may itself be a 0x address, a SuiNS name, or a handle.
        // Normalize it through the same handle/address logic so the Send
        // flow gets a clean recipient.
        val recipient = ScanSuiAddress.normalize(token)
            ?: parseHandle(token)
            ?: return null

        return Recipient(recipient = recipient, amount = comps.amount())
    }

    // MARK: - Handle

    /**
     * Accepts a bare handle, an `@handle`, or a SuiNS-style name and
     * returns a recipient token the Send resolver can take. We keep the
     * SuiNS suffix intact (the server resolver understands `.sui` and
     * `@talise.sui`) but strip a leading `@` from a bare handle so it
     * reads as `alice` rather than `@alice`.
     */
    fun parseHandle(s: String): String? {
        var token = s
        // Reject obvious non-handles: spaces, URLs we didn't recognize.
        if (token.contains(" ") || token.lowercase().startsWith("http")) return null

        // SuiNS names pass through verbatim; the server resolver keys on
        // the `.sui` / `@talise.sui` suffix.
        val lower = token.lowercase()
        if (lower.endsWith(".sui") || lower.endsWith("@talise.sui")) return token

        // Bare handle: drop a single leading "@", then validate it's a
        // plausible handle (alphanumerics, dot, underscore, hyphen). This
        // keeps us from routing arbitrary scanned text into Send.
        if (token.startsWith("@")) token = token.drop(1)
        if (token.isEmpty()) return null
        if (!token.all { it.isLetterOrDigit() || it == '.' || it == '_' || it == '-' }) return null
        // Require at least 3 chars so a stray "x" doesn't become a send
        // target, mirrors the Send resolver's own `q.count >= 3` gate.
        if (token.length < 3) return null
        return token
    }
}

/**
 * Local Sui-address decode, the Android twin of iOS `SuiAddress` (Sui/SuiAddress.swift):
 * lowercased `0x` + exactly 64 hex chars, with the same shortened display form.
 */
object ScanSuiAddress {
    /** Returns the normalized (lowercased) address, or null when not a valid 0x address. */
    fun normalize(raw: String): String? {
        val trimmed = raw.lowercase()
        if (!trimmed.startsWith("0x")) return null
        if (trimmed.length != 66) return null
        if (!trimmed.drop(2).all { it in '0'..'9' || it in 'a'..'f' }) return null
        return trimmed
    }

    /** "0x123456…abcdef" shortened display form, mirrors iOS `SuiAddress.short`. */
    fun short(raw: String): String {
        if (raw.length <= 14) return raw
        return raw.take(8) + "…" + raw.takeLast(6)
    }
}

/**
 * Minimal URLComponents-alike over `java.net.URI` that tolerates both opaque
 * (`sui:0xABC`) and hierarchical (`talise://pay/alice?amount=5`) forms, so the
 * parse branches above read like the iOS original.
 */
private class UriComponents(
    val scheme: String,
    val host: String?,
    val path: String,
    private val query: Map<String, String>,
) {
    fun amount(): Double? = query["amount"]?.toDoubleOrNull()

    companion object {
        fun from(s: String): UriComponents? = try {
            val uri = URI(s)
            val scheme = uri.scheme?.lowercase() ?: return null
            if (uri.isOpaque) {
                // sui:0xABC?amount=1 → schemeSpecificPart = "0xABC?amount=1".
                val ssp = uri.schemeSpecificPart ?: return null
                val qIdx = ssp.indexOf('?')
                val path = if (qIdx >= 0) ssp.substring(0, qIdx) else ssp
                val query = if (qIdx >= 0) parseQuery(ssp.substring(qIdx + 1)) else emptyMap()
                UriComponents(scheme, host = null, path = path, query = query)
            } else {
                // `sui://0x…` puts the token in the authority; java.net.URI can
                // leave `host` null for unusual reg-names, so fall back to it.
                val host = uri.host ?: uri.authority
                UriComponents(scheme, host = host, path = uri.path ?: "", query = parseQuery(uri.rawQuery))
            }
        } catch (_: Exception) {
            null
        }

        private fun parseQuery(rawQuery: String?): Map<String, String> {
            if (rawQuery.isNullOrEmpty()) return emptyMap()
            return rawQuery.split('&').mapNotNull { pair ->
                if (pair.isEmpty()) return@mapNotNull null
                val eq = pair.indexOf('=')
                val name = if (eq >= 0) pair.substring(0, eq) else pair
                val value = if (eq >= 0) pair.substring(eq + 1) else ""
                val decoded = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
                name to decoded
            }.toMap()
        }
    }
}
