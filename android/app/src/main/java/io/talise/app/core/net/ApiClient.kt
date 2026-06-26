package io.talise.app.core.net

import io.talise.app.config.AppConfig
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Retrofit/OkHttp stack — the Android equivalent of iOS `APIClient`.
 *   • [AuthInterceptor] attaches `Authorization: Bearer <token>` from [SecureStore].
 *   • A 401 emits [TaliseEvents.sessionExpired] (→ app signs out), mirroring `.taliseSessionExpired`.
 *   • Play Integrity headers (≈ iOS App Attest) land here in phase 2.
 */
object ApiClient {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val authInterceptor = Interceptor { chain ->
        val builder = chain.request().newBuilder()
        SecureStore.bearer?.let { builder.header("Authorization", "Bearer $it") }
        val response: Response = chain.proceed(builder.build())
        if (response.code == 401) TaliseEvents.emitSessionExpired()
        response
    }

    private val okhttp: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(AppConfig.apiBaseUrl)
        .client(okhttp)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val api: TaliseApi = retrofit.create(TaliseApi::class.java)
}
