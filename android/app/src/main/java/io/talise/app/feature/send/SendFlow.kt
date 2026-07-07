package io.talise.app.feature.send

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * Root container for the multi-page Send flow — the Android port of iOS
 * `SendFlowView`. Drives navigation off [SendStep], owns the shared
 * [SendDraft], and hands the confirm over to [SendViewModel] which runs the
 * proven sponsor pipeline (resolve → `/api/send/sponsor-prepare` → local
 * zkLogin sign → `/api/send/gasless-submit`). Only the layout above the
 * pipeline lives here; every screen is a split file mirroring its iOS
 * counterpart (SendAmountView / SendRecipientView / SendReviewView /
 * SendInProgressView / SendCompleteView / SendFailureView).
 *
 * Non-custodial and unchanged: the ephemeral key never leaves the device;
 * the server assembles the zkLogin proof from its stored JWT+salt.
 */
@Composable
fun SendFlow(onClose: () -> Unit, vm: SendViewModel = viewModel()) {
    var step by remember { mutableStateOf(SendStep.Amount) }
    // Android's display currency is USD today; the draft keeps the iOS shape
    // so the cross-border helpers work identically (dormant for USD sends).
    val draft = remember { SendDraft(SendCurrencies.usd) }
    val state by vm.state.collectAsStateWithLifecycle()

    // Display-only FX snapshot for the cross-border receive lines. Soft-fails
    // to a USD baseline and never touches the send/limit money path.
    LaunchedEffect(Unit) { SendFx.refresh() }

    // React to the pipeline outcome. Success requires a non-empty digest
    // (enforced in the ViewModel), so the green celebration NEVER renders on a
    // failure — every thrown error routes to the failure screen instead.
    LaunchedEffect(state) {
        when (val s = state) {
            is SendViewModel.State.Success -> {
                val addr = draft.resolved?.address ?: s.recipient
                draft.success = SendSuccess(
                    digest = s.digest,
                    displayAmount = draft.rawAmount.ifEmpty { "0" },
                    currency = draft.currency,
                    usdsui = s.amount,
                    recipientAddress = addr,
                    recipientDisplay = draft.resolved?.displayName
                        ?.takeIf { it.isNotEmpty() && it != addr }
                        ?: shortAddress(addr),
                )
                step = SendStep.Complete
            }
            is SendViewModel.State.Error -> {
                draft.errorMessage = s.message
                step = SendStep.Failure
            }
            else -> Unit
        }
    }

    when (step) {
        SendStep.Amount -> SendAmountView(
            draft = draft,
            onNext = { step = SendStep.Recipient },
            onCancel = onClose,
        )
        SendStep.Recipient -> SendRecipientView(
            draft = draft,
            onNext = { step = SendStep.Review },
            onBack = { step = SendStep.Amount },
            onClose = onClose,
        )
        SendStep.Review -> SendReviewView(
            draft = draft,
            onConfirm = {
                // The slide-to-send gesture IS the intent confirmation — no
                // PIN/biometric re-auth on the send path. Push the in-flight
                // page and kick off the sponsor pipeline; the recipient is
                // already resolved, so hand the 0x address straight through.
                val resolved = draft.resolved
                if (resolved != null && draft.amountUsdsui > 0.0) {
                    draft.errorMessage = null
                    step = SendStep.Sending
                    vm.send(draft.amountUsdsui, resolved.address)
                }
            },
            onBack = { step = SendStep.Recipient },
        )
        SendStep.Sending -> SendInProgressView(
            draft = draft,
            onDone = onClose,
        )
        SendStep.Complete -> SendCompleteView(
            draft = draft,
            onDone = onClose,
        )
        SendStep.Failure -> SendFailureView(
            draft = draft,
            onTryAgain = {
                // Drop back to the amount screen so the user can correct the
                // input and retry. Clear the error and reset the pipeline so
                // it doesn't leak across attempts.
                draft.errorMessage = null
                vm.reset()
                step = SendStep.Amount
            },
            onDone = onClose,
        )
    }
}
