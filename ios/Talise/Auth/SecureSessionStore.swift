import Foundation
import Security
import LocalAuthentication

/// Stores the mobile bearer token issued by /api/auth/mobile/token.
///
/// Storage: Keychain `kSecClassGenericPassword` with
/// `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` and an access control
/// requiring `.biometryCurrentSet`. Loss of biometric enrollment (new face,
/// new fingerprint) invalidates the token — the user re-authenticates with
/// Google. The token itself is short-lived (24h) and rotated server-side.
@MainActor
final class SecureSessionStore {
    static let shared = SecureSessionStore()
    private init() {}

    private let service = "io.talise.app.session"
    private let account = "bearer"

    enum StoreError: Error {
        case acl
        case write(OSStatus)
        case read(OSStatus)
        case noBiometry
    }

    func save(token: String) throws {
        guard let data = token.data(using: .utf8) else { throw StoreError.acl }

        var aclError: Unmanaged<CFError>?
        guard let acl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.biometryCurrentSet],
            &aclError
        ) else {
            throw StoreError.acl
        }

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
            kSecAttrAccessControl as String: acl,
            kSecValueData as String: data,
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw StoreError.write(status) }
    }

    func read(reason: String = "Unlock Talise") throws -> String {
        let ctx = LAContext()
        ctx.localizedReason = reason

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: ctx,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else {
            throw StoreError.read(status)
        }
        return token
    }

    func clear() {
        let delete: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(delete as CFDictionary)
    }

    /// Cheap, non-prompting check used to decide whether to show SignInView.
    func hasToken() -> Bool {
        let ctx = LAContext()
        ctx.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: ctx,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }
}
