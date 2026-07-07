package io.talise.app.feature.invoices

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
 * State for the invoices hub, mirroring iOS `InvoicesView` @State 1:1
 * (rows / loading / error on the list; creating / error on the create form).
 */
class InvoicesViewModel : ViewModel() {

    private val api = ApiClient.create(InvoicesApi::class.java)

    data class ListUi(
        val rows: List<WorkInvoiceDTO> = emptyList(),
        val loading: Boolean = true,
        val error: String? = null,
    )

    data class CreateUi(
        val creating: Boolean = false,
        val error: String? = null,
        /** Set on success — the share/pay URL, consumed by the screen. */
        val createdUrl: String? = null,
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
                _list.value = ListUi(rows = resp.invoices.sortedByDescending { it.createdAt }, loading = false)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _list.value = _list.value.copy(
                    loading = false,
                    error = workErrorFor(t, "invoices", "Couldn't load your invoices right now."),
                )
            }
        }
    }

    fun createInvoice(amountUsd: Double, customerName: String, memo: String) {
        if (amountUsd < 0.01 || _create.value.creating) return
        _create.value = CreateUi(creating = true)
        viewModelScope.launch {
            try {
                val resp = api.create(
                    InvoiceCreateBody(
                        amountUsd = amountUsd,
                        customerName = customerName.ifEmpty { null },
                        memo = memo.ifEmpty { null },
                    ),
                )
                _create.value = CreateUi(createdUrl = resp.payUrl ?: payUrl(resp.invoice.id))
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _create.value = CreateUi(error = workErrorFor(t, "invoice", "Couldn't create the invoice right now."))
            }
        }
    }

    /** Clear the create-form state when the cover opens or closes. */
    fun resetCreate() {
        _create.value = CreateUi()
    }
}

/**
 * Open + pay an invoice by id (the public /i/<id> flow), mirroring iOS
 * `PayInvoiceView`: load the invoice, send the USDsui to the issuer's address
 * over the normal gasless send rail, then settle it trustlessly with the digest.
 */
class PayInvoiceViewModel : ViewModel() {

    private val api = ApiClient.create(InvoicesApi::class.java)

    data class Ui(
        val invoice: PublicInvoiceDTO? = null,
        val loading: Boolean = true,
        val paying: Boolean = false,
        val paid: Boolean = false,
        val error: String? = null,
    )

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    fun load(invoiceId: String) {
        _ui.value = _ui.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val resp = api.detail(invoiceId)
                _ui.value = _ui.value.copy(invoice = resp.invoice, loading = false)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _ui.value = _ui.value.copy(
                    loading = false,
                    error = workErrorFor(t, "invoice", "Couldn't open this invoice right now."),
                )
            }
        }
    }

    fun pay(invoiceId: String) {
        val inv = _ui.value.invoice ?: return
        val issuer = inv.issuer ?: return
        if (_ui.value.paying) return
        _ui.value = _ui.value.copy(paying = true, error = null)
        viewModelScope.launch {
            try {
                // 1. Prepare — the server builds the gasless PTB and returns signable bytes.
                val prep = ApiClient.api.sponsorPrepare(
                    SponsorPrepareRequest(to = issuer.address, amount = inv.amountUsd),
                )
                val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the send")

                // 2. Sign locally with the ephemeral zkLogin key (non-custodial).
                val userSignature = ZkLoginCoordinator.signTransaction(bytes)
                val randomness = SecureStore.jwtRandomness
                    ?: error("Sign in again, your session needs a refresh.")

                // 3. Submit — the server assembles the zkLogin proof and broadcasts.
                val res = ApiClient.api.gaslessSubmit(
                    GaslessSubmitRequest(
                        bytesB64 = bytes,
                        ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                        maxEpoch = SecureStore.maxEpoch,
                        randomness = randomness,
                        userSignature = userSignature,
                        meta = SendMeta(kind = "send", amountUsd = inv.amountUsd),
                    ),
                )
                val digest = res.digest ?: error(res.error ?: "the send did not go through")
                TaliseEvents.emitTxCompleted(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "sent",
                        amountUsdsui = inv.amountUsd,
                        counterpartyName = issuer.handle,
                    ),
                )

                // 4. Settle trustlessly — server verifies the digest credited the issuer.
                val r = api.settle(invoiceId, InvoiceSettleBody(digest = digest))
                _ui.value = _ui.value.copy(paying = false, paid = r.ok)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _ui.value = _ui.value.copy(
                    paying = false,
                    error = workErrorFor(t, "invoice", t.message ?: "Couldn't pay this invoice right now."),
                )
            }
        }
    }
}
