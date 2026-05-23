import SwiftUI

/// End-to-end Send: resolve recipient (SuiNS or 0x address) → server-side
/// PTB build → ZkLoginCoordinator sponsored sign + submit. Presented as
/// a sheet from HomeView's paperplane action.
struct SendView: View {
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
    @State private var success: SendSuccess?
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
                    // Placeholder kept simple — anything with "@" trips
                    // iOS's smart data detection and the placeholder
                    // renders as a blue tappable email link.
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
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 20))
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
        // We try the Talise sub then the root SuiNS, so the message
        // names both candidates that just failed.
        return "Couldn't find \(bare)@talise.sui or \(bare).sui on chain yet."
    }

    /// Trims any of the user-input wrappers — `@`, `@talise`, `@talise.sui`,
    /// `.talise.sui`, bare `.sui` — to recover the base label. Mirrors the
    /// candidateSuinsNames logic in web/lib/suins.ts so error messages
    /// align with what the server actually tried.
    private func stripParent(_ s: String) -> String {
        var out = s.lowercased()
        if out.hasPrefix("@") { out.removeFirst() }
        if out.hasSuffix("@talise.sui") { out = String(out.dropLast(11)) }
        else if out.hasSuffix("@talise") { out = String(out.dropLast(7)) }
        else if out.hasSuffix(".talise.sui") { out = String(out.dropLast(11)) }
        else if out.hasSuffix(".sui") { out = String(out.dropLast(4)) }
        return out
    }

    /// Available balance line under the amount input. Shown in the
    /// user's display currency (matches the headline on Home). When
    /// the typed amount exceeds the available balance, the line
    /// turns red and the Send button is disabled.
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

    /// Available balance formatted in the user's selected currency,
    /// pulled from /api/balances at appear time.
    private var availableLocal: String? {
        guard let usdsui = balance?.usdsui else { return nil }
        return TaliseFormat.local2(usdsui)
    }

    /// The typed amount converted from the user's display currency
    /// back to USDsui — what the chain actually settles in.
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

    private struct SendSuccess {
        let digest: String
        let amount: String
        let asset: String
        let recipient: String
    }

    private func successView(_ s: SendSuccess) -> some View {
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
        // Bare 0x addresses don't need a server round-trip.
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
            // The user types in their display currency (₦, $, etc.);
            // we convert via the cached FX rate to USDsui — the only
            // unit the chain settles in — before hitting the backend.
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
                intent: "Send \(symbol)\(amount)"
            )
            success = SendSuccess(
                digest: result.digest,
                amount: "\(symbol)\(amount)",
                asset: "USDsui",
                recipient: resolved.displayString
            )
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            // Old bearer that predates the Poseidon-nonce binding.
            // Signing it would always 401 — bounce the user back to
            // sign-in cleanly instead of leaving them stuck.
            self.error = "Sign in again — your session needs a refresh."
            session.signOut()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Pulls /api/balances so the "Available" line + overdraft check
    /// reflect the real on-chain USDsui balance.
    private func loadBalance() async {
        do {
            balance = try await APIClient.shared.get("/api/balances")
        } catch {
            balance = nil
        }
    }
}
