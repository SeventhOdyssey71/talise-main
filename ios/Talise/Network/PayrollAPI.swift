import Foundation

/// Thin namespace over Talise's Payroll / Teams payout endpoints.
///
///   • GET    /api/payouts/teams                  → list saved teams
///   • POST   /api/payouts/teams                  → upsert a team (by name)
///   • DELETE /api/payouts/teams/{id}             → delete a team
///   • POST   /api/payouts/batch/prepare          → build a batch payout PTB
///   • POST   /api/payouts/batch/{batchId}/record → record the executed digest
///
/// A "team" is a reusable list of recipients (members). Preparing a batch
/// returns sponsored `bytes` to sign + execute, plus a `batchId` to report the
/// resulting digest back to the server once the transaction lands.
@MainActor
enum PayrollAPI {
    /// List the signed-in user's saved teams (newest server order preserved).
    static func listTeams() async throws -> [TeamDTO] {
        let res: TeamsResponse = try await APIClient.shared.get("/api/payouts/teams")
        return res.teams
    }

    /// Create or update a team. Upsert is keyed on `name` server-side.
    static func saveTeam(name: String, members: [TeamMemberDTO]) async throws -> TeamDTO {
        let res: SaveTeamResponse = try await APIClient.shared.post(
            "/api/payouts/teams",
            body: SaveBody(name: name, members: members)
        )
        return res.team
    }

    /// Delete a team by id.
    static func deleteTeam(id: String) async throws {
        let _: OkResponse = try await APIClient.shared.delete("/api/payouts/teams/\(id)")
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

private struct SaveTeamResponse: Codable {
    let team: TeamDTO
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
