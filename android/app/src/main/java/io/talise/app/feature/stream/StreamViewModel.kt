package io.talise.app.feature.stream

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Signs sponsor-ready bytes with the ephemeral zkLogin key and executes them
 * through /api/zk/sponsor-execute — the Android port of iOS
 * `ZkLoginCoordinator.executeSponsorReady(bytesB64:intent:)`.
 */
private suspend fun executeSponsorReady(bytesB64: String): String {
    val userSignature = ZkLoginCoordinator.signTransaction(bytesB64)
    val randomness = SecureStore.jwtRandomness
        ?: error("Sign in again, your session needs a refresh.")
    val res = StreamBackend.api.sponsorExecute(
        StreamZkExecuteBody(
            bytesB64 = bytesB64,
            ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
            maxEpoch = SecureStore.maxEpoch,
            randomness = randomness,
            userSignature = userSignature,
        ),
    )
    res.error?.let { error(it) }
    return res.digest?.takeIf { it.isNotEmpty() } ?: error("no digest in response")
}

/**
 * Stream setup pipeline — the Android counterpart of iOS `StreamSetupView`'s
 * `start()`. Builds the funding tx via /api/streams/create-prepare; the server
 * picks the rail and returns `mode`:
 *   • "onchain" → sign the sponsor-ready `stream::create` bytes (Onara pays gas).
 *   • otherwise → fund the escrow address over the normal send rail
 *     (gasless prepare → local sign → gasless-submit, sponsored fallback).
 * Then records the schedule via /api/streams/record.
 */
class StreamSetupViewModel : ViewModel() {

    private val _starting = MutableStateFlow(false)
    val starting: StateFlow<Boolean> = _starting.asStateFlow()

    private val _started = MutableStateFlow(false)
    val started: StateFlow<Boolean> = _started.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun start(
        to: String,
        recipientHandle: String?,
        totalUsd: Double,
        intervalMin: Int,
        numTranches: Int,
    ) {
        if (_starting.value) return
        viewModelScope.launch {
            _starting.value = true
            _error.value = null
            val totalMicros = Math.round(totalUsd * 1_000_000)
            val trancheMicros = totalMicros / numTranches
            val intervalMs = intervalMin * 60_000L
            val now = System.currentTimeMillis()
            try {
                val prep = StreamBackend.api.createPrepare(
                    StreamPrepareBody(
                        to = to,
                        totalUsd = totalUsd,
                        intervalMs = intervalMs,
                        numTranches = numTranches,
                    ),
                )
                if (!prep.error.isNullOrEmpty()) {
                    _error.value = prep.error
                    return@launch
                }

                val fundingDigest: String
                if (prep.mode == "onchain" && prep.bytes != null) {
                    fundingDigest = executeSponsorReady(prep.bytes)
                } else {
                    // Escrow rail: fund the escrow address over the normal send
                    // rail. create-prepare already returns the escrow address in
                    // its plan; fall back to /api/streams/escrow if absent.
                    val escrowAddr = prep.escrowAddress ?: StreamBackend.api.escrow().escrowAddress
                    fundingDigest = sendToEscrow(escrowAddr, totalUsd)
                }

                StreamBackend.api.record(
                    StreamRecordBody(
                        fundingDigest = fundingDigest,
                        recipientAddress = to,
                        recipientHandle = recipientHandle,
                        totalMicros = totalMicros.toString(),
                        trancheMicros = trancheMicros.toString(),
                        numTranches = numTranches,
                        startMs = now,
                        intervalMs = intervalMs,
                    ),
                )

                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = fundingDigest,
                        direction = "sent",
                        amountUsdsui = totalUsd,
                        counterpartyName = "Stream",
                    ),
                )
                _started.value = true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val http = streamHttpError(e)
                _error.value = if (http != null) {
                    friendlyStreamError(http.first, http.second)
                } else {
                    e.message ?: "Couldn't start the stream right now."
                }
            } finally {
                _starting.value = false
            }
        }
    }

    /**
     * Fund the stream escrow over the normal send rail — iOS
     * `signAndSubmitSend(to:amountUsd:)`. The server returns `mode`:
     *   • "gasless"   → broadcast via /api/send/gasless-submit
     *   • "sponsored" → broadcast via /api/zk/sponsor-execute
     */
    private suspend fun sendToEscrow(escrowAddr: String, amountUsd: Double): String {
        val prep = ApiClient.api.sponsorPrepare(SponsorPrepareRequest(to = escrowAddr, amount = amountUsd))
        prep.error?.takeIf { it.isNotEmpty() }?.let { error(it) }
        val bytes = prep.bytes ?: error("malformed sponsor-prepare response")
        val userSignature = ZkLoginCoordinator.signTransaction(bytes)
        val randomness = SecureStore.jwtRandomness
            ?: error("Sign in again, your session needs a refresh.")
        return if (prep.mode == "gasless") {
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
            res.digest ?: error(res.error ?: "the send did not go through")
        } else {
            val res = StreamBackend.api.sponsorExecute(
                StreamZkExecuteBody(
                    bytesB64 = bytes,
                    ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                    maxEpoch = SecureStore.maxEpoch,
                    randomness = randomness,
                    userSignature = userSignature,
                ),
            )
            res.error?.let { error(it) }
            res.digest?.takeIf { it.isNotEmpty() } ?: error("no digest in response")
        }
    }
}

