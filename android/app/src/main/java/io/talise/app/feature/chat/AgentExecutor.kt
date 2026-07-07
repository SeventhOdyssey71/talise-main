package io.talise.app.feature.chat

import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.serialization.json.JsonObject
import java.util.Locale
import kotlin.math.abs

/**
 * Runs a confirmed Talise Agent plan — the ONLY place the agent path moves
 * money. The Android port of iOS `AgentExecutor.swift`.
 *
 * Read-only steps fetch + format inline (no signature); write steps (`ok` only)
 * call the same prepare + sign endpoints the manual flows use, so every
 * guardrail (caps, screening, gasless minimum) is already enforced server-side:
 *
 *   • send / cash_out — the proven Android send pipeline (SendViewModel):
 *       /api/send/sponsor-prepare → sign locally → /api/send/gasless-submit
 *   • save / withdraw / claim_rewards — earn prepare → /api/zk/sponsor →
 *       sign locally → /api/zk/sponsor-execute (the Onara-sponsored rail)
 *   • request — mint a payment link, no signing.
 *
 * Emits [TaliseEvents.Event.TxCompleted] per executed money step exactly like
 * the manual Send flow so Home reconciles optimistically.
 */
object AgentExecutor {

    private val agentApi: AgentApi get() = AgentApi.instance

    /** "$1,234.56" — matches iOS `TaliseFormat.usd2`. */
    fun usd2(v: Double): String = "$" + String.format(Locale.US, "%,.2f", v)

    /**
     * Run the read-only steps of an intent and return one display line each.
     * Never signs. Used for "what's my balance / show my activity" turns.
     */
    suspend fun runReadOnly(steps: List<AgentStep>): List<String> {
        val lines = mutableListOf<String>()
        for (step in steps) {
            if (!step.isReadOnly) continue
            when (step.kind) {
                "check_balance" -> {
                    val b = ApiClient.api.balances()
                    lines.add("Available: ${usd2(b.usdsui)} · Total ${usd2(b.totalUsd)}")
                }
                "check_yield" -> {
                    val cmp = ApiClient.api.yieldComparison()
                    val supplied = cmp.venues.mapNotNull { it.supplied }.sum()
                    val earned = cmp.venues.mapNotNull { it.earned }.sum()
                    if (supplied > 0) {
                        var s = "Saved ${usd2(supplied)} earning"
                        cmp.best?.let { s += " up to ${String.format(Locale.US, "%.1f", it.apy)}% APY" }
                        if (earned > 0) s += " · ${usd2(earned)} earned so far"
                        lines.add(s)
                    } else {
                        val best = cmp.best
                        if (best != null) {
                            lines.add("Nothing saved yet. Best rate is ${String.format(Locale.US, "%.1f", best.apy)}% APY.")
                        } else {
                            lines.add("Nothing saved yet.")
                        }
                    }
                }
                "show_activity" -> {
                    val n = (step.limit ?: 8).coerceIn(1, 25)
                    val r = ApiClient.api.activity(limit = n)
                    if (r.entries.isEmpty()) {
                        lines.add("No recent activity.")
                    } else {
                        r.entries.take(n).forEach { lines.add(activityLine(it)) }
                    }
                }
            }
        }
        return lines
    }

