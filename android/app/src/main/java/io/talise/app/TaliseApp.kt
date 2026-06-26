package io.talise.app

import android.app.Application
import io.talise.app.core.session.AppSession
import io.talise.app.core.store.SecureStore

/** Application entry — init secure storage + boot the session phase machine. */
class TaliseApp : Application() {
    override fun onCreate() {
        super.onCreate()
        SecureStore.init(this)
        AppSession.bootstrap()
    }
}
