// ShieldEscrowEnvelopeTests.swift
//
// Cross-language parity for the non-custodial escrow envelope. The KAT here is
// the SAME fixed vector asserted in web/__tests__/sui/shield-escrow-wrap.test.ts:
// if this test fails, the Swift envelope has diverged from the TypeScript one and
// a master wrapped on one platform would be UNRECOVERABLE on the other. Do not
// "fix" it by editing the vector — fix the implementation.

import XCTest
import Foundation
@testable import Talise

final class ShieldEscrowEnvelopeTests: XCTestCase {
    /// The known master: bytes 0x00, 0x01, …, 0x1f.
    private var knownMaster: Data { Data((0..<32).map { UInt8($0) }) }

    /// KAT — the load-bearing cross-language check. This exact envelope was
    /// produced by the TypeScript `wrapNoteMaster` and MUST unwrap here to the
    /// same master, proving PBKDF2 params, byte layout, base64 mode, and AES-GCM
    /// mode all match.
    func testKATUnwrapsToKnownMaster() throws {
        let envelope = "tsw1:2fmbARUfLw+TztUET80RepW88CERwviuUhxs4ZzALxmzCMozhymHwU+NTu/Lbc+/qwsAn/EnjdpnMqYk2+i+BlmJNUaU3c2WTvLqYw=="
        let code = "TALISE-KAT-CODE-0001"
        let back = try ShieldEscrowEnvelope.unwrap(envelope: envelope, recoveryCode: code)
        XCTAssertEqual(back, knownMaster)
    }

    func testRoundTrip() throws {
        let code = ShieldEscrowEnvelope.generateRecoveryCode()
        let env = try ShieldEscrowEnvelope.wrap(noteMaster: knownMaster, recoveryCode: code)
        XCTAssertTrue(ShieldEscrowEnvelope.isWrapped(env))
        let back = try ShieldEscrowEnvelope.unwrap(envelope: env, recoveryCode: code)
        XCTAssertEqual(back, knownMaster)
    }

    func testWrongCodeThrows() throws {
        let env = try ShieldEscrowEnvelope.wrap(
            noteMaster: knownMaster,
            recoveryCode: ShieldEscrowEnvelope.generateRecoveryCode()
        )
        XCTAssertThrowsError(
            try ShieldEscrowEnvelope.unwrap(
                envelope: env,
                recoveryCode: ShieldEscrowEnvelope.generateRecoveryCode()
            )
        )
    }

    func testNormalizeMatchesTS() {
        XCTAssertEqual(ShieldEscrowEnvelope.normalizeRecoveryCode("il-o o"), "1100")
        XCTAssertEqual(ShieldEscrowEnvelope.normalizeRecoveryCode("A1B2-C3D4"), "A1B2C3D4")
    }

    func testMessyCodeStillUnwraps() throws {
        // The KAT code typed with lowercase and spaces instead of the exact form
        // must still open the KAT envelope (normalization parity).
        let envelope = "tsw1:2fmbARUfLw+TztUET80RepW88CERwviuUhxs4ZzALxmzCMozhymHwU+NTu/Lbc+/qwsAn/EnjdpnMqYk2+i+BlmJNUaU3c2WTvLqYw=="
        let messy = "  talise kat code 0001 "
        let back = try ShieldEscrowEnvelope.unwrap(envelope: envelope, recoveryCode: messy)
        XCTAssertEqual(back, knownMaster)
    }

    func testIsWrappedDiscriminator() {
        XCTAssertTrue(ShieldEscrowEnvelope.isWrapped("tsw1:abc"))
        XCTAssertFalse(ShieldEscrowEnvelope.isWrapped(String(repeating: "a", count: 64)))
        XCTAssertFalse(ShieldEscrowEnvelope.isWrapped(""))
    }
}
