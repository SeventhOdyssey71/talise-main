import Foundation
import CryptoKit
import Security

/// Client-side codec + device key for the Talise Agent's server-blind memory.
///
/// This is the iOS mirror of `web/lib/agent/memory.ts`. The Talise server,
/// Postgres, and Walrus nodes only ever see CIPHERTEXT + a blob pointer — the
/// 32-byte encryption key is created on-device and NEVER leaves it (Keychain,
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, no iCloud sync).
///
/// **Blob format (byte-for-byte identical to the web codec):**
///   `[0x10 | iv(12) | ciphertext | tag(16)]`, AES-256-GCM, fresh random IV per
///   write. CryptoKit's `AES.GCM.SealedBox` already lays out
///   `nonce(12) | ciphertext | tag(16)`, so the sealed bytes are simply the
///   version byte `0x10` prepended to `sealedBox.combined`.
///
/// NOTE: not yet wired into `ChatViewModel` — the integrator owns that.

// MARK: - Data model (matches the shared contract exactly)

enum MemoryFactType: String, Codable, Hashable {
    case payee
    case preference
    case goal
    case localCurrency = "local-currency"
    case activitySummary = "activity-summary"
}

struct MemoryFact: Codable, Hashable {
    var type: MemoryFactType
    var key: String
    var value: String
    /// Epoch milliseconds (matches the web codec's `Date.now()` timestamps).
    var ts: Double
    var confidence: Double?
}

struct MemoryDoc: Codable {
    /// Always `1` — the document schema version (distinct from the 0x10 blob
    /// version byte, which lives in the encrypted envelope, not the JSON).
    var version: Int
    var facts: [MemoryFact]

    static func empty() -> MemoryDoc { MemoryDoc(version: 1, facts: []) }
}

// MARK: - Codec

enum MemoryCodec {
    /// First byte of every sealed blob. New version byte reserved for memory
    /// (distinct from cheque-note's 0x01).
    static let version: UInt8 = 0x10

    enum CodecError: Error {
        case badVersion(UInt8)
        case truncated
        case decodeFailed
    }

    /// Produces `[0x10 | iv(12) | ciphertext | tag(16)]`.
    static func encryptDoc(_ doc: MemoryDoc, key: SymmetricKey) throws -> Data {
        let plaintext = try JSONEncoder().encode(doc)
        // 12-byte nonce is CryptoKit's default for AES.GCM.Nonce().
        let sealed = try AES.GCM.seal(plaintext, using: key)
        // `combined` is nonce(12) | ciphertext | tag(16).
        guard let combined = sealed.combined else { throw CodecError.decodeFailed }
        var out = Data([version])
        out.append(combined)
        return out
    }

    /// Parses `[0x10 | iv(12) | ciphertext | tag(16)]` back into a MemoryDoc.
    static func decryptDoc(_ blob: Data, key: SymmetricKey) throws -> MemoryDoc {
        guard let first = blob.first else { throw CodecError.truncated }
        guard first == version else { throw CodecError.badVersion(first) }
        // Drop the version byte; the remainder is the CryptoKit combined box.
        // Minimum viable body: 12 (nonce) + 0 (ct) + 16 (tag) = 28 bytes.
        let body = blob.dropFirst()
        guard body.count >= 28 else { throw CodecError.truncated }
        let sealed = try AES.GCM.SealedBox(combined: Data(body))
        let plaintext = try AES.GCM.open(sealed, using: key)
        return try JSONDecoder().decode(MemoryDoc.self, from: plaintext)
    }

    /// Dedup by `(type + key)`, keep the newest `ts`, cap at 60 facts (newest
    /// first). Mirrors `mergeFacts` in the web codec.
    static func mergeFacts(_ doc: MemoryDoc, incoming: [MemoryFact]) -> MemoryDoc {
        var byKey: [String: MemoryFact] = [:]
        for fact in doc.facts + incoming {
            let id = "\(fact.type.rawValue)\u{0}\(fact.key)"
            if let existing = byKey[id], existing.ts >= fact.ts { continue }
            byKey[id] = fact
        }
        let merged = byKey.values
            .sorted { $0.ts > $1.ts }
            .prefix(60)
        return MemoryDoc(version: 1, facts: Array(merged))
    }

    /// Human-readable lines for prompt injection, e.g. `"payee: mum = mum@talise"`.
    static func factsToLines(_ doc: MemoryDoc, max: Int = 60) -> [String] {
        doc.facts
            .prefix(max)
            .map { "\($0.type.rawValue): \($0.key) = \($0.value)" }
    }
}

// MARK: - Device key (Keychain-backed, never leaves device)

/// Creates and persists a 32-byte raw AES-256 key in the Keychain. The key is
/// minted once on first use and reused thereafter; it is accessible only after
/// the first device unlock and is `ThisDeviceOnly` (no iCloud Keychain sync).
@MainActor
final class DeviceMemoryKey {
    static let shared = DeviceMemoryKey()
    private init() {}

    private let service = "io.talise.app.agent.memory"
    private let account = "v1"

    enum KeyError: Error {
        case keychainWrite(OSStatus)
        case randomFailed
    }

    /// Returns the device memory key as a CryptoKit `SymmetricKey`, creating +
    /// persisting a fresh 32-byte key on first call.
    func loadOrCreate() throws -> SymmetricKey {
        if let raw = readRaw(), raw.count == 32 {
            return SymmetricKey(data: raw)
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess
        else { throw KeyError.randomFailed }
        let raw = Data(bytes)
        try writeRaw(raw)
        return SymmetricKey(data: raw)
    }

    /// Deletes the stored key (e.g. on sign-out / memory reset). All previously
    /// stored blobs become permanently undecryptable — by design.
    func wipe() {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(q as CFDictionary)
    }

    // MARK: Keychain primitives

    private func writeRaw(_ data: Data) throws {
        let delete: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(delete as CFDictionary)

        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeyError.keychainWrite(status) }
    }

    private func readRaw() -> Data? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return data
    }
}

// MARK: - Memory block parser

/// Extracts facts from a `---MEMORY---{json}---END---` fence emitted by the
/// agent (sibling to the `---INTENT---…---END---` fence parsed in
/// `AgentIntentParser`). The fenced body is the JSON encoding of a `MemoryDoc`'s
/// `facts` array. Returns `[]` on a missing or malformed block (never throws).
enum MemoryBlockParser {
    private static let fence = try! NSRegularExpression(
        pattern: "---MEMORY---\\s*([\\s\\S]*?)\\s*---END---",
        options: []
    )

    static func parseMemoryBlock(_ raw: String) -> [MemoryFact] {
        let ns = raw as NSString
        guard
            let match = fence.firstMatch(
                in: raw, options: [], range: NSRange(location: 0, length: ns.length)
            ),
            match.numberOfRanges >= 2
        else { return [] }

        let json = ns
            .substring(with: match.range(at: 1))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = json.data(using: .utf8) else { return [] }

        // Tolerate either a bare facts array or a full MemoryDoc envelope.
        let decoder = JSONDecoder()
        if let facts = try? decoder.decode([MemoryFact].self, from: data) {
            return facts
        }
        if let doc = try? decoder.decode(MemoryDoc.self, from: data) {
            return doc.facts
        }
        return []
    }
}
