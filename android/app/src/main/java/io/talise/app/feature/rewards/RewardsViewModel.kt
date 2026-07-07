package io.talise.app.feature.rewards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Rewards tab data — mirrors iOS `RewardsView`'s `@State` trio
 * (`summary` / `loading` / `error`) plus the pull-to-refresh flag.
 */
class RewardsViewModel : ViewModel() {

    data class State(
        val summary: RewardsSummary? = null,
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch {
            runCatching { rewardsApi.summary() }
                .onSuccess { _state.value = _state.value.copy(summary = it, loading = false) }
                .onFailure { t ->
                    _state.value = _state.value.copy(
                        loading = false,
                        error = t.message ?: "Couldn't load rewards.",
                    )
                }
        }
    }

    /** Pull-to-refresh — iOS `.refreshable { await load() }`. */
    fun refresh() {
        if (_state.value.refreshing) return
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            runCatching { rewardsApi.summary() }
                .onSuccess { _state.value = _state.value.copy(summary = it, refreshing = false, error = null) }
                .onFailure { t ->
                    _state.value = _state.value.copy(
                        refreshing = false,
                        error = t.message ?: "Couldn't load rewards.",
                    )
                }
        }
    }
}
