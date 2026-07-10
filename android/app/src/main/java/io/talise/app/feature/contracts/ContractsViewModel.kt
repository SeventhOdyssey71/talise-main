package io.talise.app.feature.contracts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.feature.invoices.workErrorFor
import io.talise.app.feature.rules.TaliseSigning
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * State for the Contracts hub, mirroring iOS `ContractsView` /
 * `CreateContractView` @State 1:1 (rows / loading / error / cancelling on
 * the list; creating / error / created on the create flow).
 */
class ContractsViewModel : ViewModel() {

    private val api = ApiClient.create(ContractsApi::class.java)

    data class ListUi(
        val rows: List<ContractDTO> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
        val cancelling: Set<String> = emptySet(),
    )

    data class CreateUi(
        val creating: Boolean = false,
        val error: String? = null,
        val created: Boolean = false,
    )

    private val _list = MutableStateFlow(ListUi())
    val list: StateFlow<ListUi> = _list.asStateFlow()

    private val _create = MutableStateFlow(CreateUi())
    val create: StateFlow<CreateUi> = _create.asStateFlow()

    fun load() {
        _list.value = _list.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val resp = api.list()
                _list.value = _list.value.copy(
                    rows = resp.contracts.sortedByDescending { it.createdAt },
                    loading = false,
                )
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _list.value = _list.value.copy(
                    loading = false,
                    error = workErrorFor(t, "contracts", "Couldn't load your contracts right now."),
                )
            }
        }
    }

    /**
     * Cancel a contract. The server stops the stream + flips status, then
     * EITHER refunds server-side (escrow rail) OR points us at the stream
     * cancel endpoint to sign the on-chain withdrawal (on-chain rail).
     */
    fun cancel(c: ContractDTO) {
        if (_list.value.cancelling.isNotEmpty()) return
        _list.value = _list.value.copy(cancelling = setOf(c.id), error = null)
        viewModelScope.launch {
            try {
                val r = api.action(c.id, ContractActionBody(action = "cancel"))
                val path = r.onchainCancelPath
                if (path != null) {
                    // On-chain rail: sign the sender-only withdrawal via the stream cancel endpoint.
                    val cancel = api.streamCancelAt(path)
                    if (cancel.mode == "onchain" && cancel.bytes != null) {
                        val digest = TaliseSigning.executeSponsorReady(cancel.bytes)
                        val refund = cancel.refundUsd ?: r.refundUsd
                        if (refund != null && refund > 0) {
                            TaliseEvents.emitTxCompleted(
                                TaliseEvents.Event.TxCompleted(
                                    digest = digest, direction = "received",
                                    amountUsdsui = refund, counterpartyName = "Contract refund",
                                ),
                            )
                        }
                    }
                } else if (r.refundUsd != null && r.refundUsd > 0 && r.refunded == true) {
                    // Escrow rail refunded server-side — reflect it in activity.
                    TaliseEvents.emitTxCompleted(
                        TaliseEvents.Event.TxCompleted(
                            digest = "contract-refund-${c.id}", direction = "received",
                            amountUsdsui = r.refundUsd, counterpartyName = "Contract refund",
                        ),
                    )
                }
                _list.value = _list.value.copy(cancelling = emptySet())
                load()
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _list.value = _list.value.copy(
                    cancelling = emptySet(),
                    error = workErrorFor(t, "contract", "Couldn't cancel the contract right now."),
                )
            }
        }
    }

    /**
     * 1. Fund the underlying stream (create-prepare → sign → record).
     * 2. POST /api/contracts with the resulting streamId + funding digest.
     */
    fun createContract(
        to: String,
        toHandle: String?,
        title: String,
        rateUsd: Double,
        cadence: String,
        periods: Int,
        intervalMinutes: Int,
    ) {
        if (_create.value.creating) return
        _create.value = _create.value.copy(creating = true, error = null)
        val totalUsd = rateUsd * periods
        // Long math: monthly cadence is 43_200 minutes -> 2_592_000_000 ms,
        // which overflows Int (Swift's Int is 64-bit, so iOS never hit this).
        val intervalMs = intervalMinutes * 60_000L
        viewModelScope.launch {
            try {
                // ── Fund the stream. ──────────────────────────────────────
                val prep = api.streamCreatePrepare(
                    CtrStreamPrepareBody(to = to, totalUsd = totalUsd, intervalMs = intervalMs, numTranches = periods),
                )
                if (!prep.error.isNullOrEmpty()) {
                    _create.value = _create.value.copy(creating = false, error = prep.error)
                    return@launch
                }

                val digest: String
                if (prep.mode == "onchain" && prep.bytes != null) {
                    digest = TaliseSigning.executeSponsorReady(prep.bytes)
                } else {
                    val escrowAddr = prep.escrowAddress ?: api.streamEscrow().escrowAddress
                    digest = TaliseSigning.signAndSubmitSend(escrowAddr, totalUsd)
                }

                // Keep micros in Long: totals above $2,147.48 overflow Int.
                val totalMicros = Math.round(totalUsd * 1_000_000)
                val trancheMicros = totalMicros / maxOf(1, periods)
                val now = System.currentTimeMillis()
                val rec = api.streamRecord(
                    CtrStreamRecordBody(
                        fundingDigest = digest,
                        recipientAddress = to,
                        recipientHandle = toHandle,
                        totalMicros = totalMicros.toString(),
                        trancheMicros = trancheMicros.toString(),
                        numTranches = periods,
                        startMs = now,
                        intervalMs = intervalMs,
                    ),
                )
                val streamId = rec.id
                if (streamId.isNullOrEmpty()) {
                    _create.value = _create.value.copy(
                        creating = false,
                        error = "Funded the stream but couldn't link the contract. Check your contracts list.",
                    )
                    return@launch
                }

                // ── Persist the contract metadata wrapping the stream. ────
                api.create(
                    ContractCreateBody(
                        streamId = streamId,
                        payeeAddress = to,
                        payeeHandle = toHandle,
                        title = title,
                        rateUsd = rateUsd,
                        cadence = cadence,
                        periods = periods,
                        fundingDigest = digest,
                    ),
                )
                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest, direction = "sent",
                        amountUsdsui = totalUsd, counterpartyName = "Contract",
                    ),
                )
                _create.value = _create.value.copy(creating = false, created = true)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _create.value = _create.value.copy(
                    creating = false,
                    error = workErrorFor(t, "contract", "Couldn't create the contract right now."),
                )
            }
        }
    }

    /** Clear the create-flow state when the cover opens or closes. */
    fun resetCreate() {
        _create.value = CreateUi()
    }
}
