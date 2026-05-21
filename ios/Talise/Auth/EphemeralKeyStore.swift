import Foundation
import CryptoKit
import Security
import LocalAuthentication

/// Manages the zkLogin ephemeral keypair. Stored as a SecKey reference in
/// the Secure Enclave with `.privateKeyUsage + .userPresence` — every sign
/// operation triggers Face/Touch ID.
///
/// We can't extract the private key (that's the whole point of the SE).
/// Instead `signRaw(_:)` proxies to `SecKeyCreateSignature` which performs
/// the signing inside the enclave.
///
/// The Sui ZkLoginSignature expects Ed25519 by default, but Secure Enclave
/// only supports P-256. The backend's zkLogin coordinator advertises the
/// ephemeral public key in the same format Sui supports (`SerializedSignature`
/// includes a flag byte: `0x02` for Secp256r1) — so this works end-to-end
/// against the existing prover.
@MainActor
final class EphemeralKeyStore {
    static let shared = EphemeralKeyStore()
    private init() {}

    private let tag = "io.talise.app.ephemeral.v1".data(using: .utf8)!

    enum KeyError: Error {
        case noAccessControl
        case createKey(CFError?)
        case copyPublic
        case sign(CFError?)
        case loadKey(OSStatus)
    }

    func ensureKey() throws -> SecKey {
        if let existing = try? loadKey() { return existing }
        return try createKey()
    }

    private func createKey() throws -> SecKey {
        var aclError: Unmanaged<CFError>?
        guard let acl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.privateKeyUsage, .userPresence],
            &aclError
        ) else {
            throw KeyError.noAccessControl
        }

        let attrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessControl as String: acl,
            ],
        ]

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &error) else {
            throw KeyError.createKey(error?.takeRetainedValue())
        }
        return key
    }

    private func loadKey() throws -> SecKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { throw KeyError.loadKey(status) }
        return item as! SecKey
    }

    func publicKeyRawBytes() throws -> Data {
        let priv = try ensureKey()
        guard let pub = SecKeyCopyPublicKey(priv) else { throw KeyError.copyPublic }
        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(pub, &error) as Data? else {
            throw KeyError.copyPublic
        }
        return data
    }

    /// Signs raw bytes with SHA-256 pre-hash via the Secure Enclave key.
    /// Returns ASN.1-DER ECDSA signature; the network layer converts to
    /// Sui's serialized signature format before submitting.
    func signRaw(_ payload: Data, reason: String) throws -> Data {
        let key = try ensureKey()
        let algorithm: SecKeyAlgorithm = .ecdsaSignatureMessageX962SHA256
        var error: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(
            key,
            algorithm,
            payload as CFData,
            &error
        ) as Data? else {
            throw KeyError.sign(error?.takeRetainedValue())
        }
        return sig
    }

    func wipe() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
