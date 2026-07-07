package io.talise.app.feature.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.session.AppSession
import io.talise.app.core.session.TaliseEvents
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val loading: Boolean = true,
    val balances: BalancesDTO? = null,
    val activity: List<ActivityEntryDTO> = emptyList(),
    val error: String? = null,
)

/**
 * Home data, a 1:1 port of iOS `HomeView.loadAll`.
 *
 * Snapshot-first (stale-while-revalidate): before the network round-trips
 * finish we seed the UI from the on-disk [HomeSnapshotStore] so the first frame
 * shows real balances/activity instead of a grey skeleton, then we refresh from
 * `/api/balances?fresh=1` + `/api/activity?limit&fresh=1` and re-persist.
 *
 * Refreshes when a money flow emits [TaliseEvents.Event.HomeShouldRefresh] /
 * TxCompleted. Also owns the app-wide privacy-eye flag (iOS `amountsHidden`).
 */
class HomeViewModel(app: Application) : AndroidViewModel(app) {
    private val store = HomeSnapshotStore(app)

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    /** iOS `@AppStorage("talise.amountsHidden")` — masks the hero + every row amount, persisted. */
    val amountsHidden: StateFlow<Boolean> =
        store.amountsHidden.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    init {
        seedFromSnapshot()
        load()
        viewModelScope.launch {
            TaliseEvents.events.collect { e ->
                if (e is TaliseEvents.Event.HomeShouldRefresh || e is TaliseEvents.Event.TxCompleted) {
                    load(silent = true)
                }
            }
        }
    }

    /**
     * Instant paint from the last-known snapshot (iOS `loadAll(force:false)` seed):
     * a slightly-stale balance beats a skeleton; "Recent" activity only paints from
     * a <2min cache (else newest-on-disk) so a days-old feed never reads as recent.
     */
    private fun seedFromSnapshot() {
        val uid = AppSession.currentUser?.id ?: return
        viewModelScope.launch {
            val cachedBalances = store.loadBalancesIfFresh(uid, maxAgeSec = 60 * 60) ?: store.loadBalances(uid)
            val cachedActivity = store.loadActivityIfFresh(uid, maxAgeSec = 2 * 60) ?: store.loadActivity(uid)
            _state.update { s ->
                s.copy(
                    balances = s.balances ?: cachedBalances,
                    activity = if (s.activity.isEmpty() && !cachedActivity.isNullOrEmpty()) cachedActivity else s.activity,
                    loading = if (cachedBalances != null) false else s.loading,
                )
            }
        }
    }

    fun load(silent: Boolean = false) {
        if (!silent) _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                // Authoritative cache-bypass reads (iOS `?fresh=1`).
                val balances = homeApi.balances(fresh = 1)
                val activity = homeApi.activity(limit = 20, fresh = 1).entries
                balances to activity
            }.onSuccess { (balances, activity) ->
                _state.update { s ->
                    s.copy(
                        loading = false,
                        balances = balances,
                        // On-chain history is immutable: never let a transient empty
                        // response downgrade rows already on screen.
                        activity = if (activity.isNotEmpty() || s.activity.isEmpty()) activity else s.activity,
                        error = null,
                    )
                }
                // Persist for the next cold launch. Only cache a non-empty feed so
                // an empty response never poisons the good snapshot.
                AppSession.currentUser?.id?.let { uid ->
                    store.saveBalances(balances, uid)
                    if (activity.isNotEmpty()) store.saveActivity(activity, uid)
                }
            }.onFailure { t ->
                // Keep any previously-loaded data; only surface an error on a cold failure.
                _state.update { s -> s.copy(loading = false, error = if (s.balances == null) t.message else null) }
            }
        }
    }

    fun toggleAmountsHidden() {
        viewModelScope.launch { store.setAmountsHidden(!amountsHidden.value) }
    }
}
