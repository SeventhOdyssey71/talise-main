package io.talise.app.feature.requests

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * List state + actions for the requests list, mirroring iOS `RequestsListView`
 * `@State` 1:1 (requests / loading / loaded / error / busyId).
 */
class RequestsViewModel : ViewModel() {

    data class ListState(
        val requests: List<RequestDTO> = emptyList(),
        val loading: Boolean = true,
        val loaded: Boolean = false,
        val error: String? = null,
        val busyId: String? = null,
        val refreshing: Boolean = false,
    )

    private val _state = MutableStateFlow(ListState())
    val state: StateFlow<ListState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch { loadNow() }
    }

    /** Pull-to-refresh, the Android stand-in for iOS `.refreshable`. */
    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true) }
            try {
                loadNow()
            } finally {
                _state.update { it.copy(refreshing = false) }
            }
        }
    }

    private suspend fun loadNow() {
        if (_state.value.requests.isEmpty()) _state.update { it.copy(loading = true) }
        _state.update { it.copy(error = null) }
        try {
            val requests = RequestsApi.service.list().requests
            _state.update { it.copy(requests = requests, loading = false, loaded = true) }
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            _state.update {
                it.copy(error = "Couldn't load your requests right now.", loading = false, loaded = true)
            }
        }
    }

    fun cancel(req: RequestDTO) {
        viewModelScope.launch {
            _state.update { it.copy(busyId = req.id) }
            try {
                RequestsApi.service.cancel(req.id)
                loadNow()
            } catch (e: CancellationException) {
                throw e
            } catch (t: Throwable) {
                _state.update { it.copy(error = "Couldn't cancel that request. Please try again.") }
            } finally {
                _state.update { it.copy(busyId = null) }
            }
        }
    }
}

/**
 * Create-flow state + actions, mirroring iOS `RequestCreateView` `@State` 1:1
 * (amount / note / creating / error / created / copied).
 */
class RequestCreateViewModel : ViewModel() {

    data class CreateState(
        val amount: String = "",
        val note: String = "",
        val creating: Boolean = false,
        val error: String? = null,
        val created: RequestCreateResponse? = null,
        val copied: Boolean = false,
    ) {
        val amountValue: Double get() = amount.trim().toDoubleOrNull() ?: 0.0
        val trimmedNote: String get() = note.trim()
        val canCreate: Boolean get() = amountValue > 0 && !creating
    }

    private val _state = MutableStateFlow(CreateState())
    val state: StateFlow<CreateState> = _state.asStateFlow()

    fun setAmount(value: String) = _state.update { it.copy(amount = value) }
    fun setNote(value: String) = _state.update { it.copy(note = value) }

    /** Fresh form each time the create flow is opened (iOS pushes a fresh view). */
    fun reset() {
        _state.value = CreateState()
    }

    fun create() {
        val s = _state.value
        if (!s.canCreate) return
        _state.update { it.copy(creating = true, error = null) }
        viewModelScope.launch {
            try {
                val res = RequestsApi.service.create(
                    CreateRequestBody(
                        amountUsd = s.amountValue,
                        currency = null,
                        note = s.trimmedNote.ifEmpty { null },
                    ),
                )
                _state.update { it.copy(created = res, creating = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (t: Throwable) {
                _state.update {
                    it.copy(
                        error = honestMoneyError(t, "Couldn't create that request. Please try again."),
                        creating = false,
                    )
                }
            }
        }
    }

    /** "Copied" flash on the share screen (reverts after 1.5s, like iOS). */
    fun markCopied() {
        _state.update { it.copy(copied = true) }
        viewModelScope.launch {
            delay(1_500)
            _state.update { it.copy(copied = false) }
        }
    }
}
