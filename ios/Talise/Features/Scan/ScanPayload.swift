import Foundation

/// Normalizes a raw scanned QR string into a recipient string the Send
/// flow already knows how to resolve. The Send flow's recipient input
/// (`SendRecipientView` / `LegacySendView`) accepts three things:
///   • a bare `0x…` Sui address (resolved locally by `SuiAddress`)
///   • a SuiNS name (`alice.sui`, `alice@talise.sui`)
///   • a Talise handle (`alice`) → resolved server-side via
///     `/api/recipient/resolve`
///
/// So the parser's job is purely to extract a recipient token (and an
/// optional amount) from whatever encoding the QR used, then hand that
/// token to the Send flow's existing resolver — we do NOT re-implement
/// resolution here.
enum ScanPayload {
    /// A parsed, routable scan result.
    struct Recipient: Equatable {
        /// The recipient token to seed the Send flow with — an address,
        /// SuiNS name, or bare handle. Always non-empty.
        let recipient: String
        /// Optional amount carried by a `talise://pay` deep link
        /// (`?amount=…`). The Send flow doesn't yet consume a prefilled
        /// amount via the bridge, so this is parsed-and-surfaced for
        /// future use; routing only depends on `recipient` today.
        let amount: Double?
    }

    /// Attempts to interpret `raw` as a Talise payment code. Returns nil
    /// for anything we can't route (random URLs, plain text, etc.) so the
    /// scanner can show "Not a Talise payment code" and keep scanning.
    static func parse(_ raw: String) -> Recipient? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // 1. talise://pay/<handle>?amount=… deep link.
        if let deep = parseDeepLink(trimmed) {
            return deep
        }

        // 2. `sui:` / `sui://` payment URI — the exact form our own Receive
        //    QR encodes (`sui:<address>`) and the de-facto scheme other Sui
        //    wallets emit. Without this branch the scanner reads our QR but
        //    rejects it as "not a Talise code" (the `:` fails the bare-handle
        //    char check and `sui:0x…` isn't a bare 0x address).
        if let suiUri = parseSuiUri(trimmed) {
            return suiUri
        }

        // 3. Bare 0x Sui address.
        if let addr = SuiAddress(trimmed) {
            return Recipient(recipient: addr.raw, amount: nil)
        }

        // 4. Bare @handle / handle / handle.talise.sui / handle.sui.
        if let handle = parseHandle(trimmed) {
            return Recipient(recipient: handle, amount: nil)
        }

        return nil
    }

    // MARK: - sui: URI

    /// Parses a `sui:<token>` or `sui://<token>` payment URI, where `<token>`
    /// is a 0x address (the common case — our Receive QR) or a handle, with an
    /// optional `?amount=` query. Returns nil for any other scheme so the
    /// caller falls through to the bare-address / handle checks.
    private static func parseSuiUri(_ s: String) -> Recipient? {
        guard let comps = URLComponents(string: s),
              comps.scheme?.lowercased() == "sui" else {
            return nil
        }
        // `sui:0xABC` → path="0xABC" (no authority); `sui://0xABC` → host="0xABC".
        let hostToken = comps.host.flatMap { $0.isEmpty ? nil : $0 }
        let rawToken = (hostToken ?? comps.path)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !rawToken.isEmpty else { return nil }

        let recipient: String
        if let addr = SuiAddress(rawToken) {
            recipient = addr.raw
        } else if let handle = parseHandle(rawToken) {
            recipient = handle
        } else {
            return nil
        }

        let amount = comps.queryItems?
            .first(where: { $0.name == "amount" })?
            .value
            .flatMap(Double.init)

        return Recipient(recipient: recipient, amount: amount)
    }

    // MARK: - Deep link

    private static func parseDeepLink(_ s: String) -> Recipient? {
        guard let comps = URLComponents(string: s),
              comps.scheme?.lowercased() == "talise" else {
            return nil
        }
        // talise://pay/<handle> parses as host="pay", path="/<handle>".
        // Be liberal: also accept host being the handle when the path is
        // empty (talise://pay isn't valid, but talise://<handle> shouldn't
        // crash us).
        guard comps.host?.lowercased() == "pay" else { return nil }

        let token = comps.path
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !token.isEmpty else { return nil }

        // <token> may itself be a 0x address, a SuiNS name, or a handle.
        // Normalize it through the same handle/address logic so the Send
        // flow gets a clean recipient.
        let recipient: String
        if let addr = SuiAddress(token) {
            recipient = addr.raw
        } else if let handle = parseHandle(token) {
            recipient = handle
        } else {
            return nil
        }

        let amount = comps.queryItems?
            .first(where: { $0.name == "amount" })?
            .value
            .flatMap(Double.init)

        return Recipient(recipient: recipient, amount: amount)
    }

    // MARK: - Handle

    /// Accepts a bare handle, an `@handle`, or a SuiNS-style name and
    /// returns a recipient token the Send resolver can take. We keep the
    /// SuiNS suffix intact (the server resolver understands `.sui` and
    /// `@talise.sui`) but strip a leading `@` from a bare handle so it
    /// reads as `alice` rather than `@alice`.
    private static func parseHandle(_ s: String) -> String? {
        var token = s
        // Reject obvious non-handles: spaces, URLs we didn't recognize.
        guard !token.contains(" "),
              !token.lowercased().hasPrefix("http") else {
            return nil
        }

        // SuiNS names pass through verbatim — the server resolver keys on
        // the `.sui` / `@talise.sui` suffix.
        let lower = token.lowercased()
        if lower.hasSuffix(".sui") || lower.hasSuffix("@talise.sui") {
            return token
        }

        // Bare handle: drop a single leading "@", then validate it's a
        // plausible handle (alphanumerics, dot, underscore, hyphen). This
        // keeps us from routing arbitrary scanned text into Send.
        if token.hasPrefix("@") { token.removeFirst() }
        guard !token.isEmpty else { return nil }
        let allowed = CharacterSet.alphanumerics
            .union(CharacterSet(charactersIn: "._-"))
        guard token.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            return nil
        }
        // Require at least 3 chars so a stray "x" doesn't become a send
        // target — mirrors the Send resolver's own `q.count >= 3` gate.
        guard token.count >= 3 else { return nil }
        return token
    }
}