    /**
     * Execute every `ok` write step of a validated plan, in order. `intent` is
     * the original proposal (same length + order as `plan.steps`) — we read the
     * venue / note fallback from it since the plan response doesn't echo those.
     * Returns one confirmation line per executed step. Throws on the first
     * failure (the card surfaces it with honest copy).
     */
    suspend fun execute(plan: AgentPlanDTO, intent: AgentIntent): List<AgentActionResult> {
        val results = mutableListOf<AgentActionResult>()
        val steps = intent.steps
        for ((idx, planned) in plan.steps.withIndex()) {
            if (!planned.isOk) continue
            val step = steps.getOrNull(idx)

            when (planned.kind) {
                "send" -> {
                    // Defense-in-depth: a send executes ONLY against the
                    // server-resolved, screened recipient + the server-validated
                    // amount from the plan, never the model's raw proposal.
                    val to = planned.resolved?.address.orEmpty()
                    val amount = planned.amountUsd ?: 0.0
                    if (to.isEmpty() || amount <= 0) continue
                    val name = planned.resolved?.displayName?.takeIf { it.isNotBlank() }
                    val digest = signAndSubmitSend(to = to, amountUsd = amount)
                    postCompleted(direction = "sent", amountUsd = amount, counterpartyName = name, venue = null, digest = digest)
                    results.add(
                        AgentActionResult(
                            line = "Sent ${usd2(amount)} to ${name ?: shortAddr(to)}.",
                            kind = "send", amountUsd = amount, recipient = name ?: shortAddr(to), digest = digest,
                        ),
                    )
                }

                "save" -> {
                    // Trust ONLY the server-validated amount, never the model's
                    // raw proposal (step.amount). Matches send/cash_out.
                    val amount = planned.amountUsd ?: 0.0
                    if (amount <= 0) continue
                    val venue = step?.venue ?: "navi"
                    val built = agentApi.earnSupplyPrepare(EarnSupplyBody(venue = venue, amount = amount))
                    val kindB64 = built.transactionKindB64 ?: error(built.error ?: "could not prepare that save")
                    val digest = signAndSubmitKind(kindB64, ExecuteMeta(kind = "invest", amountUsd = amount, venue = venue))
                    postCompleted(direction = "invest", amountUsd = amount, counterpartyName = null, venue = venue, digest = digest)
                    results.add(
                        AgentActionResult(
                            line = "Saved ${usd2(amount)} into ${displayVenue(venue)}.",
                            kind = "save", amountUsd = amount, recipient = displayVenue(venue), digest = digest,
                        ),
                    )
                }

                "withdraw" -> {
                    val amount = planned.amountUsd ?: 0.0
                    if (amount <= 0) continue
                    val venue = step?.venue ?: "navi"
                    val built = agentApi.earnWithdrawPrepare(EarnWithdrawBody(venue = venue, amount = amount))
                    val kindB64 = built.transactionKindB64 ?: error(built.error ?: "could not prepare that withdrawal")
                    val digest = signAndSubmitKind(kindB64, ExecuteMeta(kind = "withdraw", amountUsd = amount, venue = venue))
                    postCompleted(direction = "withdraw", amountUsd = amount, counterpartyName = null, venue = venue, digest = digest)
                    results.add(
                        AgentActionResult(
                            line = "Withdrew ${usd2(amount)} from ${displayVenue(venue)}.",
                            kind = "withdraw", amountUsd = amount, recipient = displayVenue(venue), digest = digest,
                        ),
                    )
                }

                "claim_rewards" -> {
                    val venue = step?.venue ?: "navi"
                    val built = agentApi.earnWithdrawEarnedPrepare(EarnClaimBody(venue = venue))
                    val kindB64 = built.transactionKindB64 ?: error(built.error ?: "could not prepare that claim")
                    val digest = signAndSubmitKind(kindB64, ExecuteMeta(kind = "withdraw", amountUsd = 0.0, venue = venue))
                    postCompleted(direction = "withdraw", amountUsd = 0.0, counterpartyName = null, venue = venue, digest = digest)
                    results.add(
                        AgentActionResult(
                            line = "Claimed your ${displayVenue(venue)} rewards.",
                            kind = "claim_rewards", digest = digest,
                        ),
                    )
                }

                "cash_out" -> {
                    // Server loads the user's linked bank, creates the Linq order,
                    // and hands back the deposit wallet + exact amount to send. We
                    // sign a normal sponsored send to it; Linq pays the bank.
                    val amount = planned.amountUsd ?: 0.0
                    if (amount <= 0) continue
                    val prep = agentApi.cashoutPrepare(CashoutPrepareBody(amountUsd = amount))
                    prep.error?.takeIf { it.isNotBlank() }?.let { error(it) }
                    if (prep.walletAddress.isEmpty() || prep.amountUsdsui <= 0) error("could not prepare that cash-out")
                    val digest = signAndSubmitSend(to = prep.walletAddress, amountUsd = prep.amountUsdsui)
                    postCompleted(direction = "sent", amountUsd = prep.amountUsdsui, counterpartyName = "Bank cash-out", venue = null, digest = digest)
                    val dest = prep.bankLast4?.let { "your bank ••$it" } ?: "your bank"
                    results.add(
                        AgentActionResult(
                            line = "Cashed out ${usd2(prep.amountUsdsui)} to $dest.",
                            kind = "cash_out", amountUsd = prep.amountUsdsui, recipient = dest, digest = digest,
                        ),
                    )
                }

                "request" -> {
                    // Mint a shareable payment link. No signing, no money moves.
                    val amount = planned.amountUsd ?: 0.0
                    if (amount <= 0) continue
                    val resp = agentApi.createRequest(CreateRequestBody(amountUsd = amount, requesterNote = step?.note))
                    val url = resp.payUrl.orEmpty()
                    results.add(
                        AgentActionResult(
                            line = if (url.isEmpty()) "Created a payment link for ${usd2(amount)}."
                            else "Payment link ready for ${usd2(amount)}.",
                            kind = "request", amountUsd = amount, link = url.ifEmpty { null },
                        ),
                    )
                }

                else -> {
                    // swap and any future kinds aren't executable from chat yet,
                    // skip rather than fail the whole plan.
                }
            }
        }
        return results
    }

