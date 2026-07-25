package io.talise.app.core.analytics

import android.content.Context
import android.content.SharedPreferences
import io.talise.app.BuildConfig
import io.talise.app.config.AppConfig
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * FIRST-PARTY PRODUCT ANALYTICS for the Android app — the exact counterpart of
 * `ios/Talise/Network/GrowthAnalytics.swift`, posting the same taxonomy to the
 * same endpoint (`POST /api/events`).
 *
 * Android was a total black box: no app-open signal, no funnel, nothing. This
 * is what makes Android show up in DAU, retention, activation and K-factor.
 *
 * No third-party SDK. No Firebase Analytics, no Amplitude — the wallet ships no
 * vendor code and no vendor receives a behavioural stream we can't audit.
 *
 * PRIVACY, enforced by the API shape rather than by convention:
 *   • [track] takes `amountUsd` and BANDS it on-device via [band]. A call site
 *     cannot send an exact amount.
 *   • No email, name, handle, address, recipient, memo, advertising id or
 *     device id is ever attached. `anonId` is a random UUID in our own
 *     SharedPreferences; clearing app data resets it.
 *   • Failures are reported as short machine codes, never as messages.
 *
 * COST: events queue in memory and flush as ONE request (2s debounce, or
 * immediately at 20 events / when the app backgrounds). A failed flush is
 * dropped, never retried in a loop — analytics must not fight a user's data
 * plan.
 *
 * Uses its OWN OkHttp client, deliberately separate from [io.talise.app.core.net.ApiClient]:
 * a 401 here must NOT emit `sessionExpired` and sign the user out.
 */
object Growth {

    // ── Taxonomy (mirrors web/lib/analytics/events.ts) ───────────────────────

    enum class Event(val raw: String) {
        // Lifecycle / retention
        AppOpen("app_open"),
        AppFirstOpen("app_first_open"),
        ScreenView("screen_view"),

        // Signup funnel
        SignupStarted("signup_started"),
        SignupAuthCompleted("signup_auth_completed"),
        OnboardingStep("onboarding_step"),
        OnboardingCompleted("onboarding_completed"),
        HandleClaimed("handle_claimed"),
        KycStarted("kyc_started"),
        KycCompleted("kyc_completed"),

        // Money in
        DepositStarted("deposit_started"),
        DepositFailed("deposit_failed"),
        Funded("funded"),
        DepositCompleted("deposit_completed"),

        // Money out
        SendStarted("send_started"),
        SendReviewed("send_reviewed"),
        SendCompleted("send_completed"),
        SendFailed("send_failed"),
        FirstSend("first_send"),
        CashoutStarted("cashout_started"),
        CashoutCompleted("cashout_completed"),
        CashoutFailed("cashout_failed"),

        // Revenue-bearing
        SwapCompleted("swap_completed"),
        EarnSupplied("earn_supplied"),
        PerpClosed("perp_closed"),

        // Virality
        InviteSent("invite_sent"),

        // Push
        PushPermissionGranted("push_permission_granted"),
        PushPermissionDenied("push_permission_denied"),
        NotificationOpened("notification_opened"),
    }

    enum class Status(val raw: String) {
        Started("started"), Ok("ok"), Error("error"), Cancelled("cancelled")
    }

    // ── Wire shapes ──────────────────────────────────────────────────────────

    @Serializable
    private data class Payload(
        val event: String,
        val ts: Long,
        val anonId: String,
        val sessionId: String,
        val platform: String = "android",
        val appVersion: String,
        val surface: String? = null,
        val step: String? = null,
        val status: String? = null,
        val errorCode: String? = null,
        val amountBand: String? = null,
        val currency: String? = null,
        val corridor: String? = null,
        val feeUsd: Double? = null,
        val inviteId: String? = null,
        /** Only ever carries `refCode` — the server hashes it on arrival. */
        val attribution: Map<String, String>? = null,
        val props: Map<String, String>? = null,
    )

    @Serializable
    private data class Batch(
        val anonId: String,
        val sessionId: String,
        val platform: String = "android",
        val appVersion: String,
        val events: List<Payload>,
    )

