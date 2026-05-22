import SwiftUI

/// Live yield comparison + sponsored supply into the best venue.
/// Reads /api/yield/comparison, supplies USDsui via /api/earn/supply/build
/// → ZkLoginCoordinator (Onara sponsored).
struct EarnView: View {
    @State private var comparison: YieldComparison?
    @State private var amount = ""
    @State private var loading = true
    @State private var supplying = false
    @State private var error: String?
    @State private var success: String?

    var body: some View {
        ZStack(alignment: .top) {
            TaliseColor.bg.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    venueCards
                    supplyCard
                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12, weight: .light))
                            .foregroundStyle(TaliseColor.danger)
                    }
                    if let success {
                        successBanner(success)
                    }
                    Spacer(minLength: 120)
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
            }
            .refreshable { await load() }
        }
        .task { await load() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Earn", color: TaliseColor.fgDim).kerning(1.5)
            Text("Make your dollars work")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            if let best = comparison?.best {
                Text(String(format: "Best: %@ · %.2f%% APY", best.venue.uppercased(), best.apy * 100))
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.accent)
            }
        }
    }

    // MARK: - Venue cards

    private var venueCards: some View {
        VStack(spacing: 12) {
            if loading {
                ForEach(0..<2, id: \.self) { _ in
                    venuePlaceholder
                }
            } else if let cmp = comparison, !cmp.venues.isEmpty {
                ForEach(cmp.venues) { v in
                    venueCard(v, best: v.venue == cmp.best?.venue)
                }
            } else {
                emptyState
            }
        }
    }

    private var venuePlaceholder: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Capsule().fill(TaliseColor.line).frame(width: 70, height: 10)
                Capsule().fill(TaliseColor.line).frame(width: 110, height: 8)
            }
            Spacer()
            Capsule().fill(TaliseColor.line).frame(width: 60, height: 14)
        }
        .padding(16)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .redacted(reason: .placeholder)
        .opacity(0.5)
    }

    private var emptyState: some View {
        VStack(spacing: 4) {
            Text("No live venues right now.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Text("Pull to refresh.")
                .font(TaliseFont.mono(10, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func venueCard(_ v: YieldVenue, best: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(v.venue.uppercased())
                        .font(TaliseFont.heading(14, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    if best {
                        Text("BEST")
                            .font(TaliseFont.mono(9, weight: .light))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(TaliseColor.accent.opacity(0.18))
                            .foregroundStyle(TaliseColor.accent)
                            .clipShape(Capsule())
                    }
                }
                if let supplied = v.supplied, supplied > 0 {
                    Text(String(format: "Supplied $%.2f", supplied))
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                } else {
                    Text("Idle")
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }
            Spacer()
            Text(String(format: "%.2f%%", v.apy * 100))
                .font(TaliseFont.heading(22, weight: .medium))
                .kerning(-0.8)
                .foregroundStyle(TaliseColor.fg)
        }
        .padding(16)
        .background(TaliseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(best ? TaliseColor.accent.opacity(0.4) : Color.clear, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    // MARK: - Supply card

    private var supplyCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            MicroLabel(text: "Supply USDsui", color: TaliseColor.fgDim).kerning(1.5)
            HStack {
                TextField("0.00", text: $amount)
                    .keyboardType(.decimalPad)
                    .font(TaliseFont.heading(28, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fg)
                    .tint(TaliseColor.accent)
                Spacer()
                Text("USDsui")
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(14)
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Button(action: { Task { await supply() } }) {
                HStack(spacing: 10) {
                    if supplying {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(TaliseColor.bg)
                    } else {
                        Image(systemName: "chart.line.uptrend.xyaxis")
                            .font(.system(size: 14, weight: .medium))
                    }
                    Text(supplying ? "Supplying…" : supplyLabel)
                        .font(TaliseFont.heading(15, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(canSupply ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
                .clipShape(Capsule())
            }
            .disabled(!canSupply)
        }
        .padding(20)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 25))
    }

    private var canSupply: Bool {
        (Double(amount) ?? 0) > 0 && comparison?.best != nil && !supplying
    }

    private var supplyLabel: String {
        guard let best = comparison?.best else { return "Supply" }
        guard let amt = Double(amount), amt > 0 else {
            return "Supply to \(best.venue.uppercased())"
        }
        return "Supply $\(amount) to \(best.venue.uppercased())"
    }

    private func successBanner(_ digest: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(TaliseColor.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Supplied")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                MicroLabel(text: digest.prefix(20) + "…", color: TaliseColor.fgDim)
            }
            Spacer()
        }
        .padding(14)
        .background(TaliseColor.accent.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            comparison = try await APIClient.shared.get("/api/yield/comparison")
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func supply() async {
        guard let best = comparison?.best,
              let amt = Double(amount), amt > 0 else { return }
        supplying = true
        error = nil
        success = nil
        defer { supplying = false }
        do {
            struct Body: Encodable { let venue: String; let amount: Double }
            let built: BuildKindResponse = try await APIClient.shared.post(
                "/api/earn/supply/prepare",
                body: Body(venue: best.venue, amount: amt)
            )
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: "Supply \(amount) USDsui"
            )
            success = result.digest
            amount = ""
            // Refresh comparison so the supplied row updates.
            Task { await load() }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
