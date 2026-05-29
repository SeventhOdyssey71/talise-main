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

    var body: some View {
        NavigationStack(path: $path) {
            SendAmountView(
                draft: draft,
                onNext: { path.append(.recipient) },
                onCancel: { close() }
            )
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
                        onBack: { pop() }
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
                    .task {
                        // Fire an instant sweep right after every
                        // successful send so the recipient's
                        // @handle → wallet drain happens within
                        // seconds, not at the next 60s cron tick.
                        // Fire-and-forget — the cron will catch up
                        // even if this call fails.
                        await VaultAPI.sweepNow()
                    }
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
        // Mount the PIN host inside the fullScreenCover so its sheet
        // can present over the Send flow (the AppRoot-level host is
        // behind the cover and would otherwise be queued by iOS).
        .pinGateHost()
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

        // PIN sheet FIRST, while still on the Review screen. We don't
        // push .sending until the user has actually confirmed —
        // otherwise the spinner appears before they've approved the
        // transaction. The sheet is hosted by SendFlowView itself (see
        // `.pinGateHost()` on `body`) so it surfaces above the
        // fullScreenCover.
        let intentLabel = "Send \(draft.currency.symbol)\(draft.rawAmount)"
        let recipientLabel = resolved.displayName ?? shortAddress(resolved.address)
        let amountForPrompt = String(format: "$%.2f", draft.amountUsdsui)
        do {
            try await PinGate.shared.requireUserPresence(
                reason: "Send \(amountForPrompt) to \(recipientLabel)"
            )
        } catch PinError.cancelled {
            // User dismissed the PIN sheet from Review — stay put, no
            // spinner, no error.
            return
        } catch PinError.forgotSignOut {
            // PinService already cleared this user's hash.
            session.signOut()
            return
        } catch {
            draft.errorMessage = error.localizedDescription
            return
        }

        // PIN confirmed. Now push the in-flight page and run the
        // network round-trip.
        path.append(.sending)

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
                recipientDisplay: resolved.displayName ?? shortAddress(resolved.address)
            )
            draft.success = success

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
            draft.errorMessage = error.localizedDescription
            path = [.recipient, .review, .failure]
        }
    }

    private func shortAddress(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }
}
