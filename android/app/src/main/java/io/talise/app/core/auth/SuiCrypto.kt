package io.talise.app.core.auth

import android.util.Base64
import org.bouncycastle.crypto.digests.Blake2bDigest
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.SecureRandom

/**
 * Sui signing primitives — MUST be byte-identical to the iOS `ZkLoginCoordinator`
 * (CryptoKit Ed25519 + Blake2b), or validators reject the zkLogin proof.
 *
 *   digest = Blake2b256( intent[0,0,0] ++ txBytes )
 *   userSignature = base64( 0x00 ++ sig(64) ++ pubkey(32) )   // Sui SerializedSignature, Ed25519 flag 0x00
 */
object SuiCrypto {
    private val INTENT_TX = byteArrayOf(0, 0, 0) // Sui transaction-data intent prefix

    fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    fun b64Decode(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)

    fun newEphemeralPrivateKey(): Ed25519PrivateKeyParameters =
        Ed25519PrivateKeyParameters(SecureRandom())

    fun loadPrivateKey(skB64: String): Ed25519PrivateKeyParameters =
        Ed25519PrivateKeyParameters(b64Decode(skB64), 0)

    fun privateKeyB64(key: Ed25519PrivateKeyParameters): String = b64(key.encoded)

    fun publicKeyBytes(key: Ed25519PrivateKeyParameters): ByteArray = key.generatePublicKey().encoded

    fun publicKeyB64(key: Ed25519PrivateKeyParameters): String = b64(publicKeyBytes(key))

    private fun blake2b256(data: ByteArray): ByteArray {
        val digest = Blake2bDigest(256)
        digest.update(data, 0, data.size)
        val out = ByteArray(32)
        digest.doFinal(out, 0)
        return out
    }

    /**
     * Produce the Sui `userSignature` (base64) for sponsor-ready transaction bytes.
     * `txBytesB64` is the BCS tx bytes the server returned from a *-prepare endpoint.
     */
    fun signTransaction(txBytesB64: String, key: Ed25519PrivateKeyParameters): String {
        val txBytes = b64Decode(txBytesB64)
        val intentMessage = INTENT_TX + txBytes
        val digest = blake2b256(intentMessage)

        val signer = Ed25519Signer()
        signer.init(true, key)
        signer.update(digest, 0, digest.size)
        val sig = signer.generateSignature() // 64 bytes

        val serialized = ByteArray(1 + sig.size + 32)
        serialized[0] = 0x00 // Ed25519 scheme flag
        System.arraycopy(sig, 0, serialized, 1, sig.size)
        System.arraycopy(publicKeyBytes(key), 0, serialized, 1 + sig.size, 32)
        return b64(serialized)
    }

    /** 16 random bytes as a decimal string — BN254-scalar-safe jwtRandomness, as iOS does. */
    fun newJwtRandomness(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        var acc = java.math.BigInteger.ZERO
        for (b in bytes) acc = acc.shiftLeft(8).or(java.math.BigInteger.valueOf((b.toInt() and 0xFF).toLong()))
        return acc.toString()
    }
}
