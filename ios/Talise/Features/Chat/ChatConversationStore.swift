import Foundation
import Security

/// A saved agent conversation — a titled transcript with a timestamp. Powers the
/// compact history sheet so past chats are one tap away without piling up into
/// one endless transcript (the agent always opens on a fresh chat).
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

/// Keychain-backed store for the agent's conversations (on-device, no iCloud —
/// same guarantee as the bearer). One generic-password item holds a JSON array
/// of `ChatConversation`, newest-first, capped.
@MainActor
final class ChatConversationStore {
    static let shared = ChatConversationStore()
    private init() {}

    static let conversationCap = 30
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
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return [] }
        let all = (try? JSONDecoder().decode([ChatConversation].self, from: data)) ?? []
        return all.sorted { $0.updatedAt > $1.updatedAt }
    }

    func saveAll(_ conversations: [ChatConversation]) {
        let trimmed = conversations
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(Self.conversationCap)
            .map { c -> ChatConversation in
                var c = c
                c.messages = Array(c.messages.suffix(Self.messageCap))
                return c
            }
        guard let data = try? JSONEncoder().encode(Array(trimmed)) else { return }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}
