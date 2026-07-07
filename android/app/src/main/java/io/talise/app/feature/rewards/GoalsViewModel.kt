package io.talise.app.feature.rewards

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Savings goals — the Android counterpart of iOS `GoalsSection` +
 * `GoalActionSheet` + `NewGoalScreen` state. One ViewModel owns the goal
 * list plus the (single) open action sheet's mutation state, mirroring the
 * iOS `@State` fields 1:1.
 *
 * Deposits/withdrawals ride the ON-CHAIN GoalVault rail first
 * (prepare → sign locally → sponsor-execute → confirm), falling back to the
 * DB tracking rail when the vault rail is disabled or not deployed —
 * exactly the iOS behavior.
 */
class GoalsViewModel : ViewModel() {

    data class ListState(
        val goals: List<SavingsGoal> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
    )

    /** Mirrors `GoalActionSheet`'s `@State`: busy/error/lastPointsAwarded/
     *  depositDone/withdrawDone/earnOn. */
    data class SheetState(
        val busy: Boolean = false,
        val error: String? = null,
        val lastPointsAwarded: Int? = null,
        /** Non-null after a successful deposit — pre-formatted amount added. */
        val depositDone: String? = null,
        /** Non-null after a successful withdrawal — pre-formatted amount. */
        val withdrawDone: String? = null,
        /** Mirrors `goal.yieldOn`; flipped optimistically, reverted on failure. */
        val earnOn: Boolean = false,
    )

    /** Mirrors `NewGoalScreen`'s `busy` / `error`. */
    data class CreateState(
        val busy: Boolean = false,
        val error: String? = null,
    )

    private val _list = MutableStateFlow(ListState())
    val list: StateFlow<ListState> = _list.asStateFlow()

    private val _sheet = MutableStateFlow(SheetState())
    val sheet: StateFlow<SheetState> = _sheet.asStateFlow()

    private val _create = MutableStateFlow(CreateState())
    val create: StateFlow<CreateState> = _create.asStateFlow()

    init {
        load()
    }

    fun load() {
        _list.value = _list.value.copy(loading = true)
        viewModelScope.launch {
            runCatching { rewardsApi.goals() }
                .onSuccess { _list.value = ListState(goals = it.goals, loading = false, error = null) }
                .onFailure { t ->
                    _list.value = _list.value.copy(loading = false, error = t.message)
                }
        }
    }

    /** Reset sheet state when a goal card is tapped open. */
    fun openSheet(goal: SavingsGoal) {
        _sheet.value = SheetState(earnOn = goal.yieldOn == true)
    }

    fun clearDepositDone() {
        _sheet.value = _sheet.value.copy(depositDone = null)
    }

    fun clearWithdrawDone() {
        _sheet.value = _sheet.value.copy(withdrawDone = null)
    }

    fun resetCreate() {
        _create.value = CreateState()
    }

    // ── Mutations ───────────────────────────────────────────────────────────

