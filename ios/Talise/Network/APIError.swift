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
        case .decode:
            // Never leak the response body into UI — it might be HTML from
            // a 404 page or an internal error trace. Surface a short
            // generic message; the underlying error stays in the case
            // payload for debug logging if a caller wants it.
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
        // Limit length so a verbose server error doesn't wrap the whole UI.
        if trimmed.count > 140 {
            return String(trimmed.prefix(137)) + "…"
        }
        return trimmed.isEmpty ? nil : trimmed
    }
}
