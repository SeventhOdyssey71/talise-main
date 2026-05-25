import SwiftUI

/// Round-up & Save card — Phase 2 of the Rewards refresh.
///
/// Lets the user opt in to auto-saving a small percentage of every
/// outbound send (default 2%, configurable 1-10) to NAVI. Funds stay
/// in their wallet; they earn 5 pts per $1 swept.
///
/// State flow:
///   1. Card renders from `summary.roundup` + `summary.roundupSavedUsd`
///      (read on the parent's `load()`).
///   2. Toggling on/off or sliding the % POSTs to
///      `/api/rewards/roundup` and on success invokes `onChange()` —
///      the parent re-fetches the summary so the displayed values
///      come from the server, not local state. This keeps the
///      "saved via round-up" line and the toggle in lock-step with
///      DB truth.
///
/// The card sits between the lifetime-stats row and the earn-rules
/// card on RewardsView — see the `// ANCHOR: roundup-section` marker.
struct RoundupCard: View {
    /// Latest rewards summary from the parent. May be nil while the
    /// initial fetch is still in flight — the card renders in a
    /// disabled-skeleton state until config lands.
    let summary: RewardsSummary?

    /// Called after a successful config POST so the parent can refetch
    /// `/api/referral/summary` and pick up the new `roundup` + lifetime
    /// numbers. Wrapped in `Task { await load() }` at the call site.
    let onChange: () -> Void

    @State private var pendingToggle: Bool? = nil
    @State private var pendingPercentage: Int? = nil
    @State private var saving = false
    @State private var error: String? = nil

    /// What the UI currently shows — `pendingX` overrides during the
    /// optimistic flip so the toggle / slider feel instant; falls back
    /// to the server-truth value once the response lands and onChange
    /// triggers a parent refetch.
    private var enabled: Bool {
        pendingToggle ?? summary?.roundup?.enabled ?? false
    }
    private var percentage: Int {
        pendingPercentage ?? summary?.roundup?.percentage ?? 2
    }
    private var savedUsd: Double {
        summary?.roundupSavedUsd ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            if enabled {
                Divider().background(Color.white.opacity(0.06))
                slider
                Divider().background(Color.white.opacity(0.06))
                savedLine
            }

            footer
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .taliseGlass(cornerRadius: 22)
        .opacity(enabled ? 1.0 : 0.92)
        .animation(.easeInOut(duration: 0.18), value: enabled)
    }

    // MARK: - Header (title + subtitle + toggle)

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                MicroLabel(text: "Round-up & Save", color: TaliseColor.fgDim)
                    .kerning(1.5)
                Text(subtitleCopy)
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            // The Toggle drives an optimistic local flip + a backend
            // POST. SwiftUI's binding semantics make a custom Binding
            // the cleanest way to keep the visual instant while the
            // network round-trip completes.
            Toggle(
                "",
                isOn: Binding(
                    get: { enabled },
                    set: { newValue in
                        Task { await save(enabled: newValue, percentage: nil) }
                    }
                )
            )
            .labelsHidden()
            .tint(TaliseColor.accent)
            .disabled(saving)
        }
    }

    /// One-line subtitle that updates with the current %. When the
    /// toggle is off we still show the default 2% to telegraph what
    /// the user is opting INTO — same copy the prompt called out.
    private var subtitleCopy: String {
        "Auto-save \(percentage)% of every send to Navi at 5% APY"
    }

    // MARK: - Slider (% picker)

    private var slider: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                MicroLabel(text: "Save percentage", color: TaliseColor.fgDim)
                    .kerning(1.5)
                Spacer()
                Text("\(percentage)%")
                    .font(TaliseFont.mono(13, weight: .light))
                    .foregroundStyle(TaliseColor.accent)
            }
            // Step:1 keeps the slider on integer percents (the backend
            // clamps to 1..10 ints anyway). onEditingChanged fires the
            // POST only on release, so dragging doesn't spam the API.
            Slider(
                value: Binding(
                    get: { Double(percentage) },
                    set: { pendingPercentage = clamp(Int($0.rounded()), 1, 10) }
                ),
                in: 1...10,
                step: 1,
                onEditingChanged: { editing in
                    if !editing, let p = pendingPercentage {
                        Task { await save(enabled: nil, percentage: p) }
                    }
                }
            )
            .tint(TaliseColor.accent)
            .disabled(saving)
        }
    }

    // MARK: - Saved-via-roundup line

    private var savedLine: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                MicroLabel(text: "Saved via round-up", color: TaliseColor.fgDim)
                    .kerning(1.5)
                Text(TaliseFormat.local2(savedUsd))
                    .font(TaliseFont.heading(20, weight: .medium))
                    .kerning(-0.6)
                    .foregroundStyle(TaliseColor.accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            Spacer()
            Image(systemName: "leaf.fill")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(TaliseColor.accent.opacity(0.7))
        }
    }

    // MARK: - Footer (how-it-works)

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("How it works")
                .font(TaliseFont.mono(10, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .kerning(1.2)
            Text("Every time you send money, we sweep your chosen percentage to Navi at ~5% APY. Funds stay in your wallet — and you earn 5 pts per $1 saved.")
                .font(TaliseFont.body(11, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .fixedSize(horizontal: false, vertical: true)
            if let error {
                Text(error)
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
                    .padding(.top, 2)
            }
        }
    }

    // MARK: - Network

    /// POSTs the updated config to `/api/rewards/roundup`. Optimistic:
    /// the pending* state lets the toggle/slider feel instant; on
    /// success we clear pendings + invoke `onChange()` to refetch the
    /// summary; on failure we revert + surface the error inline.
    private func save(enabled: Bool?, percentage: Int?) async {
        if saving { return }
        saving = true
        error = nil
        defer { saving = false }

        // Stage the optimistic value so the UI reflects intent
        // immediately (the explicit assignment also covers the case
        // where the caller passed `enabled` but the toggle was driven
        // by a tap that already set `pendingToggle` to the new value).
        if let enabled { pendingToggle = enabled }
        if let percentage { pendingPercentage = percentage }

        struct Body: Encodable { let enabled: Bool?; let percentage: Int? }
        struct Resp: Decodable { let enabled: Bool; let percentage: Int; let savedUsd: Double }

        do {
            let _: Resp = try await APIClient.shared.post(
                "/api/rewards/roundup",
                body: Body(enabled: enabled, percentage: percentage)
            )
            // Drop the optimistic shadow — parent refetch will populate
            // `summary.roundup` from server truth.
            pendingToggle = nil
            pendingPercentage = nil
            onChange()
        } catch {
            // Revert the optimistic flip so the toggle doesn't lie
            // about a state the server didn't accept.
            pendingToggle = nil
            pendingPercentage = nil
            self.error = "Couldn't update — try again."
        }
    }

    private func clamp(_ n: Int, _ lo: Int, _ hi: Int) -> Int {
        max(lo, min(hi, n))
    }
}