/**
 * Active-streams list — the Android counterpart of iOS `StreamsListView`.
 * Loads /api/streams, auto-claims accrued tranches for incoming streams once
 * per session, and drives the sender cancel + recipient claim flows.
 */
class StreamsListViewModel : ViewModel() {

    private val _streams = MutableStateFlow<List<StreamDTO>>(emptyList())
    val streams: StateFlow<List<StreamDTO>> = _streams.asStateFlow()

    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()

    private val _cancellingId = MutableStateFlow<String?>(null)
    val cancellingId: StateFlow<String?> = _cancellingId.asStateFlow()

    private val _claimingId = MutableStateFlow<String?>(null)
    val claimingId: StateFlow<String?> = _claimingId.asStateFlow()

    private val _cancelError = MutableStateFlow<String?>(null)
    val cancelError: StateFlow<String?> = _cancelError.asStateFlow()

    /**
     * Tranches claimed per stream this session — drives the "next claim in Xs"
     * cooldown so the button locks until the next tranche is actually due.
     */
    private val _claimedMark = MutableStateFlow<Map<String, Int>>(emptyMap())
    val claimedMark: StateFlow<Map<String, Int>> = _claimedMark.asStateFlow()

    /** Streams already auto-claimed this session — once per stream, not per refresh. */
    private val autoClaimed = mutableSetOf<String>()

    init {
        viewModelScope.launch {
            loadInternal()
            autoClaimAccrued()
        }
    }

    fun reload() {
        viewModelScope.launch { loadInternal() }
    }

    private suspend fun loadInternal() {
        _loading.value = true
        try {
            _streams.value = StreamBackend.api.list().streams
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            _streams.value = emptyList()
        } finally {
            _loading.value = false
        }
    }

    /**
     * Auto-pull accrued tranches for every incoming stream when the recipient
     * opens the list — funds land without a manual tap (still just the
     * on-chain Clock + claim_accrued, no cron). Best-effort + silent: once per
     * stream per session, only when something has accrued; the manual "Claim
     * available" button stays for later accruals. Refreshes once after.
     */
    private suspend fun autoClaimAccrued() {
        var claimedAny = false
        for (s in _streams.value) {
            if (s.role == "recipient" && s.state == "active" &&
                (s.tranchesDone ?: 0) > 0 && !autoClaimed.contains(s.id)
            ) {
                autoClaimed.add(s.id)
                if (silentClaim(s)) claimedAny = true
            }
        }
        if (claimedAny) loadInternal()
    }

