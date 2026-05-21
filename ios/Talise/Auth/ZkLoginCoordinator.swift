import Foundation

/// Orchestrates the sign+sponsor+execute pipeline. Kept deliberately
/// stack-free so each call is auditable.
///
/// Flow (sponsored — works today against existing /api/zk/sponsor):
///   1. caller builds raw PTB bytes (SuiKit `TransactionBlock` → bytes)
///   2. POST /api/zk/sponsor → { txBytes, sponsorSignature }
///   3. EphemeralKeyStore.signRaw(txBytes, reason: "<intent>")
///   4. assemble zkLogin SerializedSignature from the proof+addressSeed
///      cached server-side (server returns `userSignature` shape from
///      /api/zk/sponsor-execute upon submission of our signature parts)
///   5. POST /api/zk/sponsor-execute → { digest }
///
/// Flow (gasless — to wire after May 20 announcement verified on testnet):
///   1. caller builds raw PTB bytes
///   2. App sets gas_price=0, signs locally, submits direct to Sui RPC
///   3. on failure, fall back to sponsored path
@MainActor
final class ZkLoginCoordinator {
    static let shared = ZkLoginCoordinator()
    private init() {}

    struct SignedSubmission {
        let digest: String
    }

    enum CoordinatorError: Error {
        case missingEphemeralKey
        case sponsorFailed(String)
        case executeFailed(String)
    }

    /// Sign + sponsor + execute. `intent` is shown in the Face ID prompt
    /// (e.g. "Send 25 USDsui to alice.talise.sui").
    func signAndSubmit(
        ptbBytesB64: String,
        sender: String,
        kind: String,
        intent: String
    ) async throws -> SignedSubmission {
        // 1. ask backend to sponsor
        let sponsorReq = SponsorRequest(
            ptbBytesB64: ptbBytesB64,
            sender: sender,
            cachedProof: nil
        )
        let sponsor: SponsorResponse = try await APIClient.shared.post(
            "/api/zk/sponsor",
            body: sponsorReq
        )

        // 2. user signs the sponsored tx bytes locally (Face ID prompt)
        guard let txBytesData = Data(base64Encoded: sponsor.txBytes) else {
            throw CoordinatorError.sponsorFailed("bad txBytes")
        }
        let userSig = try EphemeralKeyStore.shared.signRaw(txBytesData, reason: intent)

        // 3. submit
        let execReq = SponsorExecuteRequest(
            txBytes: sponsor.txBytes,
            userSignature: userSig.base64EncodedString(),
            sponsorSignature: sponsor.sponsorSignature,
            kind: kind
        )
        let exec: SponsorExecuteResponse = try await APIClient.shared.post(
            "/api/zk/sponsor-execute",
            body: execReq
        )
        if !exec.success {
            throw CoordinatorError.executeFailed(exec.error ?? "execute failed")
        }
        return SignedSubmission(digest: exec.digest)
    }
}
