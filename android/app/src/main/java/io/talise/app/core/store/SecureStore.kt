package io.talise.app.core.store

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Keystore-backed secret storage — the Android equivalent of iOS `SecureSessionStore` /
 * `EphemeralKeyStore` / `ProofCache` (Keychain). Holds the bearer token, the Ed25519
 * ephemeral key, and the zkLogin proof cache. Initialize once in [TaliseApp].
 */
object SecureStore {
    private const val FILE = "talise_secure"
    private const val KEY_BEARER = "bearer"
    private const val KEY_EPHEMERAL = "ephemeral_sk"
    private const val KEY_PROOF = "proof_cache"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var bearer: String?
        get() = prefs.getString(KEY_BEARER, null)
        set(value) = prefs.edit().apply { if (value == null) remove(KEY_BEARER) else putString(KEY_BEARER, value) }.apply()

    var ephemeralSk: String?
        get() = prefs.getString(KEY_EPHEMERAL, null)
        set(value) = prefs.edit().apply { if (value == null) remove(KEY_EPHEMERAL) else putString(KEY_EPHEMERAL, value) }.apply()

    var proofCache: String?
        get() = prefs.getString(KEY_PROOF, null)
        set(value) = prefs.edit().apply { if (value == null) remove(KEY_PROOF) else putString(KEY_PROOF, value) }.apply()

    /** Wipe everything on sign-out (mirrors iOS signOut clearing Keychain). */
    fun clear() {
        prefs.edit().clear().apply()
    }
}
