import Foundation

/// Thin namespace over Talise's Payroll / Teams payout endpoints.
///
///   • GET    /api/payouts/teams                  → list saved teams
///   • POST   /api/payouts/teams                  → prepare a team save
///   • POST   /api/payouts/teams/record           → finalize an on-chain save
///   • DELETE /api/payouts/teams/{id}             → prepare a team delete
///   • POST   /api/payouts/teams/{id}/record      → finalize an on-chain delete
///   • POST   /api/payouts/batch/prepare          → build a batch payout PTB
///   • POST   /api/payouts/batch/{batchId}/record → record the executed digest
///
/// A "team" is a reusable, on-chain roster (a `payroll::Team` shared object)
/// the user pays together. Save/delete are sponsor-ready Move calls: the server
/// returns `mode: "onchain"` + bytes to sign, then the digest is recorded. When
/// the on-chain path is disabled server-side the same calls return `mode: "db"`
/// and there's nothing to sign (the legacy DB-only flow). Paying a team still
/// goes through the screened `batch/prepare` path — the roster carries no money.
@MainActor
enum PayrollAPI {
    /// List the signed-in user's saved teams (newest server order preserved).
    static func listTeams() async throws -> [TeamDTO] {
        let res: TeamsResponse = try await APIClient.shared.get("/api/payouts/teams")
        return res.teams
    }

    /// Prepare a team save (create or edit). When `mode == "onchain"` the
    /// caller signs `bytes` then calls `recordSaveTeam`; when `mode == "db"`
    /// the `team` is already persisted and there's nothing more to do.
    static func prepareSaveTeam(name: String, members: [TeamMemberDTO]) async throws -> SaveTeamPrepareResponse {
        try await APIClient.shared.post(
            "/api/payouts/teams",
            body: SaveBody(name: name, members: members)
        )
    }

    /// Finalize an on-chain team save with the executed digest. `chainObjectId`
    /// is passed for edits (stable object id); nil for a create (the server
    /// parses the new object id from the digest).
    static func recordSaveTeam(
        digest: String,
        name: String,
        members: [TeamMemberDTO],
        chainObjectId: String?
    ) async throws -> TeamDTO {
        let res: SaveTeamResponse = try await APIClient.shared.post(
            "/api/payouts/teams/record",
            body: RecordSaveBody(digest: digest, name: name, members: members, chainObjectId: chainObjectId)
        )
        return res.team
    }

    /// Prepare a team delete. `mode == "onchain"` → sign `bytes` then call
    /// `recordDeleteTeam`; `mode == "db"` → already removed.
    static func prepareDeleteTeam(id: String) async throws -> DeleteTeamResponse {
        try await APIClient.shared.delete("/api/payouts/teams/\(id)")
    }

    /// Finalize an on-chain team delete (removes the DB row).
    static func recordDeleteTeam(id: String, digest: String) async throws {
        let _: OkResponse = try await APIClient.shared.post(
            "/api/payouts/teams/\(id)/record",
            body: RecordBody(digest: digest)
        )
    }

    /// Build a batch payout. Returns the `batchId` + sponsored `bytes` to
    /// sign and execute (signAndExecuteRaw), plus a recipient/total summary.
    static func prepareBatch(recipients: [BatchRecipient]) async throws -> BatchPrepareResponse {
        try await APIClient.shared.post(
            "/api/payouts/batch/prepare",
            body: PrepareBody(recipients: recipients, asset: "USDsui")
        )
    }

    /// Report the executed transaction digest for a prepared batch.
    static func recordBatch(batchId: String, digest: String) async throws {
        let _: OkResponse = try await APIClient.shared.post(
            "/api/payouts/batch/\(batchId)/record",
            body: RecordBody(digest: digest)
        )
    }
}

// MARK: - DTOs

struct TeamMemberDTO: Codable, Hashable {
    var recipient: String
    var amount: Double?
    var label: String?
}

struct TeamDTO: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let members: [TeamMemberDTO]
    let createdAt: Double?
    let updatedAt: Double?
    /// On-chain Team object id, or nil for a DB-only team.
    let chainObjectId: String?
}

struct BatchRecipient: Codable {
    let to: String
    let amount: Double
    let label: String?
}

struct BatchPrepareResponse: Codable {
    let batchId: String
    let bytes: String
    let recipientCount: Int
    let totalUsd: Double
}

// MARK: - Request / response wrappers

private struct TeamsResponse: Codable {
    let teams: [TeamDTO]
}

private struct SaveBody: Encodable {
    let name: String
    let members: [TeamMemberDTO]
}

/// Response to a save PREPARE. `mode` is "db" (already saved → `team`) or
/// "onchain" (sign `bytes`, then record). `edit`/`chainObjectId` distinguish
/// create vs. edit so the record step can pass the stable object id back.
struct SaveTeamPrepareResponse: Codable {
    let mode: String
    let team: TeamDTO?
    let bytes: String?
    let edit: Bool?
    let chainObjectId: String?
    let name: String?
}

private struct RecordSaveBody: Encodable {
    let digest: String
    let name: String
    let members: [TeamMemberDTO]
    let chainObjectId: String?
}

private struct SaveTeamResponse: Codable {
    let team: TeamDTO
}

/// Response to a delete PREPARE. "db" → already removed; "onchain" → sign
/// `bytes` then record.
struct DeleteTeamResponse: Codable {
    let mode: String?
    let bytes: String?
    let ok: Bool?
    let removed: Bool?
}

private struct PrepareBody: Encodable {
    let recipients: [BatchRecipient]
    let asset: String
}

private struct RecordBody: Encodable {
    let digest: String
}

private struct OkResponse: Codable {
    let ok: Bool?
}
