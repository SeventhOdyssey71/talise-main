import Foundation

enum APIError: Error, LocalizedError {
    case transport(Error)
    case decode(Error, body: String)
    case status(Int, message: String?)
    case unauthorized
    case noSession
    case pinningFailed
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .transport(let e):
            return "Network: \(e.localizedDescription)"
        case .decode(_, let body):
            // Best-effort hint: if the body is a Talise-shaped JSON
            // error (`{"error":"…"}`), surface the inner message so
            // the UI is actually debuggable. Otherwise fall back to a
            // truncated raw snippet, with HTML and overly-long bodies
            // suppressed via `safeMessage`. The full `error` + `body`
            // remain in the case payload for the caller's log.
            if let hint = Self.safeMessage(body) {
                return "Couldn't read response: \(hint)"
            }
            return "Couldn't read response from server."
        case .status(let code, let msg):
            // Same protection here. If the server returned HTML (Next.js
            // 404 page, etc.), the msg field carries it — strip anything
            // that looks like markup before showing to the user.
            if let safe = msg.flatMap(Self.safeMessage) {
                return "HTTP \(code): \(safe)"
            }
            return "HTTP \(code)"
        case .unauthorized:
            return "Session expired. Sign in again."
        case .noSession:
            return "Not signed in."
        case .pinningFailed:
            return "Server identity could not be verified."
        case .invalidResponse:
            return "Unexpected response from server."
        }
    }

    private static func safeMessage(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Anything starting with markup is almost certainly a 404 page.
        if trimmed.hasPrefix("<") { return nil }
        // Extract `error` field from `{"error": "…"}` so the UI shows a
        // clean sentence instead of raw JSON. Falls through to the
        // verbatim path on parse failure.
        if trimmed.hasPrefix("{"),
           let data = trimmed.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let inner = (parsed["error"] as? String) ?? (parsed["message"] as? String),
           !inner.isEmpty {
            return clip(inner)
        }
        return clip(trimmed)
    }

    private static func clip(_ s: String) -> String? {
        if s.isEmpty { return nil }
        if s.count > 140 { return String(s.prefix(137)) + "…" }
        return s
    }
}