    /** iOS `runDeposit` — vault rail first, DB tracking fallback. */
    fun deposit(goal: SavingsGoal, amountUsd: Double) {
        if (amountUsd <= 0 || _sheet.value.busy) return
        _sheet.value = _sheet.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                try {
                    // ON-CHAIN VAULT RAIL — the FIRST deposit `create`s + funds
                    // the vault; later ones `deposit` into it.
                    val op = if (goal.vaultObjectId == null) "create" else "deposit"
                    val digest = signAndSubmitGoalVault(
                        op = op,
                        goalId = goal.id,
                        amountUsd = amountUsd,
                        name = if (op == "create") goal.name else null,
                        targetUsd = if (op == "create") goal.targetUsd else null,
                    )
                    // Best-effort tracker sync — the on-chain tx already landed,
                    // so a confirm failure must NOT report the action as failed.
                    runCatching {
                        rewardsApi.vaultConfirm(GoalVaultConfirmBody(goalId = goal.id, op = op, amountUsd = amountUsd, digest = digest))
                    }
                } catch (t: Throwable) {
                    val code = railCode(t)
                    if (code == "GOAL_VAULT_DISABLED" || code == "HTTP_404") {
                        // Vault rail unavailable here → DB tracking model.
                        val resp = rewardsApi.goalDeposit(goal.id, GoalDepositRequest(amountUsd = amountUsd))
                        _sheet.value = _sheet.value.copy(lastPointsAwarded = resp.pointsAwarded)
                    } else {
                        throw t
                    }
                }
                load()
                _sheet.value = _sheet.value.copy(busy = false, depositDone = local2(amountUsd))
            } catch (t: Throwable) {
                _sheet.value = _sheet.value.copy(busy = false, error = friendlyGoalError(t))
            }
        }
    }

    /** iOS `runWithdraw` — vault rail first, DB tracking fallback. */
    fun withdraw(goal: SavingsGoal, amountUsd: Double) {
        if (amountUsd <= 0 || _sheet.value.busy) return
        _sheet.value = _sheet.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                try {
                    val digest = signAndSubmitGoalVault(op = "withdraw", goalId = goal.id, amountUsd = amountUsd)
                    runCatching {
                        rewardsApi.vaultConfirm(GoalVaultConfirmBody(goalId = goal.id, op = "withdraw", amountUsd = amountUsd, digest = digest))
                    }
                } catch (t: Throwable) {
                    val code = railCode(t)
                    if (code == "GOAL_VAULT_DISABLED" || code == "GOAL_NOT_ON_CHAIN" || code == "HTTP_404") {
                        rewardsApi.goalDeposit(goal.id, GoalDepositRequest(amountUsd = amountUsd, action = "withdraw"))
                    } else {
                        throw t
                    }
                }
                load()
                _sheet.value = _sheet.value.copy(busy = false, withdrawDone = local2(amountUsd))
            } catch (t: Throwable) {
                _sheet.value = _sheet.value.copy(busy = false, error = friendlyGoalError(t))
            }
        }
    }

    /**
     * iOS `runToggleYield` — start=true moves vault principal into NAVI
     * (`yield-start`); start=false redeems the full position back
     * (`yield-withdraw`). Optimistic flip; reverted on failure.
     */
    fun toggleYield(goal: SavingsGoal, start: Boolean) {
        if (_sheet.value.busy) return
        val amountUsd = goal.currentUsd
        if (amountUsd <= 0) {
            _sheet.value = _sheet.value.copy(earnOn = !start)
            return
        }
        _sheet.value = _sheet.value.copy(busy = true, error = null, earnOn = start)
        viewModelScope.launch {
            val op = if (start) "yield-start" else "yield-withdraw"
            try {
                val digest = signAndSubmitGoalVault(op = op, goalId = goal.id, amountUsd = amountUsd)
                // Best-effort tracker sync — see deposit().
                runCatching {
                    rewardsApi.vaultConfirm(GoalVaultConfirmBody(goalId = goal.id, op = op, amountUsd = amountUsd, digest = digest))
                }
                _sheet.value = _sheet.value.copy(busy = false, earnOn = start)
                load()
            } catch (t: Throwable) {
                val code = railCode(t)
                val unavailable = code == "GOAL_YIELD_DISABLED" || code == "GOAL_VAULT_DISABLED" ||
                    code == "HTTP_404" || code == "HTTP_503"
                _sheet.value = _sheet.value.copy(
                    busy = false,
                    earnOn = !start, // revert the switch — nothing moved
                    error = if (unavailable) "Earning is rolling out. Check back soon." else friendlyGoalError(t),
                )
            }
        }
    }

    /** iOS `runArchive` — PATCH archive:true, then close. */
    fun archive(goal: SavingsGoal, onDone: () -> Unit) {
        if (_sheet.value.busy) return
        _sheet.value = _sheet.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching {
                rewardsApi.updateGoal(goal.id, SavingsGoalUpdateRequest(archive = true))
            }.onSuccess {
                _sheet.value = _sheet.value.copy(busy = false)
                load()
                onDone()
            }.onFailure { t ->
                _sheet.value = _sheet.value.copy(busy = false, error = friendlyGoalError(t))
            }
        }
    }

    /** iOS `NewGoalScreen.create()`. */
    fun createGoal(name: String, targetUsd: Double, onDone: () -> Unit) {
        if (_create.value.busy) return
        _create.value = CreateState(busy = true)
        viewModelScope.launch {
            runCatching {
                rewardsApi.createGoal(SavingsGoalCreateRequest(name = name, targetUsd = targetUsd))
            }.onSuccess {
                _create.value = CreateState()
                load()
                onDone()
            }.onFailure { t ->
                _create.value = CreateState(error = t.message ?: "Couldn't create the goal.")
            }
        }
    }

    /**
     * Clean, user-facing copy for a goal action failure — never a raw
     * decode dump. Real server messages still pass through (iOS
     * `friendlyGoalError`).
     */
    private fun friendlyGoalError(t: Throwable): String {
        val raw = t.message ?: return "Couldn't complete that just now. Please try again."
        val lower = raw.lowercase()
        if (lower.contains("couldn't read") || lower.contains("decode") || raw.contains("{")) {
            return "Couldn't complete that just now. Please try again."
        }
        return raw
    }
}
