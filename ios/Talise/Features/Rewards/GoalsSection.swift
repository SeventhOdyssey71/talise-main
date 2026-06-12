import SwiftUI

/// Phase 3 — Savings Goals.
///
/// Horizontal carousel of named savings buckets ("Laptop fund",
/// "Wedding 2026") plus a dashed "+ New goal" tile at the end. Tap a
/// card to open an action sheet: deposit, edit, or archive.
///
/// v1 reality: a "deposit" here is a TRACKING entry, not an actual
/// on-chain segregation — the dollars sit alongside the user's main
/// NAVI position. The deposit endpoint just bumps `current_usd` and
/// mints a `goal_deposit` rewards_event (4 pts/$1 via the canonical
/// earn engine). Future: per-goal NAVI sub-positions.
///
/// Owns its own data lifecycle — pull-to-refresh on the parent Rewards
/// view does NOT call into here; we reload via `.task` + after every
/// mutation. The Insights section is independent for the same reason.
struct GoalsSection: View {
    @State private var goals: [SavingsGoal] = []
    @State private var loading = true
    @State private var error: String?

    @State private var selected: SavingsGoal?
    @State private var showingNewGoal = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Savings goals")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    if loading && goals.isEmpty {
                        GoalCardSkeleton()
                        GoalCardSkeleton()
                    } else {
                        ForEach(goals) { goal in
                            GoalCard(goal: goal)
                                .onTapGesture { selected = goal }
                        }
                    }
                    NewGoalTile()
                        .onTapGesture { showingNewGoal = true }
                }
                .padding(.horizontal, 4)
            }
            .frame(height: 148)
            if let error, !error.isEmpty {
                Text(error)
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
                    .padding(.horizontal, 4)
            }
        }
        .task { await load() }
        .sheet(item: $selected, onDismiss: { Task { await load() } }) { g in
            GoalActionSheet(goal: g) { Task { await load() } }
        }
        .sheet(isPresented: $showingNewGoal, onDismiss: { Task { await load() } }) {
            NewGoalSheet()
        }
    }

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let resp: SavingsGoalsResponse = try await APIClient.shared.get("/api/rewards/goals")
            goals = resp.goals
            error = nil
        } catch {
            if !APIError.isCancellation(error) {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Goal card

private struct GoalCard: View {
    let goal: SavingsGoal

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(goal.name)
                        .font(TaliseFont.heading(15, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                    if let label = goal.deadlineLabel {
                        Text(label)
                            .font(TaliseFont.mono(10, weight: .regular))
                            .kerning(-0.32)
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                }
                Spacer()
                ProgressRing(progress: goal.progress)
                    .frame(width: 36, height: 36)
            }

            Spacer(minLength: 0)

            VStack(alignment: .leading, spacing: 2) {
                Text(TaliseFormat.local2(goal.currentUsd))
                    .font(TaliseFont.heading(18, weight: .medium))
                    .kerning(-0.5)
                    .foregroundStyle(TaliseColor.fg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("of \(TaliseFormat.local2(goal.targetUsd))")
                    .font(TaliseFont.mono(10, weight: .regular))
                    .kerning(-0.32)
                    .foregroundStyle(TaliseColor.fgDim)
                    .lineLimit(1)
            }
        }
        .padding(18)
        .frame(width: 168, height: 148, alignment: .topLeading)
        .earnHeroGlass(cornerRadius: 20)
    }
}

/// Goal progress ring — honest math, no fake floor. An empty goal reads
/// empty (mirrors `QuietProgressBar`'s clamp with no minimum).
private struct ProgressRing: View {
    let progress: Double

    private var clamped: CGFloat { CGFloat(min(max(progress, 0), 1)) }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.08), lineWidth: 4)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(TaliseColor.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int(clamped * 100))%")
                .font(TaliseFont.mono(9, weight: .regular))
                .foregroundStyle(TaliseColor.accent)
        }
    }
}

/// Loading placeholder shaped exactly like a `GoalCard` (A.8) — a badge
/// disc + two capsule bars, redacted. Honors the section's `loading`.
private struct GoalCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Capsule().fill(TaliseColor.line).frame(width: 80, height: 10)
                Spacer()
                Circle().fill(TaliseColor.surface2).frame(width: 36, height: 36)
            }
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 6) {
                Capsule().fill(TaliseColor.line).frame(width: 70, height: 12)
                Capsule().fill(TaliseColor.line).frame(width: 50, height: 8)
            }
        }
        .padding(18)
        .frame(width: 168, height: 148, alignment: .topLeading)
        .earnHeroGlass(cornerRadius: 20)
        .redacted(reason: .placeholder)
        .opacity(0.6)
    }
}