    // ── State ────────────────────────────────────────────────────────────────

    private const val PREFS = "talise_growth"
    private const val KEY_ANON = "anon_id"
    private const val KEY_SESSION = "session_id"
    private const val KEY_SESSION_AT = "session_at"
    private const val KEY_FIRST_OPEN = "first_open_at"
    private const val SESSION_IDLE_MS = 30 * 60 * 1000L
    private const val DEBOUNCE_MS = 2_000L
    private const val MAX_QUEUED = 20

    private val json = Json { encodeDefaults = true; explicitNulls = false }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = ArrayDeque<Payload>()
    private val lock = Any()

    @Volatile private var prefs: SharedPreferences? = null
    @Volatile private var flushScheduled = false

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    /** Call once from `TaliseApp.onCreate`, before any [track]. */
    fun init(context: Context) {
        if (prefs == null) {
            prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        }
    }

    // ── Identity ─────────────────────────────────────────────────────────────

    private fun anonId(): String {
        val p = prefs ?: return "unset"
        p.getString(KEY_ANON, null)?.let { return it }
        val fresh = UUID.randomUUID().toString()
        p.edit().putString(KEY_ANON, fresh).apply()
        return fresh
    }

    /** Rotates after 30 idle minutes — the unit that makes "one open per
     *  session" a meaningful DAU count. */
    private fun sessionId(): String {
        val p = prefs ?: return "unset"
        val now = System.currentTimeMillis()
        val last = p.getLong(KEY_SESSION_AT, 0L)
        var id = p.getString(KEY_SESSION, null)
        if (id == null || now - last > SESSION_IDLE_MS) {
            id = UUID.randomUUID().toString()
            p.edit().putString(KEY_SESSION, id).apply()
        }
        p.edit().putLong(KEY_SESSION_AT, now).apply()
        return id
    }

    // ── Amount banding ───────────────────────────────────────────────────────

    /**
     * Bucket a USD amount. Mirrors `amountBand()` in
     * `web/lib/analytics/events.ts`; the server accepts KNOWN bands only, so a
     * drift here drops the dimension rather than leaking a number.
     */
    fun band(usd: Double?): String? {
        if (usd == null || usd.isNaN() || usd.isInfinite()) return null
        val v = abs(usd)
        return when {
            v == 0.0 -> "0"
            v < 1 -> "<1"
            v < 5 -> "1-4"
            v < 20 -> "5-19"
            v < 50 -> "20-49"
            v < 100 -> "50-99"
            v < 500 -> "100-499"
            v < 1_000 -> "500-999"
            v < 5_000 -> "1k-5k"
            else -> "5k+"
        }
    }

    /**
     * Collapse a Throwable into a SHORT, non-identifying code. Exists so no
     * call site passes `t.message`, which can embed an address or an amount.
     */
    fun errorCode(t: Throwable?): String = when (t) {
        null -> "unknown"
        is retrofit2.HttpException -> "http_${t.code()}"
        is IOException -> "transport"
        else -> t.javaClass.simpleName.take(32)
    }

    // ── Emit ─────────────────────────────────────────────────────────────────

    /** Fire-and-forget. Never throws, never blocks, never fails a money path. */
    fun track(
        event: Event,
        surface: String? = null,
        step: String? = null,
        status: Status? = null,
        errorCode: String? = null,
        amountUsd: Double? = null,
        currency: String? = null,
        corridor: String? = null,
        feeUsd: Double? = null,
        inviteId: String? = null,
        refCode: String? = null,
        props: Map<String, String>? = null,
    ) {
        // Not initialized yet (a unit test, a Compose preview) — drop rather
        // than emit rows with a placeholder anon id that would corrupt DAU.
        if (prefs == null) return
        try {
            val payload = Payload(
                event = event.raw,
                ts = System.currentTimeMillis(),
                anonId = anonId(),
                sessionId = sessionId(),
                appVersion = BuildConfig.VERSION_NAME,
                surface = surface,
                step = step,
                status = status?.raw,
                errorCode = errorCode,
                // Banded on-device: an exact amount cannot leave the phone.
                amountBand = band(amountUsd),
                currency = currency,
                corridor = corridor,
                feeUsd = feeUsd,
                inviteId = inviteId,
                attribution = refCode?.let { mapOf("refCode" to it) },
                props = props,
            )
            val shouldFlushNow: Boolean
            synchronized(lock) {
                queue.addLast(payload)
                shouldFlushNow = queue.size >= MAX_QUEUED
            }
            if (shouldFlushNow) flush() else scheduleFlush()
        } catch (_: Throwable) {
            // Analytics never surfaces an error to the app.
        }
    }

