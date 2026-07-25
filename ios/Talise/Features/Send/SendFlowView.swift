import SwiftUI

/// Root container for the multi-page Send flow. Drives navigation off
/// `step`, owns the shared `SendDraft`, and runs the actual sponsor-
/// execute when the user confirms.
///
/// We use `NavigationStack` with a `path` driven by the `SendStep`
/// enum so each screen can `pop` cleanly without sharing transient
/// UI state. The backend round-trip (`/api/send/prepare` →
/// `ZkLoginCoordinator.signAndSubmit`) is identical to the legacy
/// view — only the layout above it changes.
struct SendFlowView: View {
    var onDone: (() -> Void)?

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var path: [SendStep] = []
    @State private var draft = SendDraft(currency: CurrencySettings.shared.current)
    // Note (2026-05-29): the consolidation-attempt state flag was removed
    // alongside the autoswap archive. ACCUMULATOR_UNDERFUNDED now routes
    // straight to .failure with a top-up/swap hint; users move stray
    // Coin<T> balances via the explicit "Swap to USDsui" CTA on Home.

    var body: some View {
        NavigationStack(path: $path) {
            SendAmountView(
                draft: draft,
                onNext: { path.append(.recipient) },
                onCancel: { close() }
            )
            // Entering the amount screen IS the start of a send attempt, so
            // send_started -> send_reviewed -> send_completed/failed gives the
            // full drop-off curve for the money-out funnel.
            .onAppear { Growth.shared.track(.sendStarted, surface: "send.amount", status: .started) }
            .navigationDestination(for: SendStep.self) { step in
                switch step {
                case .amount:
                    // Should never be pushed; root is amount. Render a
                    // self-popping shim so the stack stays consistent
                    // if someone pushes it by accident.
                    Color.clear.onAppear { path.removeAll() }
                case .recipient:
                    SendRecipientView(
                        draft: draft,
                        onNext: { path.append(.review) },
                        onBack: { pop() },
                        onClose: { close() }
                    )
                case .review:
                    SendReviewView(
                        draft: draft,
                        onConfirm: { await confirm() },
                        onBack: { pop() }
                    )
                case .sending:
                    SendInProgressView(
                        draft: draft,
                        onDone: { close() }
                    )
                    // Block the swipe-back gesture mid-submit so the user
                    // can't accidentally land on the review page while
                    // sponsor-execute is still in flight.
                    .navigationBarBackButtonHidden(true)
                case .complete:
                    SendCompleteView(
                        draft: draft,
                        onDone: { close() }
                    )
                    .navigationBarBackButtonHidden(true)
                    // Note (2026-05-29): the post-send `VaultAPI.sweepNow()`
                    // fire-and-forget was removed alongside the autoswap
                    // archive. The recipient's @handle → wallet drain no
                    // longer runs at all; future sweeps are explicit.
                case .failure:
                    SendFailureView(
                        draft: draft,
                        onTryAgain: {
                            // Drop back to the amount screen so the
                            // user can correct the input (or top up
                            // their accumulator) and retry. We clear
                            // the error so it doesn't leak across
                            // attempts.
                            draft.errorMessage = nil
                            path = []
                        },
                        onDone: { close() }
                    )
                    .navigationBarBackButtonHidden(true)
                }
            }
        }
        .tint(TaliseColor.fg)
        // No drag indicator — we present as `.fullScreenCover` from
        // AppRoot, not a bottom sheet. Mid-flow swipe-down dismiss
        // would land users on a half-confirmed state.
        //
        // The PIN host was removed here alongside dropping PIN re-auth on
        // the send path — the slide-to-send gesture is now the intent
        // confirmation. PinGate is still hosted at the AppRoot level for
        // app-unlock and Earn supply.
    }

    // MARK: - Navigation

    private func pop() {
        guard !path.isEmpty else { return }
        path.removeLast()
    }

    private func close() {
        onDone?()
        dismiss()
    }

    // MARK: - Confirm

    /// Posts to /api/send/prepare, runs the sponsored sign+submit, then
    /// drops the user on the complete page. Pushes `.sending`
    /// immediately so the user gets visual feedback while we wait for
    /// the chain.
    private func confirm() async {
        guard let resolved = draft.resolved, draft.amountUsdsui > 0 else { return }
        draft.errorMessage = nil

        // The slide-to-send gesture on the Review screen IS the intent
        // confirmation now — no PIN/biometric re-auth on the send path.
        // The session is already zkLogin-authenticated; the slide is a
        // deliberate, hard-to-trigger-by-accident confirmation gesture
        // (Cash App style). PIN re-auth remains on Earn supply and app
        // unlock. Push the in-flight page and run the network round-trip.
        let intentLabel = "Send \(draft.currency.symbol)\(draft.rawAmount)"
        path.append(.sending)

        // Send funnel: reviewed -> completed/failed. The amount is BANDED
        // inside Growth.track, and the recipient is never attached.
        Growth.shared.track(
            .sendReviewed,
            surface: "send.review",
            status: .started,
            amountUsd: draft.amountUsdsui,
            currency: draft.currency.code
        )

        await performSend(intentLabel: intentLabel, resolved: resolved)
    }

