package io.talise.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import io.talise.app.core.analytics.Growth
import io.talise.app.core.session.AppSession
import io.talise.app.core.store.SecureStore

/** Application entry — init secure storage + boot the session phase machine. */
class TaliseApp : Application() {
    /** Number of started activities. 0 → 1 is a foreground, 1 → 0 a background. */
    private var startedActivities = 0

    override fun onCreate() {
        super.onCreate()
        SecureStore.init(this)
        // First-party product analytics. Must come before any Growth.track call.
        Growth.init(this)
        registerForegroundTracking()
        AppSession.bootstrap()
    }

    /**
     * `app_open` on every foreground, `flush()` on every background.
     *
     * Uses `ActivityLifecycleCallbacks` rather than `ProcessLifecycleOwner` so we
     * don't add a `lifecycle-process` dependency for one signal.
     * [Growth.appOpen] is session-gated (one open per 30-minute idle window), so
     * a configuration change or a quick app-switch cannot inflate DAU.
     *
     * Flushing on background is what makes the LAST events of a session land —
     * and those are exactly the drop-off events the funnel needs.
     */
    private fun registerForegroundTracking() {
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) {
                if (startedActivities == 0) Growth.appOpen()
                startedActivities++
            }

            override fun onActivityStopped(activity: Activity) {
                startedActivities = (startedActivities - 1).coerceAtLeast(0)
                if (startedActivities == 0) Growth.flush()
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}