    /** Silent claim for the auto path — no spinner, no error surfaced. */
    private suspend fun silentClaim(s: StreamDTO): Boolean {
        try {
            val r = StreamBackend.api.claim(s.id)
            if (r.mode == "onchain" && r.bytes != null) {
                executeSponsorReady(r.bytes)
                _claimedMark.value = _claimedMark.value + (s.id to liveAccrued(s, System.currentTimeMillis()))
                TaliseEvents.emit(TaliseEvents.Event.HomeShouldRefresh)
                return true
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Best-effort: a session lapse or build hiccup just leaves the
            // manual Claim button as the fallback. Never surfaced.
        }
        return false
    }

    /**
     * Cancel a stream (sender-only). The server flips the row to cancelled,
     * then EITHER refunds the remainder server-side (escrow rail) OR returns
     * sponsor-ready `cancel_and_withdraw` bytes for the sender to sign
     * (on-chain rail) — only the sender's zkLogin can withdraw the on-chain
     * remainder.
     */
    fun cancel(s: StreamDTO) {
        if (_cancellingId.value != null) return
        viewModelScope.launch {
            _cancellingId.value = s.id
            _cancelError.value = null
            try {
                val r = StreamBackend.api.cancel(s.id)
                if (r.mode == "onchain" && r.bytes != null) {
                    val digest = executeSponsorReady(r.bytes)
                    val refund = r.refundUsd ?: 0.0
                    if (refund > 0) {
                        TaliseEvents.emitTxCompleted(
                            TaliseEvents.Event.TxCompleted(
                                digest = digest,
                                direction = "received",
                                amountUsdsui = refund,
                                counterpartyName = "Stream refund",
                            ),
                        )
                    }
                }
                loadInternal()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val http = streamHttpError(e)
                _cancelError.value = if (http != null) {
                    friendlyStreamError(http.first, http.second)
                } else {
                    "Couldn't cancel the stream right now."
                }
            } finally {
                _cancellingId.value = null
            }
        }
    }

    /**
     * Recipient claim: pull the Clock-accrued tranches into the wallet. The
     * server builds the Onara-sponsored `stream::claim_accrued` PTB; we sign +
     * execute it. The on-chain contract only ever pays the hardwired
     * recipient, so this is safe even though the call is permissionless.
     */
    fun claim(s: StreamDTO) {
        if (_claimingId.value != null) return
        viewModelScope.launch {
            _claimingId.value = s.id
            _cancelError.value = null
            try {
                val r = StreamBackend.api.claim(s.id)
                if (r.mode == "onchain" && r.bytes != null) {
                    executeSponsorReady(r.bytes)
                    // Pulled everything due as of now → lock the button until
                    // the next tranche's clock time.
                    _claimedMark.value = _claimedMark.value + (s.id to liveAccrued(s, System.currentTimeMillis()))
                    TaliseEvents.emit(TaliseEvents.Event.HomeShouldRefresh)
                }
                loadInternal()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val http = streamHttpError(e)
                _cancelError.value = if (http != null) {
                    friendlyStreamError(http.first, http.second)
                } else {
                    "Couldn't claim the stream right now."
                }
            } finally {
                _claimingId.value = null
            }
        }
    }
}

/**
 * Tranches the on-chain Clock has released by [nowMs] (mirrors the contract +
 * the server's projection). Falls back to the server-sent count if the
 * schedule fields are missing.
 */
internal fun liveAccrued(s: StreamDTO, nowMs: Long): Int {
    val num = s.numTranches ?: 0
    val start = s.startMs
    val interval = s.intervalMs
    if (start == null || interval == null || interval <= 0 || num <= 0) {
        return s.tranchesDone ?: 0
    }
    val now = nowMs.toDouble()
    if (now < start) return 0
    val due = ((now - start) / interval).toInt() + 1 // first tranche fires at start
    return due.coerceIn(0, num)
}

/** Clock time the NEXT (yet-unaccrued) tranche becomes due. */
internal fun nextDueMs(s: StreamDTO, accrued: Int): Double =
    (s.startMs ?: 0.0) + accrued.toDouble() * (s.intervalMs ?: 0.0)

internal fun countdownLabel(secs: Int): String =
    if (secs >= 60) "${secs / 60}m ${secs % 60}s" else "${secs}s"
