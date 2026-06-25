import SwiftUI

/// Review-and-pay a saved team in one gasless transaction. Each member's
/// amount is pre-filled from the saved default (editable here; members with
/// no saved amount start blank and must be filled). Every shown member must
/// have a positive amount before the batch can go out.
///
/// Confirm flow (Onara-sponsored, no per-recipient gas):
///   1. prepareBatch(recipients:) → batchId + sponsored bytes + total
///   2. signAndExecuteRaw(bytesB64:meta:) → digest
///   3. recordBatch(batchId:digest:) → server records the executed payout
struct PayTeamView: View {
    let team: TeamDTO

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    /// Editable amount text per member, keyed by member index.
    @State private var amounts: [String]
    @State private var paying = false
    @State private var paid = false
    @State private var paidCount = 0
    @State private var paidTotal: Double = 0
    @State private var error: String?
    /// Forces the slider knob back to start after a failed confirm.
    @State private var resetSlider = false
    @State private var confirmDelete = false
    @State private var deleting = false

    init(team: TeamDTO) {
        self.team = team
        _amounts = State(initialValue: team.members.map {
            $0.amount.map { String(format: "%g", $0) } ?? ""
        })
    }

    private var parsedAmounts: [Double] {
        amounts.map { Double($0.trimmingCharacters(in: .whitespaces)) ?? 0 }
    }
    private var total: Double { parsedAmounts.reduce(0, +) }
    /// Every shown member must have a positive amount to pay the batch.
    private var allFilled: Bool {
        !team.members.isEmpty && parsedAmounts.allSatisfy { $0 > 0 }
    }