    // ── Signing rails ──────────────────────────────────────────────────────

    /**
     * The proven Android send pipeline (mirrors `SendViewModel`): the server
     * builds the gasless PTB, we sign the bytes LOCALLY with the ephemeral
     * zkLogin key, then broadcast via /api/send/gasless-submit. Non-custodial:
     * the key never leaves the device.
     */
    private suspend fun signAndSubmitSend(to: String, amountUsd: Double): String {
        val prep = ApiClient.api.sponsorPrepare(SponsorPrepareRequest(to = to, amount = amountUsd))
        val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the send")
        val userSignature = ZkLoginCoordinator.signTransaction(bytes)
        val randomness = SecureStore.jwtRandomness ?: error("session needs a refresh, sign in again")
        val res = ApiClient.api.gaslessSubmit(
            GaslessSubmitRequest(
                bytesB64 = bytes,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = SendMeta(kind = "send", amountUsd = amountUsd),
            ),
        )
        return res.digest ?: error(res.error ?: "the send did not go through")
    }

    /**
     * The Onara-sponsored rail for earn flows (mirrors iOS `signAndSubmit`):
     * sponsor the tx kind → sign the returned bytes locally → sponsor-execute
     * (server assembles the zkLogin proof and broadcasts).
     */
    private suspend fun signAndSubmitKind(transactionKindB64: String, meta: ExecuteMeta): String {
        val sponsor = agentApi.zkSponsor(ZkSponsorRequest(transactionKindB64 = transactionKindB64))
        val bytes = sponsor.bytes ?: error(sponsor.error ?: "could not sponsor that transaction")
        val userSignature = ZkLoginCoordinator.signTransaction(bytes)
        val randomness = SecureStore.jwtRandomness ?: error("session needs a refresh, sign in again")
        val res = agentApi.sponsorExecute(
            SponsorExecuteRequest(
                bytesB64 = bytes,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = meta,
                cachedProof = cachedProof(),
            ),
        )
        res.error?.takeIf { it.isNotBlank() }?.let { error(it) }
        val digest = res.digest ?: error("no digest in response")
        // Cache a freshly minted proof so the next submission skips the mint.
        res.freshProof?.let { SecureStore.proofCache = it.toString() }
        return digest
    }

    /**
     * Only forward a CACHED proof if its shape still looks like what Shinami
     * emits (mirrors the iOS shape check); otherwise drop it so the server
     * mints a fresh one.
     */
    private fun cachedProof(): JsonObject? {
        val raw = SecureStore.proofCache ?: return null
        val obj = runCatching { ApiClient.json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
        return if (obj != null && obj["proofPoints"] is JsonObject) {
            obj
        } else {
            SecureStore.proofCache = null
            null
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private fun postCompleted(
        direction: String,
        amountUsd: Double,
        counterpartyName: String?,
        venue: String?,
        digest: String,
    ) {
        TaliseEvents.emit(
            TaliseEvents.Event.TxCompleted(
                digest = digest,
                direction = direction,
                amountUsdsui = amountUsd,
                counterpartyName = counterpartyName,
                venue = venue,
            ),
        )
    }

    private fun activityLine(e: ActivityEntryDTO): String {
        val amt = usd2(abs(e.amountUsdsui ?: 0.0))
        val who = e.counterpartyName ?: e.counterparty?.let { shortAddr(it) } ?: ""
        return when (e.direction) {
            "received" -> "Received $amt" + if (who.isEmpty()) "" else " from $who"
            "invest" -> "Saved $amt" + (e.venue?.let { " into ${displayVenue(it)}" } ?: "")
            "withdraw" -> "Withdrew $amt" + (e.venue?.let { " from ${displayVenue(it)}" } ?: "")
            else -> "Sent $amt" + if (who.isEmpty()) "" else " to $who"
        }
    }

    fun displayVenue(v: String): String = when (v.lowercase()) {
        "deepbook" -> "DeepBook"
        "navi" -> "NAVI"
        else -> v.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
    }

    fun shortAddr(a: String): String =
        if (a.startsWith("0x") && a.length > 12) "${a.take(6)}…${a.takeLast(4)}" else a
}
