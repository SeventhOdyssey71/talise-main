import SwiftUI

/// Entry point for the Send sheet. Picks between the legacy single-screen
/// `LegacySendView` and the new multi-page `SendFlowView` based on a
/// build-time feature flag so AppRoot can keep presenting `SendView(...)`
/// unchanged.
///
/// Flip `useNewSendFlow` to false to fall back to the original sheet.
struct SendView: View {
    /// Compile-time switch between the legacy single-screen send and the
    /// new five-step NavigationStack flow. AppRoot calls `SendView(...)`
    /// either way; the dispatch happens here.
    static let useNewSendFlow = true

    var onDone: (() -> Void)? = nil

    var body: some View {
        if Self.useNewSendFlow {
            SendFlowView(onDone: onDone)
        } else {
            LegacySendView(onDone: onDone)
        }
    }
}

// MARK: - Shared shapes for the new flow

/// State-machine cursor for the multi-page send flow. Drives both the
/// NavigationStack path and the in-flight `sending`/`complete` states.
enum SendStep: Hashable {
    case amount
    case recipient
    case review
    case sending
    case complete
    /// Terminal failure state. Reached when sponsor-prepare,
    /// sponsor-execute, or gasless-submit throws — including 4xx
    /// rejections like ACCUMULATOR_UNDERFUNDED. The success screen must
    /// NEVER render in this state.
    case failure
    /// Intermediate state between failure-detection and `.failure`.
    /// Reached when sponsor-prepare returned `ACCUMULATOR_UNDERFUNDED`
    /// AND the server reports the user holds `Coin<USDsui>` objects
    /// that can be consolidated into the accumulator. The user is
    /// offered a one-tap "Enable gasless balance" action; tapping it
    /// runs `consolidateToAccumulator` (Onara-sponsored, user pays
    /// nothing) and then auto-resubmits the original send. The failure
    /// screen renders only if the user cancels or consolidation itself
    /// fails.
    case consolidationOffered
}

/// Mutable draft passed by `@Bindable` through the SendFlowView pages.
/// Holds everything the flow accumulates before hitting the backend —
/// raw input (so the user's typing reads back exactly as entered), the
/// converted USDsui amount, and the resolved recipient.
@Observable
final class SendDraft {
    /// User-entered string in the display currency (e.g. "1235" or
    /// "12.50"). The view layer formats it for display; we never mutate
    /// it for cosmetic reasons.
    var rawAmount: String = ""

    /// Recipient text from the input field. Mirrors what the user typed
    /// before resolution lands.
    var recipientInput: String = ""

    /// Server-resolved recipient (SuiNS or 0x lookup result).
    var resolved: RecipientResolution?

    /// Snapshot of the display currency at the moment the user typed the
    /// amount, so later screens can re-render in the same currency even
    /// if the global picker is changed mid-flow.
    var currency: TaliseCurrency

    /// USDsui-equivalent of `rawAmount` at submission time. Filled by
    /// `SendReviewView` right before posting to /api/send/prepare.
    var amountUsdsui: Double = 0

    /// Submission outcome — surfaces in `SendCompleteView`.
    var success: SendSuccess?

    /// Error to surface inside the in-progress page.
    var errorMessage: String?

    /// Optional historical sent-count between the current user and this
    /// recipient. Used by the review screen ("3 previous sends") when we
    /// have it from the /api/contacts payload.
    var previousSendsToRecipient: Int?

    /// USDsui (in micro-units, 6dp) that the user holds in Coin<USDsui>
    /// objects but not yet in their accumulator. Populated when
    /// sponsor-prepare returns ACCUMULATOR_UNDERFUNDED with a hint —
    /// the SendConsolidationOfferView reads it to show the amount that
    /// will move with one tap. Stored as a string because the server
    /// sends it as a string (u64 can exceed JS Double safe range).
    var coinBalanceMicros: String?

    /// USDsui (in micro-units) currently in the accumulator. Same
    /// origin as `coinBalanceMicros`.
    var accumulatorBalanceMicros: String?

    init(currency: TaliseCurrency) {
        self.currency = currency
    }
}

/// Snapshot of a successful send. Persists across `sending → complete`
/// so the SendCompleteView can render details after the receipt lands.
struct SendSuccess: Equatable {
    let digest: String
    /// User-entered amount string (raw, no symbol).
    let displayAmount: String
    /// Currency the user typed in.
    let currency: TaliseCurrency
    /// USDsui-equivalent posted on chain.
    let usdsui: Double
    /// Resolved recipient address (0x...).
    let recipientAddress: String
    /// Display name (handle or short address) for the recipient.
    let recipientDisplay: String
}

// `TaliseTxEvent` + `Notification.Name.taliseTxCompleted` are declared
// canonically in `Features/Home/HomeView.swift` — that struct carries
// `direction: String` ("sent" | "invest" | "withdraw") and a `venue`
// field so the same notification fans out to optimistic updates for
// invest/withdraw txs from EarnView too. The Send flow uses those
// existing types; do NOT redeclare them here (would produce duplicate-
// symbol errors and split the listener graph between two incompatible
// struct shapes).