    var body: some View {
        Group {
            if paid {
                successCard
            } else {
                form
            }
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Form

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                memberList
                totalCard

                if let error {
                    Text(error)
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                SlideToConfirm(
                    title: paying ? "Paying…" : "Slide to pay \(TaliseFormat.usd2(total))",
                    tint: TaliseColor.greenMint,
                    reset: $resetSlider
                ) {
                    await pay()
                }
                .disabled(!allFilled || paying)
                .opacity(!allFilled || paying ? 0.5 : 1)

                gaslessNote

                // Subtle, deliberate delete — lives on the team's own screen
                // (not the list), de-emphasized so it's never an accidental tap.
                Button {
                    confirmDelete = true
                } label: {
                    HStack(spacing: 6) {
                        if deleting { ProgressView().controlSize(.mini).tint(TaliseColor.fgDim) }
                        Text(deleting ? "Removing…" : "Delete team")
                            .font(TaliseFont.body(13, weight: .regular))
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 18)
                }
                .buttonStyle(.plain)
                .disabled(deleting || paying)

                Color.clear.frame(height: 20)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .confirmationDialog("Delete \(team.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete team", role: .destructive) { Task { await deleteTeam() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the saved team. It won't affect any payments already sent.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("PAY TEAM")
                        .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                        .foregroundStyle(TaliseColor.fgDim)
                    Text(team.name)
                        .font(TaliseFont.heading(24, weight: .medium)).kerning(-0.5)
                        .foregroundStyle(TaliseColor.fg)
                }
                Spacer(minLength: 8)
                NavigationLink {
                    TeamEditView(team: team)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "pencil").font(.system(size: 11, weight: .medium))
                        Text("Edit team").font(TaliseFont.body(13, weight: .regular))
                    }
                    .foregroundStyle(TaliseColor.fg)
                    .padding(.horizontal, 12).frame(height: 34)
                    .background(Capsule().fill(TaliseColor.surface2))
                }
                .buttonStyle(.plain)
            }
            Text("Confirm what each person gets, then pay everyone at once.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .padding(.top, 4)
    }

    private var memberList: some View {
        VStack(spacing: 12) {
            ForEach(Array(team.members.enumerated()), id: \.offset) { idx, member in
                memberRow(idx: idx, member: member)
            }
        }
    }

    private func memberRow(idx: Int, member: TeamMemberDTO) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(member.label ?? recipientShort(member.recipient))
                    .font(TaliseFont.body(15, weight: .medium))
                    .foregroundStyle(TaliseColor.fg).lineLimit(1)
                if member.label != nil {
                    Text(recipientShort(member.recipient))
                        .font(TaliseFont.mono(10, weight: .regular))
                        .foregroundStyle(TaliseColor.fgDim).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                Text("$").font(TaliseFont.body(15, weight: .regular)).foregroundStyle(TaliseColor.fgMuted)
                TextField("", text: amountBinding(idx),
                          prompt: Text("0").foregroundColor(TaliseColor.fgDim))
                    .font(TaliseFont.mono(15, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 86)
            }
            .padding(.horizontal, 12).frame(height: 44)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(TaliseColor.surface2)
            )
        }
        .padding(14)
        .rampCard()
    }

    private var totalCard: some View {
        HStack {
            Text("TOTAL")
                .font(TaliseFont.mono(11, weight: .regular)).kerning(1.2)
                .foregroundStyle(TaliseColor.fgDim)
            Spacer()
            Text(TaliseFormat.usd2(total))
                .font(TaliseFont.heading(24, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
        }
        .padding(.horizontal, 18).padding(.vertical, 16)
        .rampCard()
    }

    private var gaslessNote: some View {
        HStack(spacing: 7) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 10, weight: .medium)).foregroundStyle(TaliseColor.greenMint)
            Text("Paid in one transaction — no network fee, Talise sponsors the gas.")
                .font(TaliseFont.mono(10, weight: .light)).kerning(0.2)
                .foregroundStyle(TaliseColor.fgDim)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var successCard: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 30)
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 56)).foregroundStyle(TaliseColor.greenMint)
                .frame(width: 96, height: 96)
                .background(Circle().fill(TaliseColor.greenMint.opacity(0.16)))
            Text("Team paid")
                .font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fg)
            Text("Paid \(peopleCount(paidCount)) · \(TaliseFormat.usd2(paidTotal))")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 24)
    }

    // MARK: - Helpers

    private func amountBinding(_ idx: Int) -> Binding<String> {
        Binding(
            get: { idx < amounts.count ? amounts[idx] : "" },
            set: { if idx < amounts.count { amounts[idx] = $0 } }
        )
    }

    private func recipientShort(_ r: String) -> String {
        if r.hasPrefix("0x"), r.count > 12 {
            return "\(r.prefix(6))…\(r.suffix(4))"
        }
        return r
    }

    private func peopleCount(_ n: Int) -> String {
        n == 1 ? "1 person" : "\(n) people"
    }

    // MARK: - Pay

    private func pay() async {
        guard !paying else { return }
        guard allFilled else {
            error = "Enter a positive amount for everyone before paying."
            resetSlider = true
            return
        }
        paying = true; error = nil
        defer { paying = false }

        let recipients: [BatchRecipient] = zip(team.members, parsedAmounts).compactMap { member, amount in
            guard amount > 0 else { return nil }
            return BatchRecipient(to: member.recipient, amount: amount, label: member.label)
        }
        guard !recipients.isEmpty else {
            error = "Enter a positive amount for everyone before paying."
            resetSlider = true
            return
        }

        do {
            let resp = try await PayrollAPI.prepareBatch(recipients: recipients)
            let digest = try await ZkLoginCoordinator.shared.signAndExecuteRaw(
                bytesB64: resp.bytes,
                meta: ["kind": "payout-batch", "amountUsd": resp.totalUsd]
            )
            try await PayrollAPI.recordBatch(batchId: resp.batchId, digest: digest)

            NotificationCenter.default.post(name: .taliseTxCompleted, object: TaliseTxEvent(
                digest: digest, direction: "sent", amountUsdsui: resp.totalUsd,
                counterparty: nil, counterpartyName: team.name, venue: nil))

            paidCount = resp.recipientCount
            paidTotal = resp.totalUsd
            withAnimation { paid = true }
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            error = "Sign in again — your session needs a refresh."
            resetSlider = true
            session.signOut()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = Self.friendlyPayoutError(error)
            resetSlider = true
        }
    }

    private func deleteTeam() async {
        guard !deleting else { return }
        deleting = true; error = nil
        defer { deleting = false }
        do {
            try await PayrollAPI.deleteTeam(id: team.id)
            dismiss() // pop back to the list, which reloads on appear
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't delete that team. Please try again."
        }
    }

    /// Map server / signing failures to friendly copy. Inspects the error's
    /// text (covers APIError.status bodies, NSError descriptions, and any
    /// thrown coordinator messages) for the known sentinels.
    static func friendlyPayoutError(_ error: Error) -> String {
        let raw: String = {
            if case APIError.status(_, let msg) = error { return msg ?? "" }
            return (error as NSError).localizedDescription
        }()
        let lower = raw.lowercased()
        if raw.contains("LIMIT_EXCEEDED") { return "This exceeds your send limit." }
        if raw.contains("SCREENING_BLOCK") { return "Blocked by a compliance check." }
        if raw.contains("RESOLVE_FAILED") {
            return "Couldn't find one of the recipients — check the handles."
        }
        if lower.contains("rate_limited") || lower.contains("429") {
            return "Too many attempts — try again shortly."
        }
        if case APIError.status(let code, _) = error, code == 429 {
            return "Too many attempts — try again shortly."
        }
        // Surface the server's real, human reason (e.g. "Couldn't resolve
        // recipient #1 (ruru@talise)." or "You don't have enough USDsui")
        // instead of a blanket failure — honestMoneyError trims/maps it safely.
        return APIError.honestMoneyError(error, fallback: "Couldn't pay the team. Please try again.")
    }
}
