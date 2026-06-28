import SwiftUI

/// Rules / Automations hub. A rule is money that runs itself — a fixed amount
/// sent to a recipient on a schedule, paid out gaslessly by a backend worker
/// from the rule's OWN non-custodial on-chain pot. List shows active + paused
/// rules; each can be paused/resumed or cancelled (a cancel signs an on-chain
/// refund of the remaining pot, then clears the row).
///
/// Presented INSIDE the NavigationStack the parent provides (like PayrollView):
/// it pushes RuleEditView with NavigationLink and reloads on every appearance.
///
/// When the feature is gated off server-side (`enabled == false`), we show a
/// clean "Automations are coming soon" state instead of an error, and hide the
/// create button (POST would 503).
struct RulesView: View {
    @Environment(AppSession.self) private var session

    @State private var rules: [RuleDTO] = []
    @State private var enabled = false
    @State private var loaded = false
    @State private var loading = true
    @State private var error: String?
    @State private var busyId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                if enabled {
                    NavigationLink {
                        RuleEditView()
                    } label: {
                        newRuleLabel
                    }
                    .buttonStyle(.plain)
                }

                if loading && !loaded {
                    loadingState
                } else if let error {
                    errorState(error)
                } else if !enabled {
                    comingSoonState
                } else if rules.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 12) {
                        ForEach(rules) { rule in ruleRow(rule) }
                    }
                }

                Color.clear.frame(height: 28)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("AUTOMATIONS")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text("Money that runs itself")
                .font(TaliseFont.heading(26, weight: .medium)).kerning(-0.6)
                .foregroundStyle(TaliseColor.fg)
            Text("Set a rule once — pay a fixed amount to someone on a schedule. It runs automatically and gaslessly.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var newRuleLabel: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(.black)
            Text("New rule")
                .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
        }
        .frame(maxWidth: .infinity).frame(height: 54)
        .background(Capsule().fill(TaliseColor.greenMint))
    }

    // MARK: - Rule row

    private func ruleRow(_ rule: RuleDTO) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(TaliseColor.greenMint.opacity(0.12))
                    .frame(width: 46, height: 46)
                Image(systemName: rule.isPaused ? "pause.fill" : "arrow.triangle.2.circlepath")
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(rule.isPaused ? TaliseColor.fgMuted : TaliseColor.greenMint)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(rule.name)
                    .font(TaliseFont.heading(16, weight: .medium))
                    .foregroundStyle(TaliseColor.fg).lineLimit(1)
                Text("\(TaliseFormat.usd2(rule.amountUsd)) to \(rule.recipientLabel)")
                    .font(TaliseFont.body(12.5, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted).lineLimit(1)
                Text(rule.cadenceLine + (rule.isPaused ? " · Paused" : ""))
                    .font(TaliseFont.mono(10.5, weight: .regular))
                    .foregroundStyle(TaliseColor.fgDim).lineLimit(1)
            }
            Spacer(minLength: 8)
            if busyId == rule.id {
                ProgressView().tint(TaliseColor.fgMuted).frame(width: 20, height: 20)
            } else {
                Button {
                    Task { await toggle(rule) }
                } label: {
                    Image(systemName: rule.isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(TaliseColor.fg)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(TaliseColor.surface2))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .rampCard()
        .opacity(busyId == rule.id ? 0.5 : 1)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                Task { await delete(rule) }
            } label: {
                Label("Cancel", systemImage: "trash")
            }
        }
        .contextMenu {
            Button {
                Task { await toggle(rule) }
            } label: {
                Label(rule.isPaused ? "Resume" : "Pause", systemImage: rule.isPaused ? "play" : "pause")
            }
            Button(role: .destructive) {
                Task { await delete(rule) }
            } label: {
                Label("Cancel & refund pot", systemImage: "trash")
            }
        }
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(TaliseColor.surface).frame(height: 78)
                    .redacted(reason: .placeholder)
            }
        }
        .overlay(ProgressView().tint(TaliseColor.fgMuted))
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 14) {
            Text(msg)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
            Button {
                Task { await load() }
            } label: {
                Text("Try again")
                    .font(TaliseFont.body(15, weight: .semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 24).frame(height: 46)
                    .background(Capsule().fill(TaliseColor.greenMint))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity).padding(.top, 50)
    }

    /// Feature-gated state — automations aren't live yet (no escrow key set).
    private var comingSoonState: some View {
        VStack(spacing: 12) {
            Image(systemName: "clock.arrow.2.circlepath")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            Text("Automations are coming soon")
                .font(TaliseFont.heading(18, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .multilineTextAlignment(.center)
            Text("Soon you'll be able to set money to send itself — pay rent on the 1st, top someone up weekly, all gaslessly.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity).padding(.top, 44)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            Text("No rules yet")
                .font(TaliseFont.heading(18, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
            Text("Create one to send money on a schedule, automatically.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity).padding(.top, 44)
    }

    // MARK: - Actions

    private func load() async {
        if rules.isEmpty { loading = true }
        error = nil
        defer { loading = false; loaded = true }
        do {
            let res = try await RulesAPI.list()
            rules = res.rules
            enabled = res.enabled
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't load your rules right now."
        }
    }

    private func toggle(_ rule: RuleDTO) async {
        busyId = rule.id
        defer { busyId = nil }
        do {
            _ = rule.isPaused ? try await RulesAPI.resume(id: rule.id)
                              : try await RulesAPI.pause(id: rule.id)
            await load()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't update that rule. Please try again."
        }
    }

    /// Cancel a rule: sign the on-chain `cancel` (refunds the remaining pot to
    /// you), then clear the row. If the rule has no on-chain order (409), there's
    /// nothing to refund — just clear the row.
    private func delete(_ rule: RuleDTO) async {
        busyId = rule.id
        defer { busyId = nil }
        do {
            do {
                let prep = try await RulesAPI.cancelPrepare(id: rule.id)
                _ = try await ZkLoginCoordinator.shared.signAndExecuteRaw(
                    bytesB64: prep.bytes,
                    meta: ["kind": "rule-cancel"]
                )
            } catch APIError.status(409, _) {
                // No on-chain order to refund — fall through to clear the row.
            }
            try await RulesAPI.delete(id: rule.id)
            await load()
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            error = "Sign in again — your session needs a refresh."
            session.signOut()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't cancel that rule. Please try again."
        }
    }
}
