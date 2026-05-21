import SwiftUI

struct EarnView: View {
    @State private var comparison: YieldComparison?
    @State private var loading = true
    @State private var supplyAmount = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    PageHeader(eyebrow: "Earn", title: "Make your dollars work")

                    if let comparison {
                        VStack(spacing: 12) {
                            ForEach(comparison.venues) { venue in
                                venueRow(venue, best: venue.venue == comparison.best?.venue)
                            }
                        }
                    } else {
                        StatCard(eyebrow: "APY", value: loading ? "—" : "Unavailable")
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Eyebrow(text: "Supply USDsui")
                        HStack {
                            TextField("0.00", text: $supplyAmount)
                                .keyboardType(.decimalPad)
                                .font(TaliseFont.heading(24))
                            Spacer()
                            Text("USDsui")
                                .font(TaliseFont.heading(14))
                                .foregroundStyle(TaliseColor.fgMuted)
                        }
                        .padding(14)
                        .background(TaliseColor.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: TaliseRadius.md)
                                .stroke(TaliseColor.line, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.md))
                    }

                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12))
                            .foregroundStyle(TaliseColor.danger)
                    }

                    TaliseButton(title: "Supply to best venue", variant: .primary, size: .lg, icon: "chart.line.uptrend.xyaxis") {
                        Task { await supply() }
                    }
                    .disabled((Double(supplyAmount) ?? 0) <= 0)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
            .navigationBarHidden(true)
            .background(TaliseColor.bg)
            .task { await load() }
        }
    }

    private func venueRow(_ v: YieldVenue, best: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(v.venue.uppercased())
                        .font(TaliseFont.heading(14))
                        .foregroundStyle(TaliseColor.fg)
                    if best {
                        Text("BEST")
                            .font(TaliseFont.mono(9))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(TaliseColor.success.opacity(0.1))
                            .foregroundStyle(TaliseColor.success)
                            .clipShape(Capsule())
                    }
                }
                if let supplied = v.supplied, supplied > 0 {
                    Text("Supplied $\(String(format: "%.2f", supplied))")
                        .font(TaliseFont.body(12))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
            }
            Spacer()
            Text(String(format: "%.2f%%", v.apy * 100))
                .font(TaliseFont.heading(20))
                .foregroundStyle(TaliseColor.fg)
        }
        .padding(16)
        .background(TaliseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: TaliseRadius.lg)
                .stroke(TaliseColor.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.lg))
    }

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
        // TODO: wire to /api/t2000/supply or /api/spot/supply once
        // ZkLoginCoordinator can sign sponsored PTBs from iOS.
        error = "Supply wiring is pending SuiKit PTB integration."
    }
}