private struct NewGoalTile: View {
    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(TaliseColor.surface2)
                    .frame(width: 36, height: 36)
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
            }
            Text("New goal")
                .font(TaliseFont.heading(13, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
            Text("Name a bucket")
                .font(TaliseFont.mono(10, weight: .regular))
                .kerning(-0.32)
                .foregroundStyle(TaliseColor.fgDim)
                .multilineTextAlignment(.center)
        }
        .frame(width: 168, height: 148)
        .background(TaliseColor.bg)
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(
                    TaliseColor.accent.opacity(0.35),
                    style: StrokeStyle(lineWidth: 1, dash: [4, 4])
                )
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

// MARK: - Action sheet (deposit / edit / archive)

private struct GoalActionSheet: View {
    let goal: SavingsGoal
    let onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var depositText: String = ""
    @State private var editName: String
    @State private var editTargetText: String
    @State private var busy = false
    @State private var error: String?
    @State private var lastPointsAwarded: Int?

    init(goal: SavingsGoal, onChanged: @escaping () -> Void) {
        self.goal = goal
        self.onChanged = onChanged
        _editName = State(initialValue: goal.name)
        _editTargetText = State(initialValue: String(format: "%.2f", goal.targetUsd))
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 28) {
                    summary
                    deposit
                    edit
                    archive
                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12, weight: .light))
                            .foregroundStyle(TaliseColor.danger)
                            .padding(.horizontal, 4)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 24)
                .padding(.bottom, 40)
            }
            .taliseScreenBackground()
            .navigationTitle(goal.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(TaliseColor.accent)
                }
            }
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 16) {
            HeroAmount(
                eyebrow: "Saved so far",
                value: TaliseFormat.local2(goal.currentUsd),
                caption: "of \(TaliseFormat.local2(goal.targetUsd)) target",
                captionAccent: false
            )
            QuietProgressBar(progress: goal.progress)
            if let pts = lastPointsAwarded, pts > 0 {
                Text("+\(pts) points earned")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.accent)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .earnHeroGlass(cornerRadius: 24)
    }

    private var deposit: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Add to goal")
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(CurrencySettings.shared.current.symbol)
                        .font(TaliseFont.heading(28, weight: .medium))
                        .foregroundStyle(TaliseColor.fgDim)
                    TextField("0.00", text: $depositText)
                        .keyboardType(.decimalPad)
                        .font(TaliseFont.heading(28, weight: .medium))
                        .kerning(-0.8)
                        .tint(TaliseColor.accent)
                        .foregroundStyle(TaliseColor.fg)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .earnFieldGlass()

                Text("Tracking only — funds stay in your earning balance and keep earning points + yield.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)

                LiquidGlassButton(
                    title: busy ? "Adding…" : "Add to goal",
                    tint: TaliseColor.accent,
                    size: .lg,
                    loading: busy
                ) {
                    Task { await runDeposit() }
                }
                .disabled(busy || !canDeposit)
            }
            .padding(20)
            .earnHeroGlass(cornerRadius: 20)
        }
    }

    private var edit: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Edit goal")
            VStack(alignment: .leading, spacing: 14) {
                TextField("Name", text: $editName)
                    .font(TaliseFont.body(14, weight: .light))
                    .kerning(-0.48)
                    .tint(TaliseColor.accent)
                    .foregroundStyle(TaliseColor.fg)
                    .padding(14)
                    .earnFieldGlass()
                TextField("Target", text: $editTargetText)
                    .keyboardType(.decimalPad)
                    .font(TaliseFont.body(14, weight: .light))
                    .kerning(-0.48)
                    .tint(TaliseColor.accent)
                    .foregroundStyle(TaliseColor.fg)
                    .padding(14)
                    .earnFieldGlass()
                Button {
                    Task { await runEdit() }
                } label: {
                    Text(busy ? "Saving…" : "Save changes")
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .disabled(busy)
            }
            .padding(20)
            .earnHeroGlass(cornerRadius: 20)
        }
    }

    private var archive: some View {
        Button {
            Task { await runArchive() }
        } label: {
            Text("Archive goal")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.danger)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    private var canDeposit: Bool {
        let cleaned = depositText.replacingOccurrences(of: ",", with: ".")
        guard let v = Double(cleaned) else { return false }
        return v > 0
    }

    private func runDeposit() async {
        let cleaned = depositText.replacingOccurrences(of: ",", with: ".")
        guard let amount = Double(cleaned), amount > 0 else { return }
        busy = true
        defer { busy = false }
        do {
            // The user types in their display currency (₦, £, …); the goal
            // ledger settles in USD. Convert before sending — same path as
            // EarnView's supply field.
            let amountUsd = CurrencySettings.shared.convertToUsd(local: amount)
            let resp: SavingsGoalMutationResponse = try await APIClient.shared.post(
                "/api/rewards/goals/\(goal.id)",
                body: GoalDepositRequest(amountUsd: amountUsd)
            )
            lastPointsAwarded = resp.pointsAwarded
            depositText = ""
            onChanged()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func runEdit() async {
        busy = true
        defer { busy = false }
        let cleaned = editTargetText.replacingOccurrences(of: ",", with: ".")
        let target = Double(cleaned)
        do {
            _ = try await GoalsAPI.patch(
                id: goal.id,
                body: SavingsGoalUpdateRequest(
                    name: editName.isEmpty ? nil : editName,
                    targetUsd: target,
                    deadlineMs: nil,
                    color: nil,
                    archive: nil
                )
            )
            onChanged()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func runArchive() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await GoalsAPI.patch(
                id: goal.id,
                body: SavingsGoalUpdateRequest(
                    name: nil,
                    targetUsd: nil,
                    deadlineMs: nil,
                    color: nil,
                    archive: true
                )
            )
            onChanged()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - New goal sheet

private struct NewGoalSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var targetText = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader("New savings goal")
                    VStack(alignment: .leading, spacing: 14) {
                        TextField("Goal name (e.g. Laptop fund)", text: $name)
                            .font(TaliseFont.body(14, weight: .light))
                            .kerning(-0.48)
                            .tint(TaliseColor.accent)
                            .foregroundStyle(TaliseColor.fg)
                            .padding(14)
                            .earnFieldGlass()
                        TextField("Target amount (USD)", text: $targetText)
                            .keyboardType(.decimalPad)
                            .font(TaliseFont.body(14, weight: .light))
                            .kerning(-0.48)
                            .tint(TaliseColor.accent)
                            .foregroundStyle(TaliseColor.fg)
                            .padding(14)
                            .earnFieldGlass()
                        LiquidGlassButton(
                            title: busy ? "Creating…" : "Create goal",
                            tint: TaliseColor.accent,
                            size: .lg,
                            loading: busy
                        ) {
                            Task { await create() }
                        }
                        .disabled(busy || !canCreate)

                        if let error {
                            Text(error)
                                .font(TaliseFont.body(12, weight: .light))
                                .foregroundStyle(TaliseColor.danger)
                        }
                    }
                    .padding(20)
                    .earnHeroGlass(cornerRadius: 20)
                }
                .padding(.horizontal, 22)
                .padding(.top, 24)
                .padding(.bottom, 40)
            }
            .taliseScreenBackground()
            .navigationTitle("New goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }
        }
    }

    private var canCreate: Bool {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        let cleaned = targetText.replacingOccurrences(of: ",", with: ".")
        guard let v = Double(cleaned), v > 0 else { return false }
        return true
    }

    private func create() async {
        let cleaned = targetText.replacingOccurrences(of: ",", with: ".")
        guard let target = Double(cleaned), target > 0 else { return }
        busy = true
        defer { busy = false }
        do {
            let _: SavingsGoalMutationResponse = try await APIClient.shared.post(
                "/api/rewards/goals",
                body: SavingsGoalCreateRequest(
                    name: name,
                    targetUsd: target,
                    deadlineMs: nil,
                    color: nil
                )
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - PATCH helper
//
// `APIClient` only exposes GET + POST. The PATCH endpoint for goals
// (update / archive) is reached via a thin inline wrapper that reuses
// the auth header SecureSessionStore writes for every other call.
// Kept here (not in APIClient) so the Phase 3 scope stays narrow —
// no shared-network changes.
private enum GoalsAPI {
    @MainActor
    static func patch<B: Encodable>(id: String, body: B) async throws -> SavingsGoalMutationResponse {
        // Defensive: goal ids are server-generated, but never force-unwrap
        // a URL built from interpolated data — a malformed id should error,
        // not crash.
        guard let url = URL(string: AppConfig.shared.apiBaseURL + "/api/rewards/goals/\(id)") else {
            throw APIError.invalidResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.httpBody = try JSONEncoder().encode(body)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer = SecureSessionStore.shared.read() {
            req.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if !(200...299).contains(http.statusCode) {
            throw APIError.status(http.statusCode, message: String(data: data, encoding: .utf8))
        }
        return try JSONDecoder().decode(SavingsGoalMutationResponse.self, from: data)
    }
}