    /**
     * One `app_open` per session window. Safe to call on every foreground — the
     * session check makes repeats free. THIS is the event DAU/WAU/MAU and
     * D1/D7/D30 retention are computed from.
     */
    fun appOpen(fromNotification: Boolean = false) {
        val p = prefs ?: return
        // Decide BEFORE anything touches sessionId() (which refreshes the idle
        // window as a side effect).
        val now = System.currentTimeMillis()
        val last = p.getLong(KEY_SESSION_AT, 0L)
        val isNewSession = p.getString(KEY_SESSION, null) == null || now - last > SESSION_IDLE_MS
        val isFirstEver = p.getLong(KEY_FIRST_OPEN, 0L) == 0L
        if (isFirstEver) p.edit().putLong(KEY_FIRST_OPEN, now).apply()

        if (isFirstEver) track(Event.AppFirstOpen)
        if (isNewSession) {
            track(Event.AppOpen, props = if (fromNotification) mapOf("push" to "1") else null)
        }
        if (fromNotification) track(Event.NotificationOpened)
    }

    /**
     * A set-once user milestone (`funded`, `first_send`, …). The server enforces
     * exactly-once in `growth_user_firsts` (COALESCE on first write), so calling
     * this on every occurrence is both correct and free of client bookkeeping.
     */
    fun milestone(event: Event, amountUsd: Double? = null, surface: String? = null) {
        track(event, surface = surface, status = Status.Ok, amountUsd = amountUsd)
    }

    /**
     * An invite the user actually SENT. A fresh `inviteId` per share is what
     * makes "invites sent" a correct K-factor denominator; `refCode` lets the
     * server tie later clicks on `talise.io/r/<CODE>` back to this inviter (as a
     * hash — the public invite URL can't carry a per-send id).
     */
    fun inviteSent(code: String, channel: String) {
        track(
            Event.InviteSent,
            surface = channel,
            status = Status.Ok,
            inviteId = UUID.randomUUID().toString(),
            refCode = code,
        )
    }

    // ── Flush ────────────────────────────────────────────────────────────────

    private fun scheduleFlush() {
        if (flushScheduled) return
        flushScheduled = true
        scope.launch {
            delay(DEBOUNCE_MS)
            flushScheduled = false
            flush()
        }
    }

    /** Send whatever is queued. Call when the app backgrounds so the last
     *  events of a session — the drop-off signal — actually land. */
    fun flush() {
        val batch: List<Payload>
        synchronized(lock) {
            if (queue.isEmpty()) return
            batch = queue.toList()
            queue.clear()
        }
        scope.launch {
            try {
                // Explicit serializer (not the reified extension) so this file
                // needs no extra import and can never pick the wrong overload.
                val body = json.encodeToString(
                    Batch.serializer(),
                    Batch(
                        anonId = anonId(),
                        sessionId = sessionId(),
                        appVersion = BuildConfig.VERSION_NAME,
                        events = batch,
                    ),
                ).toRequestBody("application/json".toMediaType())

                val builder = Request.Builder()
                    .url(AppConfig.apiBaseUrl.trimEnd('/') + "/api/events")
                    .post(body)
                // Attach the bearer when present so the server resolves the user
                // id itself. Absent = anonymous, which is correct pre-signup.
                SecureStore.bearer?.let { builder.header("Authorization", "Bearer $it") }

                http.newCall(builder.build()).execute().use { /* response ignored */ }
            } catch (_: Throwable) {
                // Drop the batch. A retry storm is worse than a lost sample.
            }
        }
    }
}
