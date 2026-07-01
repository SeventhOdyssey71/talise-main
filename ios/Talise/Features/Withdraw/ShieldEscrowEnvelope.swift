// ShieldEscrowEnvelope.swift
//
// NON-CUSTODIAL note-master escrow envelope — Swift port of
// web/lib/shield/sdk/escrow-wrap.ts. Wraps the shielded-pool note master under
// a user-held recovery code so the escrow server (/api/shield/key-escrow)
// stores a blob it cannot open.
//
//   "tsw1:" ‖ base64( salt(16) ‖ iv(12) ‖ ciphertext+tag )
//   wrapKey = PBKDF2-SHA256(recoveryCode, salt, 600_000) → AES-256
//   ct,tag  = AES-256-GCM(wrapKey, iv, noteMaster)
//
// FUND-SAFETY: this MUST stay byte-compatible with the TypeScript envelope, or a
// master wrapped on one platform is UNRECOVERABLE on another. The cross-language
// Known-Answer Test (TaliseTests/ShieldEscrowEnvelopeTests.swift, mirroring
// web/__tests__/sui/shield-escrow-wrap.test.ts) pins the format: it unwraps a
// fixed envelope to a known master. Do not change PBKDF2 params, byte layout,
// base64 mode, or normalization without updating BOTH sides and the KAT.
//
// STATUS: NOT YET WIRED. ShieldKeyStore still escrows plaintext. The cutover
// (wrap on backup + show recovery code, unwrap on restore) is enabled only after
// this passes the KAT on a real build. Until then this file changes no behavior.

import Foundation
import CryptoKit
import CommonCrypto

enum ShieldEscrowError: Error {
    case notAnEnvelope
    case tooShort
    case badBase64
    case masterTooShort
    case codeTooShort
    case pbkdf2Failed
}

enum ShieldEscrowEnvelope {
    static let prefix = "tsw1:"

    private static let saltLen = 16
    private static let ivLen = 12
    private static let tagLen = 16
    /// OWASP-2023 floor for PBKDF2-HMAC-SHA256. Must equal the TS `PBKDF2_ITERS`.
    private static let pbkdf2Iters = 600_000

    // Crockford base32 (no I/L/O/U) — matches the TS alphabet.
    private static let crockford = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    /// True iff `s` is a wrapped envelope (vs. a legacy plaintext-hex master).
    static func isWrapped(_ s: String) -> Bool { s.hasPrefix(prefix) }

    /// Canonicalize a recovery code for key derivation. MUST match the TS
    /// `normalizeRecoveryCode`: uppercase, strip spaces/dashes, then I/L→1, O→0.
    static func normalizeRecoveryCode(_ code: String) -> String {
        var s = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        s = s.components(separatedBy: CharacterSet(charactersIn: " \t\n\r-")).joined()
        s = s.replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "L", with: "1")
            .replacingOccurrences(of: "O", with: "0")
        return s
    }

    /// Generate a 128-bit recovery code as grouped Crockford base32.
    /// Self-consistent (round-trips on this device); shown to the user once.
    static func generateRecoveryCode() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        var out = ""
        var value = 0
        var bits = 0
        for b in bytes {
            value = (value << 8) | Int(b)
            bits += 8
            while bits >= 5 {
                let idx = (value >> (bits - 5)) & 31
                out.append(crockford[idx])
                bits -= 5
                value &= (1 << bits) - 1 // drop consumed high bits
            }
        }
        if bits > 0 {
            out.append(crockford[(value << (5 - bits)) & 31])
        }
        // Group into blocks of 4 with dashes.
        var grouped = ""
        for (i, ch) in out.enumerated() {
            if i > 0 && i % 4 == 0 { grouped.append("-") }
            grouped.append(ch)
        }
        return grouped
    }

    /// Unwrap an escrow envelope with the recovery code. Throws on a wrong code
    /// (GCM auth failure) or corrupt blob. Pure inverse of `wrap`.
    static func unwrap(envelope: String, recoveryCode: String) throws -> Data {
        guard isWrapped(envelope) else { throw ShieldEscrowError.notAnEnvelope }
        let b64 = String(envelope.dropFirst(prefix.count))
        guard let blob = Data(base64Encoded: b64) else { throw ShieldEscrowError.badBase64 }
        guard blob.count > saltLen + ivLen + tagLen else { throw ShieldEscrowError.tooShort }

        let salt = blob.subdata(in: 0..<saltLen)
        let iv = blob.subdata(in: saltLen..<(saltLen + ivLen))
        let ctTag = blob.subdata(in: (saltLen + ivLen)..<blob.count)
        let ct = ctTag.subdata(in: 0..<(ctTag.count - tagLen))
        let tag = ctTag.subdata(in: (ctTag.count - tagLen)..<ctTag.count)

        let key = try deriveKey(recoveryCode: recoveryCode, salt: salt)
        let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: iv), ciphertext: ct, tag: tag)
        return try AES.GCM.open(box, using: key)
    }

    /// Wrap a note master under a recovery code → versioned envelope string.
    /// Fresh random salt + iv per call.
    static func wrap(noteMaster: Data, recoveryCode: String) throws -> String {
        guard noteMaster.count >= 16 else { throw ShieldEscrowError.masterTooShort }
        guard normalizeRecoveryCode(recoveryCode).count >= 16 else { throw ShieldEscrowError.codeTooShort }

        var saltBytes = [UInt8](repeating: 0, count: saltLen)
        _ = SecRandomCopyBytes(kSecRandomDefault, saltLen, &saltBytes)
        var ivBytes = [UInt8](repeating: 0, count: ivLen)
        _ = SecRandomCopyBytes(kSecRandomDefault, ivLen, &ivBytes)
        let salt = Data(saltBytes)
        let iv = Data(ivBytes)

        let key = try deriveKey(recoveryCode: recoveryCode, salt: salt)
        let sealed = try AES.GCM.seal(noteMaster, using: key, nonce: try AES.GCM.Nonce(data: iv))

        var blob = Data()
        blob.append(salt)
        blob.append(iv)
        blob.append(sealed.ciphertext)
        blob.append(sealed.tag)
        return prefix + blob.base64EncodedString()
    }

    // MARK: - PBKDF2

    private static func deriveKey(recoveryCode: String, salt: Data) throws -> SymmetricKey {
        let pw = Array(normalizeRecoveryCode(recoveryCode).utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let status = salt.withUnsafeBytes { saltPtr -> Int32 in
            pw.withUnsafeBytes { pwPtr in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    pwPtr.baseAddress!.assumingMemoryBound(to: CChar.self),
                    pw.count,
                    saltPtr.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    UInt32(pbkdf2Iters),
                    &derived,
                    derived.count
                )
            }
        }
        guard status == kCCSuccess else { throw ShieldEscrowError.pbkdf2Failed }
        return SymmetricKey(data: Data(derived))
    }
}
