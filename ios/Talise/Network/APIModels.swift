import Foundation

/// Typed shapes for the Talise backend endpoints we consume from iOS.
/// Keep in sync with /web/app/api/* response shapes.

enum AccountType: String, Codable {
    case personal
    case business
}

struct UserDTO: Codable, Hashable {
    let id: String
    let email: String
    let name: String?
    let picture: String?
    let country: String?
    let suiAddress: String
    let accountType: AccountType?
    let businessName: String?
    let businessHandle: String?
}

struct EpochDTO: Codable {
    let epoch: Int
    let maxEpoch: Int
}

struct ZkProofRequest: Codable {
    let ephemeralPubKeyB64: String
    let maxEpoch: Int
    let randomness: String
}

struct ZkProofResponse: Codable {
    let proof: AnyCodable
}

struct RecipientResolution: Codable {
    let address: String
    /// Web endpoint returns `displayName`; some callers may use `display`.
    let displayName: String?
    let display: String?
    let source: String?

    var displayString: String {
        displayName ?? display ?? address
    }
}

struct BalancesDTO: Codable {
    let address: String
    let usdsui: Double
    let sui: Double
    let suiPriceUsd: Double
    let totalUsd: Double
}

struct ActivityEntryDTO: Codable, Identifiable {
    let digest: String
    let timestampMs: Double
    let direction: String   // "sent" | "received"
    let amountUsdsui: Double?
    let amountSui: Double?
    let counterparty: String?
    let counterpartyName: String?

    var id: String { digest }
    var isReceived: Bool { direction == "received" }
}

struct ActivityResponse: Codable {
    let entries: [ActivityEntryDTO]
}

struct SendBuildRequest: Codable {
    let to: String
    let amount: Double
    let asset: String
}

struct BuildKindResponse: Codable {
    let transactionKindB64: String
}

struct SupplyBuildRequest: Codable {
    let venue: String
    let amount: Double
}

struct ContactDTO: Codable, Identifiable {
    let address: String
    let name: String?
    let lastSeenMs: Double
    let sentCount: Int
    let receivedCount: Int

    var id: String { address }
    var display: String {
        name ?? Self.short(address)
    }
    private static func short(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }
}

struct ContactsResponse: Codable {
    let contacts: [ContactDTO]
}

struct UsernameClaimResponse: Codable {
    let ok: Bool?
    let username: String?
    let digest: String?
    let subnameNftId: String?
    let error: String?
}

struct YieldVenue: Codable, Identifiable {
    var id: String { venue }
    let venue: String
    let apy: Double
    let supplied: Double?
    let pendingRewards: Double?
}

struct YieldComparison: Codable {
    let venues: [YieldVenue]
    let best: YieldVenue?
}

struct RewardsSummary: Codable {
    let code: String
    let pointsTotal: Int
    let referralCount: Int
    let recentEvents: [RewardsEvent]
}

struct RewardsEvent: Codable, Identifiable {
    let id: String
    let kind: String
    let points: Int
    let createdAt: String
}

struct SponsorRequest: Codable {
    let ptbBytesB64: String
    let sender: String
    let cachedProof: AnyCodable?
}

struct SponsorResponse: Codable {
    let txBytes: String
    let sponsorSignature: String
    let expiryEpoch: Int
}

struct SponsorExecuteRequest: Codable {
    let txBytes: String
    let userSignature: String
    let sponsorSignature: String
    let kind: String?
}

struct SponsorExecuteResponse: Codable {
    let digest: String
    let success: Bool
    let error: String?
}

/// Minimal AnyCodable for shapes the backend returns as freeform JSON
/// (e.g. the zkLogin proof object). We don't introspect the structure.
struct AnyCodable: Codable {
    let raw: Data

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self.raw = "null".data(using: .utf8)!
        } else if let v = try? container.decode([String: AnyCodable].self) {
            self.raw = try JSONEncoder().encode(v)
        } else if let v = try? container.decode([AnyCodable].self) {
            self.raw = try JSONEncoder().encode(v)
        } else if let v = try? container.decode(String.self) {
            self.raw = try JSONEncoder().encode(v)
        } else if let v = try? container.decode(Double.self) {
            self.raw = try JSONEncoder().encode(v)
        } else if let v = try? container.decode(Bool.self) {
            self.raw = try JSONEncoder().encode(v)
        } else {
            self.raw = "null".data(using: .utf8)!
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        let any = try JSONSerialization.jsonObject(with: raw, options: [.fragmentsAllowed])
        let data = try JSONSerialization.data(withJSONObject: any, options: [.fragmentsAllowed])
        try container.encode(String(data: data, encoding: .utf8) ?? "null")
    }
}
