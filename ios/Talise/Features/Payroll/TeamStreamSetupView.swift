import SwiftUI

/// Set up a streaming payout for a team: fund a pot once, then equal shares
/// stream to every member on an interval, gaslessly, until the pot runs out.
///
/// Flow: createPrepare (draft + escrow address) → fund the escrow over the normal
/// gasless send rail (signAndSubmitSend) → record (activate). A backend cron then
/// releases each tranche. No per-tranche signing by the user.
struct TeamStreamSetupView: View {
    let team: TeamDTO
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSession.self) private var session

    @State private var amount: String = ""
    @State private var numTranches: Int = 4
    @State private var interval: Interval = .daily
    @State private var starting = false
    @State private var error: String?
    @State private var resetSlider = false
    @State private var started = false
    @State private var startedSummary: String = ""

    /// Payout cadence presets → minutes.
    enum Interval: String, CaseIterable, Identifiable {
        case minute = "Every minute"
        case hourly = "Hourly"
        case daily = "Daily"
        case weekly = "Weekly"
        var id: String { rawValue }
        var minutes: Int { switch self { case .minute: 1; case .hourly: 60; case .daily: 1440; case .weekly: 10080 } }
        var unit: String { switch self { case .minute: "minute"; case .hourly: "hour"; case .daily: "day"; case .weekly: "week" } }
    }

    private var memberCount: Int { max(team.members.count, 1) }
    private var totalUsd: Double { Double(amount.trimmingCharacters(in: .whitespaces)) ?? 0 }
    private var perMemberPerPayout: Double {
        guard numTranches > 0 else { return 0 }
        return totalUsd / Double(numTranches) / Double(memberCount)
    }
    private var canStart: Bool { totalUsd > 0 && numTranches >= 1 && perMemberPerPayout >= 0.01 && !starting }

    var body: some View {
        if started { successView } else { form }
    }

    // MARK: - Form

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                amountCard
                scheduleCard
                summaryCard

                if let error {
                    Text(error)
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                SlideToConfirm(title: starting ? "Starting…" : "Slide to start streaming",
                               tint: TaliseColor.accent,
                               reset: $resetSlider) {
                    await start()
                }
                .disabled(!canStart)
                .opacity(canStart ? 1 : 0.6)

                Text("One gasless transaction funds the pot. Payouts release automatically — no gas, ever.")
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
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("STREAM TO TEAM")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text("Stream to \(team.name)")
                .font(TaliseFont.heading(24, weight: .medium)).kerning(-0.5)
                .foregroundStyle(TaliseColor.fg)
            Text("Fund a pot once. Everyone gets an equal share on a schedule — automatically and gaslessly.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var amountCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AMOUNT TO STREAM")
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
                Text("PAYOUTS")
                    .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                    .foregroundStyle(TaliseColor.fgDim)
                Spacer()
                Stepper(value: $numTranches, in: 1...365) {
                    Text("\(numTranches)")
                        .font(TaliseFont.heading(16, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                }
                .labelsHidden()
                .fixedSize()
            }
            Divider().overlay(TaliseColor.line)
            HStack {
                Text("HOW OFTEN")
                    .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                    .foregroundStyle(TaliseColor.fgDim)
                Spacer()
                Picker("", selection: $interval) {
                    ForEach(Interval.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(TaliseColor.accent)
            }
        }
        .padding(16)
        .rampCard()
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("PREVIEW")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            Text("\(memberCount) \(memberCount == 1 ? "person" : "people") each get \(TaliseFormat.usd2(perMemberPerPayout)) per \(interval.unit)")
                .font(TaliseFont.body(14, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(numTranches) payouts · \(TaliseFormat.usd2(totalUsd)) total")
                .font(TaliseFont.mono(11, weight: .regular))
                .foregroundStyle(TaliseColor.fgMuted)
            if totalUsd > 0 && perMemberPerPayout < 0.01 {
                Text("Each share is too small — add more or use fewer payouts (min $0.01 each).")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .rampCard()
    }

    // MARK: - Success

    private var successView: some View {
        VStack(spacing: 16) {
            Spacer()
            ZStack {
                Circle().fill(TaliseColor.accent.opacity(0.16)).frame(width: 92, height: 92)
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.system(size: 40, weight: .regular))
                    .foregroundStyle(TaliseColor.accent)
            }
            Text("Streaming started")
                .font(TaliseFont.heading(24, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
            Text(startedSummary)
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
            Spacer()
            Button { dismiss() } label: {
                Text("Done")
                    .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(Capsule().fill(TaliseColor.greenMint))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20).padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TaliseColor.bg.ignoresSafeArea())
    }

    // MARK: - Action

    private func start() async {
        guard canStart else { resetSlider.toggle(); return }
        starting = true; error = nil
        defer { starting = false }
        do {
            // 1) Draft + escrow address.
            let prep = try await TeamStreamAPI.createPrepare(
                teamId: team.id,
                totalUsd: totalUsd,
                numTranches: numTranches,
                intervalMinutes: interval.minutes
            )
            // 2) Fund the escrow over the normal gasless send rail.
            let sub = try await ZkLoginCoordinator.shared.signAndSubmitSend(
                to: prep.escrowAddress,
                amountUsd: prep.totalUsd,
                intent: "Fund team stream"
            )
            // 3) Activate the stream with the funding digest.
            _ = try await TeamStreamAPI.record(streamId: prep.streamId, digest: sub.digest)

            startedSummary = "\(prep.memberCount) \(prep.memberCount == 1 ? "person" : "people") will each receive \(TaliseFormat.usd2(prep.perMemberUsd)) per \(interval.unit), \(prep.numTranches) times."
            NotificationCenter.default.post(name: .taliseTxCompleted, object: TaliseTxEvent(
                digest: sub.digest, direction: "sent", amountUsdsui: prep.totalUsd,
                counterparty: nil, counterpartyName: team.name, venue: nil))
            withAnimation { started = true }
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            error = "Sign in again — your session needs a refresh."
            resetSlider.toggle()
            session.signOut()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = APIError.honestMoneyError(error, fallback: "Couldn't start the stream. Please try again.")
            resetSlider.toggle()
        }
    }
}
