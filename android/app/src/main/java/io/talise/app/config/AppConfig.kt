package io.talise.app.config

import io.talise.app.BuildConfig

/** Runtime config — mirrors iOS `AppConfig` (base URL + OAuth client id from build settings). */
object AppConfig {
    val apiBaseUrl: String = BuildConfig.API_BASE_URL.ifBlank { "https://app.talise.io" }
    val googleWebClientId: String = BuildConfig.GOOGLE_WEB_CLIENT_ID
}
