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
        case .transport(let e): return "Network: \(e.localizedDescription)"
        case .decode(let e, _): return "Decode: \(e.localizedDescription)"
        case .status(let code, let msg): return "HTTP \(code)\(msg.map { ": \($0)" } ?? "")"
        case .unauthorized: return "Session expired. Sign in again."
        case .noSession: return "Not signed in."
        case .pinningFailed: return "Server identity could not be verified."
        case .invalidResponse: return "Unexpected response from server."
        }
    }
}
