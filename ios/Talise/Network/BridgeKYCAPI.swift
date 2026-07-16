import Foundation

/// Bridge identity-verification (KYC) endpoints.
///
///   • start  → POST /api/kyc/bridge/start  — creates/returns the hosted Bridge
///              KYC + Terms-of-Service links and the current status.
///   • status → GET  /api/kyc/bridge/status — polls Bridge for the freshest
///              status (we don't rely on webhooks reaching the device).
///
/// One Bridge customer serves BOTH on-ramp and off-ramp, so verifying here is
/// what unlocks USD/EUR cash-out. Env-gated server-side: 503 when Bridge isn't
/// configured (the view renders a clean "not available yet" state).
@MainActor
enum BridgeKYCAPI {
    static func start() async throws -> BridgeKYCStartResponse {
        struct Empty: Encodable {}
        return try await APIClient.shared.post("/api/kyc/bridge/start", body: Empty())
    }

    static func status() async throws -> BridgeKYCStatusResponse {
        try await APIClient.shared.get("/api/kyc/bridge/status")
    }
}

/// Result of `POST /api/kyc/bridge/start`. `kycUrl` + `tosUrl` are the hosted
/// flows to open in Safari; `status` is the Talise-collapsed KYC status.
struct BridgeKYCStartResponse: Codable {
    let provider: String?
    let status: String
    let kycUrl: String?
    let tosUrl: String?
    let kycLinkId: String?
    let customerId: String?
}

/// Result of `GET /api/kyc/bridge/status`.
struct BridgeKYCStatusResponse: Codable {
    let started: Bool
    let status: String
    let kycStatus: String?
    let tosStatus: String?
    let customerId: String?
    let stale: Bool?
    /// Re-surfaced hosted links so the identity + "accept terms" steps stay
    /// reachable while KYC is pending (nil until a link exists).
    let kycUrl: String?
    let tosUrl: String?
}

/// Talise's collapsed KYC status ladder (mirrors the server `OnrampKycStatus`).
enum KYCStatus: String {
    case unverified
    case pending
    case approved
    case rejected
    case expired

    init(_ raw: String?) {
        self = KYCStatus(rawValue: raw ?? "unverified") ?? .unverified
    }

    var label: String {
        switch self {
        case .unverified: return "Not verified"
        case .pending:    return "In review"
        case .approved:   return "Verified"
        case .rejected:   return "Not approved"
        case .expired:    return "Expired"
        }
    }

    /// True while Bridge is still working through identity / ToS — the view
    /// should keep polling.
    var isInFlight: Bool { self == .pending }
}
