import Foundation

/// Team streaming payouts — fund a pot once, then equal shares stream to every
/// team member on an interval, gaslessly, until the pot is exhausted.
///
///   • POST /api/payouts/streams/create-prepare → draft + escrow address to fund
///   • (fund the escrow via the normal gasless send, then…)
///   • POST /api/payouts/streams/record            → activate with the funding digest
///   • GET  /api/payouts/streams                   → list with live progress
///   • POST /api/payouts/streams/{id}/cancel       → stop + refund the remainder
@MainActor
enum TeamStreamAPI {
    static func createPrepare(
        teamId: String,
        totalUsd: Double,
        numTranches: Int,
        intervalMinutes: Int
    ) async throws -> TeamStreamPrepareResponse {
        try await APIClient.shared.post(
            "/api/payouts/streams/create-prepare",
            body: CreateBody(teamId: teamId, totalUsd: totalUsd, numTranches: numTranches, intervalMinutes: intervalMinutes)
        )
    }

    static func record(streamId: String, digest: String) async throws -> TeamStreamDTO {
        let res: StreamResponse = try await APIClient.shared.post(
            "/api/payouts/streams/record",
            body: RecordBody(streamId: streamId, digest: digest)
        )
        return res.stream
    }

    static func list() async throws -> [TeamStreamDTO] {
        let res: StreamsResponse = try await APIClient.shared.get("/api/payouts/streams")
        return res.streams
    }

    static func cancel(id: String) async throws -> TeamStreamDTO {
        let res: StreamResponse = try await APIClient.shared.post(
            "/api/payouts/streams/\(id)/cancel",
            body: EmptyBody()
        )
        return res.stream
    }
}

// MARK: - DTOs

struct TeamStreamMemberDTO: Codable, Hashable {
    let address: String
    let handle: String?
}

struct TeamStreamPrepareResponse: Codable {
    let streamId: String
    let escrowAddress: String
    let totalUsd: Double
    let perMemberUsd: Double
    let trancheUsd: Double
    let numTranches: Int
    let memberCount: Int
    let intervalMs: Double
}

struct TeamStreamDTO: Codable, Identifiable, Hashable {
    let id: String
    let teamId: String?
    let teamName: String
    let members: [TeamStreamMemberDTO]
    let memberCount: Int
    let totalUsd: Double
    let trancheUsd: Double
    let perMemberUsd: Double
    let numTranches: Int
    let tranchesDone: Int
    let releasedUsd: Double
    let intervalMs: Double
    let startMs: Double
    let nextTrancheAt: Double
    let state: String
    let fundingDigest: String?
    let createdAt: Double

    var progress: Double { numTranches > 0 ? Double(tranchesDone) / Double(numTranches) : 0 }
    var isActive: Bool { state == "active" }
}

// MARK: - Request / response wrappers

private struct CreateBody: Encodable {
    let teamId: String
    let totalUsd: Double
    let numTranches: Int
    let intervalMinutes: Int
}

private struct RecordBody: Encodable {
    let streamId: String
    let digest: String
}

private struct EmptyBody: Encodable {}

private struct StreamResponse: Codable { let stream: TeamStreamDTO }
private struct StreamsResponse: Codable { let streams: [TeamStreamDTO] }