// MARK: - Legacy single-screen send

/// Original single-screen Send flow. Preserved verbatim so we can flip
/// `SendView.useNewSendFlow` back to false if the new flow regresses.
///
/// End-to-end: resolve recipient (SuiNS or 0x address) → server-side
/// PTB build → ZkLoginCoordinator sponsored sign + submit.
struct LegacySendView: View {
    var onDone: (() -> Void)? = nil
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var recipient = ""
    @State private var amount = ""
    @State private var resolved: RecipientResolution?
    @State private var resolveTask: Task<Void, Never>?
    @State private var resolving = false
    @State private var sending = false
    @State private var error: String?
    @State private var success: LegacySuccess?
    @State private var balance: BalancesDTO?

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            if let success {
                successView(success)
            } else {
                form
            }
        }
        .presentationDragIndicator(.visible)
        .onAppear {
            // ContactsSheet writes the tapped address here when the user
            // picks a contact. Pick it up exactly once and clear.
            let key = "io.talise.send.prefillRecipient"
            if let prefill = UserDefaults.standard.string(forKey: key),
               !prefill.isEmpty {
                recipient = prefill
                scheduleResolve(prefill)
                UserDefaults.standard.removeObject(forKey: key)
            }
            Task { await loadBalance() }
        }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                fieldBlock(title: "To") {
                    TextField("Talise handle or 0x address", text: $recipient)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .textContentType(.username)
                        .keyboardType(.asciiCapable)
                        .font(TaliseFont.body(16, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .tint(TaliseColor.accent)
                        .onChange(of: recipient) { _, new in
                            scheduleResolve(new)
                        }
                    resolveStatus
                }
                MicroLabel(
                    text: "Type a Talise handle (alice), a SuiNS name (alice.sui, alice@talise.sui), or a 0x address.",
                    color: TaliseColor.fgDim
                )
                .kerning(0.5)
                .padding(.horizontal, 4)

                fieldBlock(title: "Amount") {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(CurrencySettings.shared.current.symbol)
                            .font(TaliseFont.heading(34, weight: .medium))
                            .foregroundStyle(TaliseColor.fgMuted)
                        TextField("0.00", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(TaliseFont.heading(34, weight: .medium))
                            .foregroundStyle(TaliseColor.fg)
                            .tint(TaliseColor.accent)
                    }
                    balanceLine
                }

                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .padding(.horizontal, 4)
                }

                primaryButton

                Spacer(minLength: 80)
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Send", color: TaliseColor.fgDim).kerning(1.5)
            Text("Send money")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private func fieldBlock<C: View>(title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            MicroLabel(text: title, color: TaliseColor.fgDim).kerning(1.5)
            VStack(alignment: .leading, spacing: 8) {
                content()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .taliseGlass(cornerRadius: 20)
        }
    }

    private var resolveStatus: some View {
        Group {
            if resolving {
                MicroLabel(text: "Resolving…", color: TaliseColor.fgDim)
            } else if let resolved {
                resolvedRow(resolved)
            } else if recipient.count >= 3 {
                notFoundRow
            } else {
                Color.clear.frame(height: 14)
            }
        }
    }

    private func resolvedRow(_ r: RecipientResolution) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(TaliseColor.accent)
            VStack(alignment: .leading, spacing: 2) {
                if let displayName = r.displayName, !displayName.isEmpty,
                   displayName != r.address {
                    Text(displayName)
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.accent)
                        .lineLimit(1)
                }
                Text(short(r.address))
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    private var notFoundRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(TaliseColor.danger)
            Text(notFoundHint)
                .font(TaliseFont.mono(11, weight: .light))
                .foregroundStyle(TaliseColor.danger)
                .lineLimit(2)
        }
    }

    private var notFoundHint: String {
        let q = recipient.trimmingCharacters(in: .whitespaces).lowercased()
        if q.hasPrefix("0x") {
            return "Not a valid Sui address — should be 0x + 64 hex chars."
        }
        if q.hasSuffix(".sui") {
            return "No SuiNS record for \"\(q)\" on chain yet."
        }
        let bare = stripParent(q)
        if bare.isEmpty {
            return "Use a Talise handle, full SuiNS name, or 0x address."
        }
        return "Couldn't find \(bare)@talise.sui or \(bare).sui on chain yet."
    }

    private func stripParent(_ s: String) -> String {
        var out = s.lowercased()
        if out.hasPrefix("@") { out.removeFirst() }
        if out.hasSuffix("@talise.sui") { out = String(out.dropLast(11)) }
        else if out.hasSuffix("@talise") { out = String(out.dropLast(7)) }
        else if out.hasSuffix(".talise.sui") { out = String(out.dropLast(11)) }
        else if out.hasSuffix(".sui") { out = String(out.dropLast(4)) }
        return out
    }

    private var balanceLine: some View {
        HStack(spacing: 4) {
            if let avail = availableLocal {
                if typedExceedsBalance {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(TaliseColor.danger)
                    Text("Not enough — you have \(avail)")
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                } else {
                    Text("Available")
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                    Text(avail)
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
            } else {
                Text("Loading balance…")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            Spacer()
        }
        .padding(.top, 4)
    }

    private var availableLocal: String? {
        guard let usdsui = balance?.usdsui else { return nil }
        return TaliseFormat.local2(usdsui)
    }

    private var typedAmountUsdsui: Double {
        guard let typed = Double(amount), typed > 0 else { return 0 }
        let rate = CurrencySettings.shared.rates[CurrencySettings.shared.current.code] ?? 1
        return typed / rate
    }

    private var typedExceedsBalance: Bool {
        let typed = typedAmountUsdsui
        guard typed > 0, let have = balance?.usdsui else { return false }
        return typed > have
    }

    private var canSend: Bool {
        resolved != nil
            && typedAmountUsdsui > 0
            && !typedExceedsBalance
            && !sending
    }

    private var primaryButton: some View {
        Button(action: { Task { await send() } }) {
            HStack(spacing: 10) {
                if sending {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(TaliseColor.bg)
                } else {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 14, weight: .medium))
                        .rotationEffect(.degrees(-30))
                }
                Text(sending ? "Sending…" : sendLabel)
                    .font(TaliseFont.heading(15, weight: .medium))
            }
            .foregroundStyle(TaliseColor.bg)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(canSend ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
            .clipShape(Capsule())
        }
        .disabled(!canSend)
    }

    private var sendLabel: String {
        guard let typed = Double(amount), typed > 0 else { return "Send" }
        let symbol = CurrencySettings.shared.current.symbol
        return "Send \(symbol)\(amount)"
    }

    // MARK: - Success

    private struct LegacySuccess {
        let digest: String
        let amount: String
        let asset: String
        let recipient: String
    }

    private func successView(_ s: LegacySuccess) -> some View {
        VStack(spacing: 16) {
            Spacer()
            ZStack {
                Circle()
                    .fill(TaliseColor.accent.opacity(0.15))
                    .frame(width: 84, height: 84)
                Image(systemName: "checkmark")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
            }
            Text("Sent")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            Text("\(s.amount) \(s.asset) → \(short(s.recipient))")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            MicroLabel(text: s.digest.prefix(20) + "…", color: TaliseColor.fgDim)
                .kerning(0.5)
            Spacer()
            Button(action: { onDone?(); dismiss() }) {
                Text("Done")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(TaliseColor.fg)
                    .clipShape(Capsule())
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    private func short(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }

    // MARK: - Resolve

    private func scheduleResolve(_ input: String) {
        resolveTask?.cancel()
        resolved = nil
        let q = input.trimmingCharacters(in: .whitespaces)
        guard q.count >= 3 else { resolving = false; return }
        if let addr = SuiAddress(q) {
            resolved = RecipientResolution(
                address: addr.raw, displayName: addr.short,
                display: nil, source: "address"
            )
            resolving = false
            return
        }
        resolving = true
        resolveTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            do {
                let encoded = q.addingPercentEncoding(
                    withAllowedCharacters: .urlQueryAllowed
                ) ?? q
                let r: RecipientResolution = try await APIClient.shared.get(
                    "/api/recipient/resolve?q=\(encoded)"
                )
                if Task.isCancelled { return }
                resolved = r
            } catch {
                if Task.isCancelled { return }
                resolved = nil
            }
            resolving = false
        }
    }

    // MARK: - Send

    private func send() async {
        guard let resolved else { return }
        let amtUsdsui = typedAmountUsdsui
        guard amtUsdsui > 0 else { return }
        sending = true
        error = nil
        defer { sending = false }
        do {
            struct Body: Encodable {
                let to: String; let amount: Double; let asset: String
            }
            let built: BuildKindResponse = try await APIClient.shared.post(
                "/api/send/prepare",
                body: Body(to: resolved.address, amount: amtUsdsui, asset: "USDsui")
            )
            let symbol = CurrencySettings.shared.current.symbol
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: "Send \(symbol)\(amount)",
                rewards: ZkLoginCoordinator.RewardsMeta(
                    kind: "send",
                    amountUsd: amtUsdsui,
                    venue: nil
                )
            )
            success = LegacySuccess(
                digest: result.digest,
                amount: "\(symbol)\(amount)",
                asset: "USDsui",
                recipient: resolved.displayString
            )
            NotificationCenter.default.post(
                name: .taliseTxCompleted,
                object: TaliseTxEvent(
                    digest: result.digest,
                    direction: "sent",
                    amountUsdsui: amtUsdsui,
                    counterparty: resolved.address,
                    counterpartyName: resolved.displayName,
                    venue: nil
                )
            )
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            self.error = "Sign in again — your session needs a refresh."
            session.signOut()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadBalance() async {
        do {
            balance = try await APIClient.shared.get("/api/balances")
        } catch {
            balance = nil
        }
    }
}
