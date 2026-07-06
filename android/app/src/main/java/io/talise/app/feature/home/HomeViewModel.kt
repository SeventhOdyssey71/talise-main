package io.talise.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val loading: Boolean = true,
    val balances: BalancesDTO? = null,
    val activity: List<ActivityEntryDTO> = emptyList(),
    val error: String? = null,
)

/**
 * Home data, loads `/api/balances` + `/api/activity`, like iOS `HomeView`.
 * Refreshes when a money flow emits [TaliseEvents.Event.HomeShouldRefresh] / TxCompleted.
 */
class HomeViewModel : ViewModel() {
    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        load()
        viewModelScope.launch {
            TaliseEvents.events.collect { e ->
                if (e is TaliseEvents.Event.HomeShouldRefresh || e is TaliseEvents.Event.TxCompleted) load(silent = true)
            }
        }
    }

    fun load(silent: Boolean = false) {
        if (!silent) _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val balances = ApiClient.api.balances(fresh = 1)
                val activity = ApiClient.api.activity(limit = 20).entries
                balances to activity
            }.onSuccess { (balances, activity) ->
                _state.update { it.copy(loading = false, balances = balances, activity = activity, error = null) }
            }.onFailure { t ->
                // Keep any previously-loaded data; only surface an error on a cold failure.
                _state.update { s -> s.copy(loading = false, error = if (s.balances == null) t.message else null) }
            }
        }
    }
}
