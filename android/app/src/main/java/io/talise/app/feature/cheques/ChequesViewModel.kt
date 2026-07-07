package io.talise.app.feature.cheques

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.feature.rules.TaliseSigning
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * State for the cheques flows, mirroring iOS `ChequeWriteView` /
 * `ChequeIssuedView` / `MyChequesView` / `ChequeClaimView` @State 1:1.
 *
 * A cheque is money in a link: create (amount, payee label, memo, optional
 * country gate) → fund the escrow on-chain with a local zkLogin signature →
 * share the claim URL. Unclaimed cheques can be reclaimed ("Claim it back")
 * by the creator; anyone with the link cashes it via /claim/release.
 */
class ChequesViewModel : ViewModel() {

    private val api = ApiClient.create(ChequesApi::class.java)

    // MARK: - Write / issued

    data class WriteUi(
        val issuing: Boolean = false,
        val error: String? = null,
        val issued: ChequeCreateResp? = null,
        // Issued-view reclaim state (iOS ChequeIssuedView).
        val reclaiming: Boolean = false,
        val reclaimed: Boolean = false,
        val reclaimError: String? = null,
    )

    private val _write = MutableStateFlow(WriteUi())
    val write: StateFlow<WriteUi> = _write.asStateFlow()

    /**
     * Issue the cheque, then fund it. Two rails, picked by the server's `mode`:
     *   • "onchain" → sign the sponsor-ready `cheque::create` bytes over the
     *     sponsor-execute rail (Onara pays gas).
     *   • "escrow" / absent → fund the escrow address over the normal send
     *     rail (gasless / sponsored).
     * Either way, the digest goes to confirm-funded to flip draft→funded.
     */
    fun issue(amountUsd: Double, payee: String, memo: String, gateCountry: Boolean, country: String) {
        if (amountUsd < 0.01 || payee.isEmpty() || _write.value.issuing) return
        _write.value = _write.value.copy(issuing = true, error = null)
        viewModelScope.launch {
            try {
                val created = api.create(
                    ChequeCreateBody(
                        amountUsd = amountUsd,
                        payeeLabel = payee,
                        memo = memo.ifEmpty { null },
                        allowedCountries = if (gateCountry) listOf(country.uppercase()) else emptyList(),
                    ),
                )

                val digest: String
                if (created.mode == "onchain" && created.fundingBytes != null) {
                    digest = TaliseSigning.executeSponsorReady(created.fundingBytes)
                } else if (created.escrowAddress != null) {
                    digest = TaliseSigning.signAndSubmitSend(created.escrowAddress, amountUsd)
                } else {
                    _write.value = _write.value.copy(issuing = false, error = "Couldn't issue the cheque right now.")
                    return@launch
                }
                api.confirmFunded(created.chequeId, ChequeDigestBody(digest))
                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest, direction = "sent",
                        amountUsdsui = amountUsd, counterpartyName = "Cheque",
                    ),
                )
                _write.value = _write.value.copy(issuing = false, issued = created)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _write.value = _write.value.copy(
                    issuing = false,
                    error = chequeErrorFor(t, "issue", "Couldn't issue the cheque right now."),
                )
            }
        }
    }

    /**
     * Reclaim ("Claim back") the unclaimed cheque the creator just issued.
     *   • On-chain rail: the BUILD POST returns sponsor-ready `reclaimBytes`;
     *     we sign+execute, then a CONFIRM POST with the reclaim `{digest}`
     *     flips funded→reclaimed server-side.
     *   • Escrow rail: the single POST refunds server-side — no signature.
     */
    fun reclaimIssued() {
        val issued = _write.value.issued ?: return
        if (_write.value.reclaiming) return
        _write.value = _write.value.copy(reclaiming = true, reclaimError = null)
        viewModelScope.launch {
            try {
                val (digest, _) = performReclaim(issued.chequeId)
                if (digest != null) {
                    TaliseEvents.emitTxCompleted(
                        TaliseEvents.Event.TxCompleted(
                            digest = digest, direction = "received",
                            amountUsdsui = issued.amountUsd, counterpartyName = "Cheque",
                        ),
                    )
                }
                _write.value = _write.value.copy(reclaiming = false, reclaimed = true)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _write.value = _write.value.copy(
                    reclaiming = false,
                    reclaimError = chequeErrorFor(t, "reclaim", "Couldn't claim this cheque back right now."),
                )
            }
        }
    }

    /** Reset the write flow (new cheque after Done). */
    fun resetWrite() {
        _write.value = WriteUi()
    }

    // MARK: - My cheques

    data class MyUi(
        val rows: List<MyChequeRow> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
        /** Cheque ids with an in-flight reclaim, so we can spin only that row. */
        val reclaiming: Set<String> = emptySet(),
    )

    private val _mine = MutableStateFlow(MyUi())
    val mine: StateFlow<MyUi> = _mine.asStateFlow()

    fun loadMine() {
        _mine.value = _mine.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val resp = api.mine()
                _mine.value = _mine.value.copy(rows = resp.cheques, loading = false)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _mine.value = _mine.value.copy(
                    loading = false,
                    error = chequeErrorFor(t, "load", "Couldn't load your cheques right now."),
                )
            }
        }
    }

    /** Reclaim ("Claim it back") one row — mirrors `MyChequesView.reclaim()`. */
    fun reclaimRow(row: MyChequeRow) {
        if (_mine.value.reclaiming.contains(row.id)) return
        _mine.value = _mine.value.copy(reclaiming = _mine.value.reclaiming + row.id)
        viewModelScope.launch {
            try {
                val (digest, status) = performReclaim(row.id)
                if (digest != null) {
                    TaliseEvents.emitTxCompleted(
                        TaliseEvents.Event.TxCompleted(
                            digest = digest, direction = "received",
                            amountUsdsui = row.amountUsd, counterpartyName = "Cheque",
                        ),
                    )
                }
                // Reflect the reclaim immediately, then reconcile from the server.
                val updated = _mine.value.rows.map {
                    if (it.id == row.id) it.copy(status = status ?: "reclaimed", reclaimable = false) else it
                }
                _mine.value = _mine.value.copy(rows = updated, reclaiming = _mine.value.reclaiming - row.id)
                loadMine()
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _mine.value = _mine.value.copy(
                    reclaiming = _mine.value.reclaiming - row.id,
                    error = chequeErrorFor(t, "reclaim", "Couldn't claim this cheque back right now."),
                )
            }
        }
    }

    /**
     * Shared reclaim: BUILD POST → (on-chain rail) sign + CONFIRM POST.
     * Returns the refund digest + final status.
     */
    private suspend fun performReclaim(id: String): Pair<String?, String?> {
        val built = api.reclaim(id, ChequeReclaimBody())
        var refundDigest = built.digest
        var finalStatus = built.status
        if (built.mode == "onchain" && built.reclaimBytes != null) {
            // Creator signs the sponsored cheque::reclaim PTB.
            val digest = TaliseSigning.executeSponsorReady(built.reclaimBytes)
            refundDigest = digest
            // Confirm: record the reclaim digest CREATOR-only (funded→reclaimed).
            val confirmed = api.reclaim(id, ChequeReclaimBody(digest = digest))
            finalStatus = confirmed.status ?: finalStatus
        }
        return refundDigest to finalStatus
    }

    // MARK: - Claim (cash a cheque)

    data class ClaimUi(
        val preview: ChequePreviewResp? = null,
        val parsedId: String? = null,
        val parsedSecret: String? = null,
        val loading: Boolean = false,
        val claiming: Boolean = false,
        val error: String? = null,
        val claimedAmount: Double? = null,
    )

    private val _claim = MutableStateFlow(ClaimUi())
    val claim: StateFlow<ClaimUi> = _claim.asStateFlow()

    fun openLink(linkText: String) {
        val parsed = parseChequeLink(linkText.trim())
        if (parsed == null) {
            _claim.value = _claim.value.copy(error = "That doesn't look like a cheque link.")
            return
        }
        val (id, secret) = parsed
        _claim.value = _claim.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val p = api.preview(id, secret)
                _claim.value = _claim.value.copy(
                    preview = p, parsedId = id, parsedSecret = secret, loading = false,
                )
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                // Service genuinely not live yet (503 / "disabled"). A bare 404
                // here is ambiguous — it usually means an invalid or
                // already-claimed cheque — so that keeps its own copy.
                _claim.value = _claim.value.copy(
                    loading = false,
                    error = if (chequeIsRollout(t)) {
                        "Cheques are rolling out, check back soon."
                    } else {
                        "Couldn't open this cheque, it may be invalid or already claimed."
                    },
                )
            }
        }
    }

    fun cash() {
        val state = _claim.value
        val id = state.parsedId ?: return
        val secret = state.parsedSecret ?: return
        if (state.claiming) return
        _claim.value = state.copy(claiming = true, error = null)
        viewModelScope.launch {
            try {
                val r = api.claimRelease(id, ChequeClaimBody(secret = secret))
                if (r.ok) {
                    val digest = r.digest
                    val amt = r.amountUsd
                    if (digest != null && amt != null) {
                        TaliseEvents.emitTxCompleted(
                            TaliseEvents.Event.TxCompleted(
                                digest = digest, direction = "received",
                                amountUsdsui = amt, counterpartyName = "Cheque",
                            ),
                        )
                    }
                    _claim.value = _claim.value.copy(
                        claiming = false,
                        claimedAmount = r.amountUsd ?: _claim.value.preview?.amountUsd,
                    )
                } else {
                    _claim.value = _claim.value.copy(claiming = false)
                }
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _claim.value = _claim.value.copy(
                    claiming = false,
                    error = chequeErrorFor(t, "cash", "Couldn't cash this cheque right now."),
                )
            }
        }
    }

    fun resetClaim() {
        _claim.value = ClaimUi()
    }
}
