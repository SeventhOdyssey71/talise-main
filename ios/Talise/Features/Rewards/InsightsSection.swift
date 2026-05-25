import SwiftUI

/// Phase 3 — Month Insights.
///
/// Text-only month-to-date summary derived from the user's activity
/// feed on the server: total spent / received / saved + a top-3
/// counterparties strip.
///
/// Owns its own data lifecycle — pull-to-refresh on the parent Rewards
/// view does NOT call into here; we reload via `.task` so the parent's
/// `load()` stays unaware of this section (matches the file-disjoint
/// rule for Phase 3 work).
struct InsightsSection: View {
    @State private var insights: MonthInsights?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                MicroLabel(text: "This month", color: TaliseColor.fgDim).kerning(1.5)
                Spacer()
                if let count = insights?.sampleSize, count > 0 {
                    Text("\(count) movements")
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }
            metricsRow
            counterpartiesStrip
            if let error, !error.isEmpty {
                Text(error)
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
            }
        }
        .task { await load() }
    }

    // MARK: - Tiles

    private var metricsRow: some View {
        HStack(spacing: 10) {
            metricTile(
                label: "Spent",
                value: insights?.spentUsd ?? 0,
                color: TaliseColor.danger
            )
            metricTile(
                label: "Received",
                value: insights?.receivedUsd ?? 0,
                color: TaliseColor.fg
            )
            metricTile(
                label: "Saved",
                value: insights?.savedUsd ?? 0,
                color: TaliseColor.accent
            )
        }
    }

    private func metricTile(label: String, value: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: label, color: TaliseColor.fgDim).kerning(1.5)
            Text(TaliseFormat.local2(value))
                .font(TaliseFont.heading(16, weight: .medium))
                .kerning(-0.5)
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    // MARK: - Counterparties strip

    @ViewBuilder
    private var counterpartiesStrip: some View {
        if let list = insights?.topCounterparties, !list.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(list.enumerated()), id: \.element.id) { idx, cp in
                    counterpartyRow(cp)
                    if idx < list.count - 1 {
                        Rectangle().fill(Color.white.opacity(0.05))
                            .frame(height: 1).padding(.horizontal, 14)
                    }
                }
            }
            .background(TaliseColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18))
        } else if !loading {
            Text("No counterparties yet this month.")
                .font(TaliseFont.mono(10, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .padding(.vertical, 4)
        }
    }

    private func counterpartyRow(_ cp: InsightsCounterparty) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("You moved \(TaliseFormat.local2(cp.totalUsd))")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                Text("with \(cp.displayName) · \(cp.count) tx\(cp.count == 1 ? "" : "s")")
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            insights = try await APIClient.shared.get("/api/rewards/insights")
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
