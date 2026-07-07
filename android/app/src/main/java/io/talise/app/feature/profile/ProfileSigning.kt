package io.talise.app.feature.profile

import io.talise.app.core.auth.SuiCrypto
import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.store.SecureStore
import org.bouncycastle.crypto.digests.Blake2bDigest
import org.bouncycastle.crypto.signers.Ed25519Signer

/**
 * Profile-scoped signing helpers — Android match for the two iOS `ZkLoginCoordinator`
 * paths the Profile flows use:
 *   • [signPersonalMessage] — Sui PERSONAL MESSAGE signing (bank-account attestation).
 *     bcsMessage = ULEB128(len) || utf8(message); intent [3,0,0]; blake2b256; Ed25519.
 *     The ephemeral signature is wrapped into a composite zkLogin signature by
 *     `/api/zk/assemble-signature` (proof assembled server-side for mobile sessions).
 *   • [signAndSponsorExecute] — sign sponsored PTB bytes (intent [0,0,0], via
 *     [ZkLoginCoordinator.signTransaction]) and submit through `/api/zk/sponsor-execute`,
 *     which assembles the zkLogin proof from the mobile signing context.
 */
internal object ProfileSigning {

    /** Minimal unsigned-LEB128 encoder — Sui BCS length prefix for vector<u8>. */
    private fun uleb128(value: Int): ByteArray {
        var v = value
        val out = ArrayList<Byte>(5)
        while (true) {
            val byte = v and 0x7F
            v = v ushr 7
            if (v == 0) {
                out.add(byte.toByte())
                break
            }
            out.add((byte or 0x80).toByte())
        }
        return out.toByteArray()
    }

    private fun blake2b256(data: ByteArray): ByteArray {
        val digest = Blake2bDigest(256)
        digest.update(data, 0, data.size)
        val out = ByteArray(32)
        digest.doFinal(out, 0)
        return out
    }

    /**
     * Signs an arbitrary UTF-8 string as a Sui personal message and returns the full
     * composite zkLogin signature (treated as the opaque attestation `digest` by
     * `/api/me/bank/link/confirm`). Mirrors iOS `ZkLoginCoordinator.signPersonalMessage`.
     */
    suspend fun signPersonalMessage(message: String): String {
        val skB64 = SecureStore.ephemeralSk
            ?: throw IllegalStateException("no ephemeral key, sign in again")
        val randomness = SecureStore.jwtRandomness
            ?: throw IllegalStateException("no signing session, sign in again")
        val maxEpoch = SecureStore.maxEpoch

        val messageBytes = message.toByteArray(Charsets.UTF_8)
        // BCS vector<u8> = ULEB128 length prefix + raw bytes.
        val bcsMessage = uleb128(messageBytes.size) + messageBytes
        // Personal-message intent scope is [3, 0, 0] (vs [0,0,0] for a tx).
        val intentMessage = byteArrayOf(3, 0, 0) + bcsMessage
        val digest = blake2b256(intentMessage)

        val key = SuiCrypto.loadPrivateKey(skB64)
        val signer = Ed25519Signer()
        signer.init(true, key)
        signer.update(digest, 0, digest.size)
        val sig = signer.generateSignature() // 64 bytes

        val pub = SuiCrypto.publicKeyBytes(key)
        // Sui SerializedSignature: 0x00 flag (Ed25519) + sig + pubkey.
        val serialized = ByteArray(1 + sig.size + 32)
        serialized[0] = 0x00
        System.arraycopy(sig, 0, serialized, 1, sig.size)
        System.arraycopy(pub, 0, serialized, 1 + sig.size, 32)

        val resp = profileApi.assembleSignature(
            AssembleSignatureBody(
                bytesB64 = SuiCrypto.b64(bcsMessage),
                ephemeralPubKeyB64 = SuiCrypto.b64(pub),
                maxEpoch = maxEpoch,
                randomness = randomness,
                userSignature = SuiCrypto.b64(serialized),
            )
        )
        resp.error?.takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) }
        return resp.signature?.takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException("no signature in response")
    }

    /**
     * Sign sponsor-ready tx bytes with the ephemeral key and broadcast through
     * `/api/zk/sponsor-execute`. Returns the on-chain digest. Mirrors iOS
     * `signAndExecuteRaw(bytesB64:meta:)`.
     */
    suspend fun signAndSponsorExecute(bytesB64: String, metaKind: String? = null): String {
        val randomness = SecureStore.jwtRandomness
            ?: throw IllegalStateException("no signing session, sign in again")
        val userSignature = ZkLoginCoordinator.signTransaction(bytesB64)
        val resp = profileApi.sponsorExecute(
            SponsorExecuteBody(
                bytesB64 = bytesB64,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = metaKind?.let { ZkMeta(it) },
            )
        )
        resp.error?.takeIf { it.isNotEmpty() }?.let { throw IllegalStateException(it) }
        return resp.digest?.takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException("no digest in response")
    }
}
