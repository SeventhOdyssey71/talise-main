import SwiftUI

/// Renders a parsed Talise Agent intent beneath the assistant's message.
///
///   • Read-only intents (balance / yield / activity) auto-run inline on
///     appear and show their results — no slide, no signing.
///   • Write intents call `POST /api/agent/plan` to validate + price, render a
///     per-step preview, and gate execution behind a `SlideToConfirm` that is
///     enabled only when the server says the plan is `confirmable`.
///
/// "Agent proposes → server validates → human confirms." Styling mirrors
/// `PayTeamView` (rampCard, mint slide, honest error copy).
struct AgentIntentCard: View {
    let intent: AgentIntent

    @Environment(AppSession.self) private var session

    private enum Stage { case loading, plan, running, done, readOnly, failed }

    @State private var stage: Stage = .loading
    @State private var plan: AgentPlanDTO?
    @State private var resultLines: [String] = []
    @State private var error: String?
    @State private var resetSlider = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch stage {
            case .loading:
                loadingRow
            case .readOnly:
                readOnlyBody
            case .plan, .running, .failed:
                planBody
            case .done:
                doneBody
            }
        }
        .padding(16)
        .rampCard()
        .task { await start() }
    }

    // MARK: - Stages

    private var loadingRow: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.mini).tint(TaliseColor.fgDim)
            Text(intent.isReadOnlyOnly ? "Looking that up…" : "Checking this plan…")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
    }

    private var readOnlyBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(resultLines.enumerated()), id: \.offset) { _, line in
                HStack(alignment: .top, spacing: 8) {
                    Circle().fill(TaliseColor.fgDim).frame(width: 5, height: 5).padding(.top, 6)
                    Text(line)
                        .font(TaliseFont.body(14, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if resultLines.isEmpty {
                Text("Nothing to show.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        }
    }

    @ViewBuilder
    private var planBody: some View {
        if let plan {
            // Summary header
            Text(plan.summary)
                .font(TaliseFont.body(14, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(plan.steps.enumerated()), id: \.offset) { _, step in
                    stepRow(step)
                }
            }

            if let limit = plan.limit {
                Text("\(limit.window.capitalized) limit \(TaliseFormat.usd2(limit.limit)) · used \(TaliseFormat.usd2(limit.used)).")
                    .font(TaliseFont.mono(10, weight: .light)).kerning(0.2)
                    .foregroundStyle(TaliseColor.fgDim)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error {
                Text(error)
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if plan.confirmable {
                SlideToConfirm(
                    title: stage == .running ? "Working…" : slideTitle(plan),
                    tint: TaliseColor.greenMint,
                    reset: $resetSlider
                ) {
                    await confirm()
                }
                .disabled(stage == .running)
                .opacity(stage == .running ? 0.5 : 1)
                .padding(.top, 2)

                gaslessNote
            }
        }
    }

    private var doneBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 18)).foregroundStyle(TaliseColor.greenMint)
                Text("Done")
                    .font(TaliseFont.heading(16, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
            }
            ForEach(Array(resultLines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(TaliseFont.body(14, weight: .regular))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Step row

    private func stepRow(_ step: PlannedStepDTO) -> some View {
        HStack(alignment: .top, spacing: 10) {
            statusIcon(step)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.label)
                    .font(TaliseFont.body(14, weight: .regular))
                    .foregroundStyle(step.isReadOnly ? TaliseColor.fgMuted : TaliseColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = step.detail, !detail.isEmpty {
                    Text(detail)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(step.isBlocked ? TaliseColor.danger : TaliseColor.fgDim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func statusIcon(_ step: PlannedStepDTO) -> some View {
        if step.isBlocked {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13)).foregroundStyle(TaliseColor.danger).padding(.top, 1)
        } else if step.isReadOnly {
            Image(systemName: "eye")
                .font(.system(size: 12)).foregroundStyle(TaliseColor.fgDim).padding(.top, 2)
        } else {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13)).foregroundStyle(TaliseColor.greenMint).padding(.top, 1)
        }
    }

    private var gaslessNote: some View {
        HStack(spacing: 7) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 10, weight: .medium)).foregroundStyle(TaliseColor.greenMint)
            Text("No network fee — Talise sponsors the gas.")
                .font(TaliseFont.mono(10, weight: .light)).kerning(0.2)
                .foregroundStyle(TaliseColor.fgDim)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func slideTitle(_ plan: AgentPlanDTO) -> String {
        plan.totalSendUsd > 0
            ? "Slide to send \(TaliseFormat.usd2(plan.totalSendUsd))"
            : "Slide to confirm"
    }

    // MARK: - Actions

    private func start() async {
        if intent.isReadOnlyOnly {
            do {
                resultLines = try await AgentExecutor.runReadOnly(intent.steps)
                stage = .readOnly
            } catch {
                if APIError.isCancellation(error) { return }
                self.error = APIError.honestMoneyError(error, fallback: "Couldn't load that right now.")
                stage = .failed
            }
        } else {
            do {
                plan = try await AgentPlanAPI.plan(steps: intent.steps)
                stage = .plan
            } catch {
                if APIError.isCancellation(error) { return }
                self.error = APIError.honestMoneyError(error, fallback: "Couldn't check that plan right now.")
                // Surface as a one-line failed plan card.
                plan = AgentPlanDTO(confirmable: false, steps: [], totalSendUsd: 0, limit: nil,
                                    summary: "Couldn't check this plan.")
                stage = .failed
            }
        }
    }

    private func confirm() async {
        guard let plan, stage != .running else { return }
        stage = .running
        error = nil
        do {
            resultLines = try await AgentExecutor.execute(plan: plan, intent: intent)
            stage = .done
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            error = "Sign in again — your session needs a refresh."
            session.signOut()
            stage = .failed
            resetSlider = true
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = APIError.honestMoneyError(error, fallback: "Couldn't complete that. Please try again.")
            // Keep the plan visible so the user can slide to retry.
            stage = .plan
            resetSlider = true
        }
    }
}
