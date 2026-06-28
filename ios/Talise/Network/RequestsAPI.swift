import Foundation

/// Payment requests — "ask anyone for $X". The inverse of a cheque: instead of
/// handing money out, you mint a shareable link (talise.io/req/<id>) that the
/// payer opens to pay you. The funds aren't escrowed — settlement is a direct
/// USDsui payment to the requester, verified on-chain.
///
///   • POST   /api/requests       → create { amountUsd, currency?, note? }
///                                   → { ok, request, payUrl }
///   • GET    /api/requests       → list mine, newest first
///   • DELETE /api/requests/{id}  → cancel an open request
@MainActor
enum RequestsAPI {
    /// Create a payment request. `note` is an optional private message
    /// (encrypted server-side); `currency` is a DISPLAY denomination only — the
    /// canonical settle figure is always `amountUsd`.
    static func create(amountUsd: Double, currency: String? = nil, note: String? = nil) async throws -> RequestCreateResponse {
        try await APIClient.shared.post(
            "/api/requests",
            body: CreateBody(amountUsd: amountUsd, currency: currency, note: note)
        )
    }

    /// List the caller's requests (newest first).
    static func list() async throws -> [RequestDTO] {
        let res: RequestsResponse = try await APIClient.shared.get("/api/requests")
        return res.requests
    }

    /// Cancel an open request (owner-only; a paid request can't be cancelled).
    static func cancel(id: String) async throws {
        let _: CancelResponse = try await APIClient.shared.delete("/api/requests/\(id)")
    }
}

// MARK: - DTOs

/// Mirrors `WorkRequest` from web/lib/requests.ts. Optional fields tolerate a
/// leaner server shape.
struct RequestDTO: Codable, Identifiable, Hashable {
    let id: String
    let amountUsd: Double
    let currency: String
    let requesterNote: String?
    let status: String
    let expiresAt: Double?
    let createdAt: Double?
    let paidAt: Double?
    let payDigest: String?

    var isOpen: Bool { status == "open" }
    var isPaid: Bool { status == "paid" }

    /// The public pay link for this request (talise.io/req/<id>). The create
    /// response carries an authoritative `payUrl`; this is a stable fallback
    /// for rows loaded from the list.
    var payUrl: String { "https://www.talise.io/req/\(id)" }
}

struct RequestCreateResponse: Codable {
    let ok: Bool
    let request: RequestDTO
    let payUrl: String
}

// MARK: - Request / response wrappers

private struct CreateBody: Encodable {
    let amountUsd: Double
    let currency: String?
    let note: String?
}

private struct RequestsResponse: Codable { let requests: [RequestDTO] }
private struct CancelResponse: Codable { let ok: Bool?; let status: String? }
