package io.talise.app.feature.rules

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException

/**
 * State for the Rules / Automations hub, mirroring iOS `RulesView` @State 1:1
 * (rules / enabled / loaded / loading / error / busyId / firedDue).
 *
 * There is NO cron and NO scheduler key: `execute_due` is permissionless, so
 * opening this screen triggers any DUE rules (prepare → sign → record) — the
 * contract guarantees it can only pay the pre-set amount to the pre-set
 * recipient on schedule (it aborts ENotDue otherwise, so each step is
 * best-effort).
 */
class RulesViewModel : ViewModel() {

    private val api = ApiClient.create(RulesApi::class.java)

    data class Ui(
        val rules: List<RuleDTO> = emptyList(),
        val enabled: Boolean = false,
        val loaded: Boolean = false,
        val loading: Boolean = true,
        val error: String? = null,
        val busyId: String? = null,
    )

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    /** Fire due rules once per screen appearance — the "no cron" trigger. */
    private var firedDue = false

    fun load(fireDue: Boolean = false) {
        if (_ui.value.rules.isEmpty()) _ui.value = _ui.value.copy(loading = true)
        _ui.value = _ui.value.copy(error = null)
        viewModelScope.launch {
            try {
                val res = api.list()
                _ui.value = _ui.value.copy(
                    rules = res.rules, enabled = res.enabled,
                    loading = false, loaded = true,
                )
                if (fireDue) fireDueRulesOnce()
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _ui.value = _ui.value.copy(
                    loading = false, loaded = true,
                    error = "Couldn't load your rules right now.",
                )
            }
        }
    }

    /**
     * Fire any DUE scheduled rules once per appearance. `execute_due` is
     * permissionless on-chain, so the owner's open app releases due payments:
     * prepare → sign → record. The contract is the real gate (it aborts
     * ENotDue if a rule isn't actually due), so each step is best-effort.
     */
    private suspend fun fireDueRulesOnce() {
        val state = _ui.value
        if (!state.enabled || firedDue) return
        firedDue = true
        val now = System.currentTimeMillis().toDouble()
        val due = state.rules.filter {
            it.isActive && it.triggerType == "schedule" && (it.nextDueAt ?: Double.MAX_VALUE) <= now
        }
        if (due.isEmpty()) return
        var fired = 0
        for (rule in due) {
            try {
                val prep = api.executePrepare(rule.id)
                val digest = TaliseSigning.executeSponsorReady(prep.bytes, kind = "rule-execute")
                api.recordExecuted(rule.id, RuleExecutedBody(digest))
                fired += 1
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                // ENotDue / NO_ORDER (409) / transient — the contract is the gate; skip.
            }
        }
        if (fired > 0) load()
    }

    fun toggle(rule: RuleDTO) {
        if (_ui.value.busyId != null) return
        _ui.value = _ui.value.copy(busyId = rule.id)
        viewModelScope.launch {
            try {
                if (rule.isPaused) api.resume(rule.id) else api.pause(rule.id)
                _ui.value = _ui.value.copy(busyId = null)
                load()
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _ui.value = _ui.value.copy(
                    busyId = null,
                    error = "Couldn't update that rule. Please try again.",
                )
            }
        }
    }

    /**
     * Cancel a rule: sign the on-chain `cancel` (refunds the remaining pot to
     * you), then clear the row. If the rule has no on-chain order (409),
     * there's nothing to refund — just clear the row.
     */
    fun delete(rule: RuleDTO) {
        if (_ui.value.busyId != null) return
        _ui.value = _ui.value.copy(busyId = rule.id)
        viewModelScope.launch {
            try {
                try {
                    val prep = api.cancelPrepare(rule.id)
                    TaliseSigning.executeSponsorReady(prep.bytes, kind = "rule-cancel")
                } catch (t: HttpException) {
                    // No on-chain order to refund (409) — fall through to clear the row.
                    if (t.code() != 409) throw t
                }
                api.delete(rule.id)
                _ui.value = _ui.value.copy(busyId = null)
                load()
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _ui.value = _ui.value.copy(
                    busyId = null,
                    error = "Couldn't cancel that rule. Please try again.",
                )
            }
        }
    }
}

/**
 * State for the rule editor, mirroring iOS `RuleEditView` (creating / error /
 * created / fundedUsd / fundedPayments). The form fields live in the screen;
 * this owns the prepare → sign → record pipeline.
 */
class RuleEditViewModel : ViewModel() {

    private val api = ApiClient.create(RulesApi::class.java)

    data class Ui(
        val creating: Boolean = false,
        val error: String? = null,
        val created: RuleDTO? = null,
        val fundedUsd: Double = 0.0,
        val fundedPayments: Int = 1,
    )

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    /**
     * Prepare → sign the sponsored `standing_order::create` (funds the pot) →
     * record (activate). Mirrors iOS `RuleEditView.create()` exactly.
     */
    fun create(
        name: String,
        intervalMinutes: Int?,
        dayOfMonth: Int?,
        toRecipient: String,
        amountUsd: Double,
        prefundUsd: Double,
        prefundPayments: Int,
    ) {
        if (_ui.value.creating) return
        _ui.value = _ui.value.copy(creating = true, error = null)
        viewModelScope.launch {
            try {
                // 1) Prepare: validate + screen the recipient, get the funding bytes.
                val prep = api.prepareCreate(
                    RulePrepareBody(
                        name = name,
                        trigger = "schedule",
                        action = "send",
                        intervalMinutes = intervalMinutes,
                        dayOfMonth = dayOfMonth,
                        toRecipient = toRecipient,
                        amountUsd = amountUsd,
                        prefundUsd = prefundUsd,
                    ),
                )
                // 2) Sign the sponsored bytes that fund the rule's on-chain pot.
                val digest = TaliseSigning.executeSponsorReady(prep.bytes, kind = "rule-create")
                // 3) Activate the rule with the funding digest.
                val rule = api.recordCreate(
                    RuleRecordBody(
                        digest = digest,
                        firstDueMs = prep.firstDueMs,
                        name = prep.record.name,
                        trigger = prep.record.trigger,
                        intervalMinutes = prep.record.intervalMinutes,
                        dayOfMonth = prep.record.dayOfMonth,
                        toAddress = prep.record.toAddress,
                        toHandle = prep.record.toHandle,
                        amountUsd = prep.record.amountUsd,
                    ),
                ).rule

                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "sent",
                        amountUsdsui = prefundUsd,
                        counterpartyName = name,
                    ),
                )
                _ui.value = Ui(
                    created = rule,
                    fundedUsd = prefundUsd,
                    fundedPayments = prefundPayments,
                )
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _ui.value = _ui.value.copy(
                    creating = false,
                    error = rulesErrorFor(t, "Couldn't create that rule. Please try again."),
                )
            }
        }
    }
}
