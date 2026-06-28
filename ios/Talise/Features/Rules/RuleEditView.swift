import SwiftUI

/// Create a scheduled-send rule: pick who it pays, how much, how often, and how
/// much to load into the rule's pot up front. The rule is NON-CUSTODIAL — the
/// pot lives in an on-chain `standing_order` object you own, with the recipient
/// + amount baked on chain. A backend worker can only release the pre-set amount
/// to the pre-set recipient on schedule; cancelling refunds the remaining pot.
///
/// Flow (mirrors TeamStreamSetupView): form → prepareCreate (Onara-sponsored
/// `standing_order::create` bytes that fund the pot) → sign with the zkLogin
/// ephemeral key → recordCreate (activate) → success. No per-run signing.
struct RuleEditView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSession.self) private var session

    @State private var name: String = ""
    @State private var recipient: String = ""
    @State private var amount: String = ""
    @State private var cadence: Cadence = .daily
    @State private var dayOfMonth: Int = 1
    /// How many payments' worth to load into the pot now (default one).
    @State private var prefundPayments: Int = 1

    // Live recipient resolution (mirrors the Payroll team editor).
    @State private var resolved: RecipientResolution?
    @State private var resolving = false
    @State private var resolveFailed = false

    @State private var creating = false
    @State private var error: String?
    @State private var resetSlider = false

    // Post-create state.
    @State private var created: RuleDTO?
    @State private var fundedUsd: Double = 0
    @State private var fundedPayments: Int = 1

    /// Schedule presets. Daily/weekly map to an interval in minutes; monthly
    /// sends a day-of-month instead.
    enum Cadence: String, CaseIterable, Identifiable {
        case daily = "Every day"
        case weekly = "Every week"
        case monthly = "Monthly (a day)"
        var id: String { rawValue }
        /// Interval in minutes, or nil for the monthly (day-of-month) path.
        var intervalMinutes: Int? {
            switch self {
            case .daily: return 1440
            case .weekly: return 10080
            case .monthly: return nil
            }
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }
    private var trimmedRecipient: String { recipient.trimmingCharacters(in: .whitespaces) }
    private var amountValue: Double { Double(amount.trimmingCharacters(in: .whitespaces)) ?? 0 }
    /// Total loaded into the pot up front = one payment × number of payments.
    private var prefundUsd: Double { amountValue * Double(prefundPayments) }
    private var canCreate: Bool {
        !trimmedName.isEmpty
            && resolved != nil
            && amountValue >= 0.01
            && !creating
    }

    var body: some View {
        if let created {
            successView(created)
        } else {
            form
        }
    }

    // MARK: - Form

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                nameCard
                recipientCard
                amountCard
                scheduleCard
                prefundCard
                previewCard

                if let error {
                    Text(error)
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                SlideToConfirm(title: creating ? "Creating…" : "Slide to create rule",
                               tint: TaliseColor.accent,
                               reset: $resetSlider) {
                    await create()
                }
                .disabled(!canCreate)
                .opacity(canCreate ? 1 : 0.6)

                Text("One signature funds the rule's own pot. Payouts release automatically — gaslessly, no signing each time — and the remaining balance is refunded if you cancel.")
                    .font(TaliseFont.mono(11, weight: .regular))
                    .foregroundStyle(TaliseColor.fgMuted)

                Color.clear.frame(height: 24)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .task(id: trimmedRecipient) { await resolve() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("NEW RULE")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text("Create a rule")
                .font(TaliseFont.heading(24, weight: .medium)).kerning(-0.5)
                .foregroundStyle(TaliseColor.fg)
            Text("Send a fixed amount to someone on a schedule. It runs by itself from its own pot until you pause or cancel it.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var nameCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("RULE NAME")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            TextField("", text: $name, prompt: Text("e.g. Rent").foregroundColor(TaliseColor.fgDim))
                .font(TaliseFont.body(16, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .textInputAutocapitalization(.words)
                .padding(.horizontal, 14).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface2))
        }
        .padding(16)
        .rampCard()
    }

    private var recipientCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PAY TO")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            TextField("", text: $recipient,
                      prompt: Text("@handle, name.talise.sui or 0x…").foregroundColor(TaliseColor.fgDim))
                .font(TaliseFont.body(15, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 14).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface2))
            resolutionLine
        }
        .padding(16)
        .rampCard()
    }

    @ViewBuilder private var resolutionLine: some View {
        if resolving {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini).tint(TaliseColor.fgMuted)
                Text("Finding…")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        } else if let resolved {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TaliseColor.greenMint)
                Text(resolved.displayString)
                    .font(TaliseFont.body(12.5, weight: .regular))
                    .foregroundStyle(TaliseColor.fg).lineLimit(1)
            }
        } else if resolveFailed {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(TaliseColor.danger)
                Text("No one found by that name")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
            }
        }
    }

    private var amountCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AMOUNT EACH TIME")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            HStack(spacing: 4) {
                Text("$").font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
                TextField("", text: $amount, prompt: Text("10.00").foregroundColor(TaliseColor.fgDim))
                    .font(TaliseFont.heading(22, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .keyboardType(.decimalPad)
            }
            .padding(.horizontal, 14).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface2))
        }
        .padding(16)
        .rampCard()
    }

    private var scheduleCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("HOW OFTEN")
                    .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                    .foregroundStyle(TaliseColor.fgDim)
                Spacer()
                Picker("", selection: $cadence) {
                    ForEach(Cadence.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(TaliseColor.accent)
            }
            if cadence == .monthly {
                Divider().overlay(TaliseColor.line)
                HStack {
                    Text("DAY OF MONTH")
                        .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                        .foregroundStyle(TaliseColor.fgDim)
                    Spacer()
                    Stepper(value: $dayOfMonth, in: 1...28) {
                        Text("\(dayOfMonth)")
                            .font(TaliseFont.heading(16, weight: .medium))
                            .foregroundStyle(TaliseColor.fg)
                    }
                    .labelsHidden()
                    .fixedSize()
                }
            }
        }
        .padding(16)
        .rampCard()
    }

    /// How much to load into the rule's pot up front — one or more payments'
    /// worth. The pot is non-custodial; the remainder is refunded on cancel.
    private var prefundCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("LOAD THE POT")
                    .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                    .foregroundStyle(TaliseColor.fgDim)
                Spacer()
                Stepper(value: $prefundPayments, in: 1...60) {
                    Text("\(prefundPayments) \(prefundPayments == 1 ? "payment" : "payments")")
                        .font(TaliseFont.heading(15, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                }
                .labelsHidden()
                .fixedSize()
            }
            if amountValue >= 0.01 {
                Text("Funds the rule's pot — \(prefundPayments) \(prefundPayments == 1 ? "payment" : "payments") of \(TaliseFormat.usd2(amountValue)) (\(TaliseFormat.usd2(prefundUsd)) total).")
                    .font(TaliseFont.body(12.5, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Set an amount to choose how much to load.")
                    .font(TaliseFont.body(12.5, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .rampCard()
    }

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("PREVIEW")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            Text(previewLine)
                .font(TaliseFont.body(14, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .fixedSize(horizontal: false, vertical: true)
            if amountValue > 0 && amountValue < 0.01 {
                Text("The amount must be at least $0.01.")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .rampCard()
    }

    private var previewLine: String {
        let who = resolved?.displayString ?? (trimmedRecipient.isEmpty ? "someone" : trimmedRecipient)
        let amt = amountValue > 0 ? TaliseFormat.usd2(amountValue) : "$0.00"
        switch cadence {
        case .daily: return "\(amt) to \(who), every day."
        case .weekly: return "\(amt) to \(who), every week."
        case .monthly: return "\(amt) to \(who), on the \(ordinal(dayOfMonth)) of each month."
        }
    }

    private func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 100, n % 10) {
        case (11, _), (12, _), (13, _): suffix = "th"
        case (_, 1): suffix = "st"
        case (_, 2): suffix = "nd"
        case (_, 3): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }

    // MARK: - Success

    private func successView(_ rule: RuleDTO) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                ZStack {
                    Circle().fill(TaliseColor.accent.opacity(0.16)).frame(width: 92, height: 92)
                    Image(systemName: "checkmark")
                        .font(.system(size: 38, weight: .medium))
                        .foregroundStyle(TaliseColor.accent)
                }
                .padding(.top, 24)
                Text("Rule created")
                    .font(TaliseFont.heading(24, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text("\(TaliseFormat.usd2(rule.amountUsd)) to \(rule.recipientLabel) · \(rule.cadenceLine)")
                    .font(TaliseFont.body(14, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)

                // The pot is funded — restate that it's non-custodial + refundable.
                VStack(alignment: .leading, spacing: 8) {
                    Text("POT LOADED")
                        .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                        .foregroundStyle(TaliseColor.fgDim)
                    HStack(spacing: 7) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 13)).foregroundStyle(TaliseColor.greenMint)
                        Text("\(TaliseFormat.usd2(fundedUsd)) loaded — \(fundedPayments) \(fundedPayments == 1 ? "payment" : "payments")")
                            .font(TaliseFont.body(13, weight: .medium))
                            .foregroundStyle(TaliseColor.fg)
                    }
                    Text("Payouts are pulled from this rule's own pot. You own it — the remaining balance is refunded if you cancel.")
                        .font(TaliseFont.body(12.5, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .rampCard()
                .padding(.top, 8)

                Button { dismiss() } label: {
                    Text("Done")
                        .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).frame(height: 54)
                        .background(Capsule().fill(TaliseColor.greenMint))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)

                Color.clear.frame(height: 24)
            }
            .padding(.horizontal, 20)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Actions

    private func resolve() async {
        let q = trimmedRecipient
        guard !q.isEmpty else {
            resolved = nil; resolveFailed = false; resolving = false
            return
        }
        try? await Task.sleep(nanoseconds: 400_000_000)
        if Task.isCancelled { return }
        resolving = true; resolveFailed = false
        defer { resolving = false }
        do {
            let r: RecipientResolution = try await APIClient.shared.get(
                "/api/recipient/resolve?q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)"
            )
            if Task.isCancelled || q != trimmedRecipient { return }
            resolved = r; resolveFailed = false
        } catch {
            if Task.isCancelled || APIError.isCancellation(error) { return }
            if q != trimmedRecipient { return }
            resolved = nil; resolveFailed = true
        }
    }

    /// Prepare → sign the sponsored `standing_order::create` (funds the pot) →
    /// record (activate). Mirrors TeamStreamSetupView's start() exactly.
    private func create() async {
        guard canCreate else { resetSlider.toggle(); return }
        creating = true; error = nil
        defer { creating = false }
        do {
            // 1) Prepare: validate + screen the recipient, get the funding bytes.
            let prep = try await RulesAPI.prepareCreate(
                name: trimmedName,
                intervalMinutes: cadence.intervalMinutes,
                dayOfMonth: cadence == .monthly ? dayOfMonth : nil,
                toRecipient: trimmedRecipient,
                amountUsd: amountValue,
                prefundUsd: prefundUsd
            )
            // 2) Sign the Onara-sponsored bytes that fund the rule's on-chain pot.
            let digest = try await ZkLoginCoordinator.shared.signAndExecuteRaw(
                bytesB64: prep.bytes,
                meta: ["kind": "rule-create"]
            )
            // 3) Activate the rule with the funding digest.
            let rule = try await RulesAPI.recordCreate(
                digest: digest,
                firstDueMs: prep.firstDueMs,
                record: prep.record
            )

            fundedUsd = prefundUsd
            fundedPayments = prefundPayments
            NotificationCenter.default.post(name: .taliseTxCompleted, object: TaliseTxEvent(
                digest: digest, direction: "sent", amountUsdsui: prefundUsd,
                counterparty: prep.record.toAddress, counterpartyName: trimmedName, venue: nil))
            withAnimation { created = rule }
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            error = "Sign in again — your session needs a refresh."
            resetSlider.toggle()
            session.signOut()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = APIError.honestMoneyError(error, fallback: "Couldn't create that rule. Please try again.")
            resetSlider.toggle()
        }
    }
}