    /// Performs the actual sponsor-prepare → sign → submit pipeline.
    /// Extracted so it can be re-invoked after a successful one-tap
    /// consolidation runs (the user shouldn't have to manually retry
    /// after enabling gasless balance).
    private func performSend(
        intentLabel: String,
        resolved: RecipientResolution
    ) async {
        do {
            // Combined build+sponsor in one call (was prepare + sponsor,
            // two round-trips). Server returns sponsor-ready bytes
            // straight away; sponsor-execute does the broadcast.
            let result = try await ZkLoginCoordinator.shared.signAndSubmitSend(
                to: resolved.address,
                amountUsd: draft.amountUsdsui,
                asset: "USDsui",
                intent: intentLabel,
                rewards: ZkLoginCoordinator.RewardsMeta(
                    kind: "send",
                    amountUsd: draft.amountUsdsui,
                    venue: nil,
                    // Server recomputes round-up from the current
                    // config inside sponsor-prepare and forwards it
                    // through; this value is a fallback only.
                    roundupUsd: nil
                )
            )

            // REAL success gate: the coordinator's success path requires
            // a non-empty digest from gasless-submit or sponsor-execute.
            // Defense in depth — if a future regression slips an empty
            // digest past the coordinator, we still route to failure
            // rather than flashing the green checkmark.
            guard !result.digest.isEmpty else {
                Growth.shared.track(
                    .sendFailed,
                    surface: "send",
                    status: .error,
                    errorCode: "empty_digest",
                    amountUsd: draft.amountUsdsui,
                    currency: draft.currency.code
                )
                draft.errorMessage = "Send didn't land on chain. No funds moved."
                path = [.recipient, .review, .failure]
                return
            }

            let success = SendSuccess(
                digest: result.digest,
                displayAmount: draft.rawAmount.isEmpty ? "0" : draft.rawAmount,
                currency: draft.currency,
                usdsui: draft.amountUsdsui,
                recipientAddress: resolved.address,
                recipientDisplay: resolved.displayName ?? shortAddress(resolved.address),
                savedUsd: result.roundupUsd
            )
            draft.success = success

            // Landed on chain. `first_send` is deduped server-side
            // (growth_user_firsts, COALESCE on first write), so emitting it on
            // every send is correct and needs no client-side bookkeeping.
            Growth.shared.track(
                .sendCompleted,
                surface: "send",
                status: .ok,
                amountUsd: draft.amountUsdsui,
                currency: draft.currency.code
            )
            Growth.shared.milestone(.firstSend, amountUsd: draft.amountUsdsui, surface: "send")

            // Broadcast for HomeView's optimistic-balance path. Sent
            // even if the user has already tapped Done mid-flight —
            // the listener is on the parent, not the dismissed sheet.
            // Uses canonical `TaliseTxEvent` from HomeView — String
            // direction + `venue` field so invest/withdraw posts from
            // EarnView share the same listener.
            NotificationCenter.default.post(
                name: .taliseTxCompleted,
                object: TaliseTxEvent(
                    digest: result.digest,
                    direction: "sent",
                    amountUsdsui: draft.amountUsdsui,
                    counterparty: resolved.address,
                    counterpartyName: resolved.displayName,
                    venue: nil
                )
            )

            // Swap the in-flight page for the success page. We replace
            // rather than push so the back-stack doesn't let the user
            // wander back into a stale "Sending…" screen.
            path = [.recipient, .review, .complete]

            // Round-up & Save is a LEG OF THE SEND'S OWN PTB again (2026-07-25):
            // /api/send/sponsor-prepare appends `appendNaviSupply` server-side
            // whenever the user has round-up on, so the save is already inside
            // the transaction that just succeeded. There is nothing for the
            // client to fire.
            //
            // DO NOT re-add a second supply call here. Doing so would save
            // TWICE per send and debit the user twice: the server-side leg runs
            // for every client, so an extra client-side `/api/earn/supply`
            // duplicates it rather than being a fallback. The earlier
            // "combined PTB timed out" note was wrong about the cause — it was
            // a fake pre-warm (NaviAdapter.init() returns in 0ms and warmed
            // nothing) leaving a 3.3s cold pool/reserve read inside the send;
            // a real warm brings it to ~268ms. See lib/rewards/roundup.ts.
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            // Bearer predates the Poseidon-nonce binding; sign the user
            // out so they re-auth and rebuild a valid session. This is
            // the only catch that bypasses the failure screen — the
            // signOut() dismisses the whole send sheet.
            draft.errorMessage = "Sign in again, your session needs a refresh."
            session.signOut()
        } catch {
            // Any thrown error means the send did NOT land on chain:
            // 4xx like ACCUMULATOR_UNDERFUNDED from sponsor-prepare,
            // 5xx, network/transport errors, missing-digest checks in
            // the coordinator. All of these go to the failure screen —
            // NEVER to .complete, which renders the green success UI.
            //
            // Note (2026-05-29): the ACCUMULATOR_UNDERFUNDED →
            // consolidation-offer special case was removed alongside the
            // autoswap archive. The failure copy already directs users
            // to top up via Stripe or use the new "Swap to USDsui" CTA
            // on Home.
            Growth.shared.track(
                .sendFailed,
                surface: "send",
                status: .error,
                errorCode: Growth.errorCode(error),
                amountUsd: draft.amountUsdsui,
                currency: draft.currency.code
            )
            draft.errorMessage = error.localizedDescription
            path = [.recipient, .review, .failure]
        }
    }

    // `fireRoundupSave` was REMOVED on 2026-07-25. Round-up is a leg of the
    // send's own PTB again (appended server-side in /api/send/sponsor-prepare),
    // so a client-side `/api/earn/supply` call is no longer a fallback — it is a
    // duplicate that saves twice and debits the user twice. It also under-paid
    // points, because a standalone digest hits MAX_ROUNDUP_FRACTION's 10% clamp
    // in lib/rewards/earn.ts. Do not reintroduce it.

    private func shortAddress(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }
}
