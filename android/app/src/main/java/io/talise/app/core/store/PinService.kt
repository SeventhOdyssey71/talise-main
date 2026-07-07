package io.talise.app.core.store

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Per-user PIN storage, Android port of iOS `PinService` (Keychain-backed).
 * Shared by onboarding (PIN setup) and the PIN entry gate so a PIN set during
 * onboarding verifies at unlock time.
 *
 * We hash the PIN with a per-install random salt and SHA-256; what hits disk is
 * `salt(16) || sha256(salt || pin)`, base64-encoded inside an
 * EncryptedSharedPreferences file (Keystore-backed AES-256-GCM, the closest
 * Android analogue of `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
 * PINs are weak entropy, so the hash is defense-in-depth; the real protection
 * is the Keystore encryption + device unlock.
 *
 * Keying: every record is scoped by the signed-in `userId`, so two users
 * sharing a device get independent PINs.
 */
object PinService {
    private const val FILE = "io.talise.app.pin"
    private const val SALT_LEN = 16
    private const val HASH_LEN = 32

    @Volatile
    private var prefs: SharedPreferences? = null

    private fun prefs(context: Context): SharedPreferences {
        prefs?.let { return it }
        synchronized(this) {
            prefs?.let { return it }
            val appContext = context.applicationContext
            val masterKey = MasterKey.Builder(appContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                appContext,
                FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            ).also { prefs = it }
        }
    }

    private fun account(userId: String) = "pin.$userId"

    /** Stores `salt(16) || sha256(salt || pin)` for `userId`. Overwrites any existing PIN. */
    fun setPin(context: Context, pin: String, userId: String) {
        require(userId.isNotEmpty()) { "Not signed in." }
        val salt = ByteArray(SALT_LEN).also { SecureRandom().nextBytes(it) }
        val blob = salt + hash(pin, salt)
        prefs(context).edit()
            .putString(account(userId), Base64.encodeToString(blob, Base64.NO_WRAP))
            .apply()
    }

    fun hasPin(context: Context, userId: String): Boolean {
        if (userId.isEmpty()) return false
        return prefs(context).getString(account(userId), null) != null
    }

    /**
     * Returns true if `pin` matches the stored hash for `userId`.
     * Constant-time compared to mitigate trivial timing differences.
     */
    fun verifyPin(context: Context, pin: String, userId: String): Boolean {
        if (userId.isEmpty()) return false
        val encoded = prefs(context).getString(account(userId), null) ?: return false
        val blob = try {
            Base64.decode(encoded, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            return false
        }
        if (blob.size != SALT_LEN + HASH_LEN) return false
        val salt = blob.copyOfRange(0, SALT_LEN)
        val stored = blob.copyOfRange(SALT_LEN, blob.size)
        return constantTimeEquals(stored, hash(pin, salt))
    }

    /** Clears one user's PIN. Used by the "Forgot PIN" path. */
    fun clearPin(context: Context, userId: String) {
        if (userId.isEmpty()) return
        prefs(context).edit().remove(account(userId)).apply()
    }

    private fun hash(pin: String, salt: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(salt + pin.toByteArray(Charsets.UTF_8))

    private fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].toInt() xor b[i].toInt())
        return diff == 0
    }
}
