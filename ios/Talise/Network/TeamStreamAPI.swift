import Foundation

/// Team streaming payouts — fund a pot once, then equal shares stream to every
/// team member on an interval, gaslessly, until the schedule is done.
///
/// NON-CUSTODIAL + PERMISSIONLESS, exactly like Rules (`standing_order`): the pot
/// lives in an on-chain `TeamStream` object the creator owns, and each due tranche
/// is released by a permissionless `release_due_tranche` call. There is NO escrow
/// key and NO cron — the creator's open app fires anything due.
///
///   • POST /api/payouts/streams/create-prepare  → sponsor-ready `create` bytes
///   • (sign them: that ONE tx funds the pot + creates the stream, then…)
///   • POST /api/payouts/streams/record          → activate with the digest
///   • GET  /api/payouts/streams                 → list with live progress + `dueNow`
///   • POST /api/payouts/streams/{id}/release    → sponsor-ready release bytes
///   • POST /api/payouts/streams/{id}/released   → record a confirmed release
///   • POST /api/payouts/streams/{id}/cancel     → sponsor-ready cancel bytes
///   • POST /api/payouts/streams/{id}/cancelled  → record the refund
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

    /// Build the Onara-sponsored, PERMISSIONLESS `release_due_tranche` bytes for a
    /// due tranche. Signing them pays every member their equal share; the contract
    /// aborts (ENotDue / EExhausted / ECancelled) if it isn't actually due, so this
    /// is always safe to attempt and can never pay the same tranche twice.
    static func releasePrepare(id: String) async throws -> TeamStreamBytesResponse {
        try await APIClient.shared.post("/api/payouts/streams/\(id)/release", body: EmptyBody())
    }

    /// Record a confirmed on-chain release (advances the display mirror).
    static func recordReleased(id: String, digest: String) async throws -> TeamStreamDTO {
        let res: StreamResponse = try await APIClient.shared.post(
            "/api/payouts/streams/\(id)/released",
            body: DigestBody(digest: digest)
        )
        return res.stream
    }

    /// Build the creator-signed `cancel` bytes: stops the stream and refunds the
    /// whole remaining pot (unreleased payouts + rounding dust) in the same tx.
    static func cancelPrepare(id: String) async throws -> TeamStreamBytesResponse {
        try await APIClient.shared.post("/api/payouts/streams/\(id)/cancel", body: EmptyBody())
    }

    /// Record the confirmed cancel/refund.
    static func recordCancelled(id: String, digest: String) async throws -> TeamStreamDTO {
        let res: StreamResponse = try await APIClient.shared.post(
            "/api/payouts/streams/\(id)/cancelled",
            body: DigestBody(digest: digest)
        )
        return res.stream
    }
}

// MARK: - DTOs

struct TeamStreamMemberDTO: Codable, Hashable {
    let address: String
    let handle: String?
}

/// Sponsor-ready `team_stream::create` bytes plus the drafted split preview.
struct TeamStreamPrepareResponse: Codable {
    let mode: String?
    let streamId: String
    let bytes: String
    let firstDueMs: Double?
    let totalUsd: Double
    let perMemberUsd: Double
    let trancheUsd: Double
    /// Rounding remainder the schedule can't pay out; refunded on cancel.
    let dustUsd: Double?
    let numTranches: Int
    let memberCount: Int
    let intervalMs: Double
}

/// Sponsor-ready bytes for a release / cancel. `mode == "recorded"` means there was
/// nothing on chain to sign (a draft or a legacy escrow-era row).
struct TeamStreamBytesResponse: Codable {
    let mode: String?
    let bytes: String?
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
    let dustUsd: Double?
    let intervalMs: Double
    let startMs: Double
    let nextTrancheAt: Double
    let state: String
    let fundingDigest: String?
    /// The on-chain object holding the pot (`nil` ⇒ draft or legacy escrow row).
    let streamObjectId: String?
    /// Pre-on-chain escrow-era stream: never fired by the app-open trigger.
    let legacy: Bool?
    /// A tranche is due right now.
    let dueNow: Bool?
    let createdAt: Double

    var progress: Double { numTranches > 0 ? Double(tranchesDone) / Double(numTranches) : 0 }
    var isActive: Bool { state == "active" }
    /// Safe to fire the permissionless release for.
    var isFireable: Bool { isActive && legacy != true && streamObjectId != nil }
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

private struct DigestBody: Encodable {
    let digest: String
}

private struct EmptyBody: Encodable {}

private struct StreamResponse: Codable { let stream: TeamStreamDTO }
private struct StreamsResponse: Codable { let streams: [TeamStreamDTO] }
