import SwiftUI

/// Full activity history — opened from Home's "See all" link.
///
/// Shows every entry from /api/activity?limit=50 with three filter
/// chips (All / Received / Sent). Same glassmorphic row treatment as
/// Home, just unlimited and filterable.
struct HistoryView: View {
    @State private var entries: [ActivityEntryDTO] = []
    @State private var loading = true
    @State private var filter: Filter = .all
    @State private var receiptEntry: ActivityEntryDTO?

    enum Filter: String, CaseIterable, Identifiable {
        case all, sent, received, earn, swap
        var id: String { rawValue }
        var label: String {
            switch self {
            case .all: return "All"
            case .sent: return "Sent"
            case .received: return "Received"
            case .earn: return "Earn"
            case .swap: return "Swap"
            }
        }
    }

    private var filtered: [ActivityEntryDTO] {
        // Server emits six directions: sent, received, invest, withdraw,
        // swap, autoswap. Chips collapse the related pairs (invest/
        // withdraw → Earn; swap/autoswap → Swap) so Home users don't
        // hit five overlapping categories. `.sent` is strict — without
        // it Invest / Withdraw / Swap rows would get hidden under
        // "Sent" via the older `!isReceived` predicate.
        switch filter {
        case .all:
            return entries
        case .sent:
            return entries.filter { $0.direction == "sent" }
        case .received:
            return entries.filter { $0.direction == "received" }
        case .earn:
            return entries.filter {
                $0.direction == "invest" || $0.direction == "withdraw"
            }
        case .swap:
            return entries.filter {
                $0.direction == "swap" || $0.direction == "autoswap"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                filterChips
                if loading && entries.isEmpty {
                    ForEach(0..<4, id: \.self) { _ in placeholderRow }
                } else if filtered.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 10) {
                        ForEach(filtered) { entry in
                            HistoryRow(entry: entry) {
                                receiptEntry = entry
                            }
                        }
                    }
                }
                Color.clear.frame(height: 40)
            }
            .padding(.horizontal, 24)
            .padding(.top, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .task { await load() }
        .sheet(item: $receiptEntry) { entry in
            TxReceiptView(entry: entry)
                .presentationDetents([.medium, .large])
                .presentationBackground(TaliseColor.bg)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "History", color: TaliseColor.fgDim).kerning(1.5)
            Text("All activity")
                .font(TaliseFont.heading(26, weight: .medium))
                .kerning(-0.8)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private var filterChips: some View {
        // Horizontal scroll so 5 chips (All / Sent / Received / Earn /
        // Swap) don't get squeezed on narrow widths. Indicators hidden
        // because the chip row is short and the bouncy edge already
        // signals scrollability.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Filter.allCases) { f in
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { filter = f }
                    } label: {
                        Text(f.label)
                            .font(TaliseFont.heading(12, weight: .medium))
                            .foregroundStyle(filter == f ? TaliseColor.bg : TaliseColor.fg)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(filter == f ? TaliseColor.fg : TaliseColor.surface2)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var placeholderRow: some View {
        HStack(spacing: 14) {
            Circle().fill(TaliseColor.badgeNeutral).frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 4) {
                Capsule().fill(TaliseColor.line).frame(width: 90, height: 10)
                Capsule().fill(TaliseColor.line).frame(width: 60, height: 8)
            }
            Spacer()
            Capsule().fill(TaliseColor.line).frame(width: 70, height: 12)
        }
        .padding(14)
        .taliseGlass(cornerRadius: 18)
        .redacted(reason: .placeholder)
        .opacity(0.5)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .padding(.top, 28)
            Text("No \(filter == .all ? "" : filter.label.lowercased() + " ")activity yet")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fg)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            struct Response: Decodable { let entries: [ActivityEntryDTO] }
            let r: Response = try await APIClient.shared.get("/api/activity?limit=50")
            entries = r.entries
        } catch {
            entries = []
        }
    }
}
