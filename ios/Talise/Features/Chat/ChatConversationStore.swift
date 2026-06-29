import Foundation
import Security

/// A saved agent conversation — a titled transcript with a timestamp. The
/// successor to the single-blob `ChatHistoryStore`: instead of one endless
/// transcript that piles up across sessions, each chat is its own entry,
/// reachable from the history drawer. "New chat" starts a fresh one.
struct ChatConversation: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var messages: [ChatMessage]
    var updatedAt: Date

    init(id: UUID = UUID(), title: String = "New chat", messages: [ChatMessage] = [], updatedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.messages = messages
        self.updatedAt = updatedAt
    }
}

/// Keychain-backed store for the agent's conversations (same on-device,
/// no-iCloud guarantee as the bearer + the old transcript). One generic-password
/// item holds a JSON array of `ChatConversation`, newest-first, capped.
@MainActor
final class ChatConversationStore {
    static let shared = ChatConversationStore()
    private init() {}

    /// Keep the most recent N conversations; older ones drop off.
    static let conversationCap = 40
    /// Cap messages per conversation so the blob stays small.
    static let messageCap = 60

    private let service = "io.talise.chat.conversations"
    private let account = "all"

    func loadAll() -> [ChatConversation] {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return [] }
        let all = (try? JSONDecoder().decode([ChatConversation].self, from: data)) ?? []
        return all.sorted { $0.updatedAt > $1.updatedAt }
    }

    func saveAll(_ conversations: [ChatConversation]) {
        // Newest-first, capped; trim each transcript to the message cap.
        let trimmed = conversations
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(Self.conversationCap)
            .map { c -> ChatConversation in
                var c = c
                c.messages = Array(c.messages.suffix(Self.messageCap))
                return c
            }
        guard let data = try? JSONEncoder().encode(Array(trimmed)) else { return }

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
        SecItemAdd(add as CFDictionary, nil)
    }
}
