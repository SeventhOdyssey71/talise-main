package io.talise.app.core.session

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * App-wide event bus — the Android replacement for iOS `NotificationCenter`.
 * Screens collect [events]; producers call the emit helpers. Buffered + tryEmit
 * so non-suspend callers (e.g. the OkHttp 401 interceptor) can fire safely.
 */
object TaliseEvents {
    sealed interface Event {
        data object SessionExpired : Event
        data object HomeShouldRefresh : Event
        data class TxCompleted(
            val digest: String,
            val direction: String,
            val amountUsdsui: Double?,
            val counterpartyName: String? = null,
            val venue: String? = null,
        ) : Event
        data object RequestDepositCover : Event
        data object RequestSendCover : Event
    }

    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 16)
    val events: SharedFlow<Event> = _events

    fun emit(event: Event) { _events.tryEmit(event) }
    fun emitSessionExpired() { _events.tryEmit(Event.SessionExpired) }
    fun emitTxCompleted(e: Event.TxCompleted) { _events.tryEmit(e) }
}
