import SwiftUI
import Charts

/// TRADE — WaterX perpetuals, in the Talise app. A clean, touch-first trading
/// screen: pair header + live price, candlestick chart, open positions and
/// history, and a Long / Short bottom sheet that runs on the Onara-sponsored
/// zkLogin rail (no gas, no seed phrase).
struct TradeView: View {
    @Environment(AppSession.self) private var session
    @State private var svc = TradeService()

    @State private var pickerUp = false
    @State private var orderSide: Bool? = nil       // non-nil → order sheet up
    @State private var posTab: PosTab = .positions
    @State private var result: TradeResult?
    @State private var banner: String?

    enum PosTab: String, CaseIterable { case positions = "Positions", history = "History" }

    var body: some View {
        ZStack(alignment: .bottom) {
            TaliseColor.bg.ignoresSafeArea()

            if svc.disabled {
                disabledState
            } else {
                content
                tradeBar
            }
        }
        .task { await boot() }
        .task(id: svc.selected) { await onSelect() }
        .sheet(isPresented: $pickerUp) {
            MarketPickerSheet(svc: svc) { pickerUp = false }
        }
        .sheet(isPresented: Binding(get: { orderSide != nil },
                                    set: { if !$0 { orderSide = nil } })) {
            OrderSheet(svc: svc, session: session, initialLong: orderSide ?? true,
                       onResult: { r in result = r },
                       onBanner: { banner = $0 })
        }
        .overlay(alignment: .top) { bannerView }
        .fullScreenCover(item: $result) { r in
            TradeResultCard(result: r) { result = nil }
        }
    }

    // MARK: - Content

    private var content: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                header
                priceBlock
                timeframeRow
                chart
                statsStrip
                positionsSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 190)   // clears the trade bar + nav pill
        }
        .refreshable { await svc.refreshSelected(); await svc.loadHistory() }
    }

    // Pair selector + account chip
    private var header: some View {
        HStack(spacing: 12) {
            Button { pickerUp = true } label: {
                HStack(spacing: 10) {
                    MarketLogo(ticker: svc.selected, size: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 5) {
                            Text("\(svc.market?.sym ?? svc.selected)/USD")
                                .font(TaliseFont.heading(17, weight: .semibold))
                                .foregroundStyle(TaliseColor.fg)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(TaliseColor.fgDim)
                        }
                        Text(svc.market?.name ?? "")
                            .font(TaliseFont.body(11))
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                }
            }
            .buttonStyle(.plain)

            Spacer()

            Button { orderSide = true } label: {
                VStack(alignment: .trailing, spacing: 1) {
                    Text("Available")
                        .font(TaliseFont.mono(9, weight: .regular))
                        .kerning(0.4)
                        .foregroundStyle(TaliseColor.fgDim)
                    Text(String(format: "$%.2f", svc.availableUsd))
                        .font(TaliseFont.heading(15, weight: .semibold))
                        .foregroundStyle(TaliseColor.accent)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private var priceBlock: some View {
        HStack(alignment: .lastTextBaseline, spacing: 12) {
            Text(svc.price > 0 ? "$\(TradeFormat.price(svc.price))" : "—")
                .font(.system(size: 38, weight: .bold, design: .rounded))
                .foregroundStyle(TaliseColor.fg)
                .contentTransition(.numericText())
                .animation(.easeOut(duration: 0.3), value: svc.price)
            let up = svc.change24h >= 0
            Text(TradeFormat.signedPct(svc.change24h))
                .font(TaliseFont.heading(15, weight: .semibold))
                .foregroundStyle(up ? TradeColor.long : TradeColor.short)
                .padding(.bottom, 4)
            Spacer()
        }
    }

    private var timeframeRow: some View {
        HStack(spacing: 6) {
            ForEach(TradeService.intervals, id: \.self) { iv in
                let on = svc.interval == iv
                Button {
                    svc.interval = iv
                    Task { await svc.loadChart() }
                } label: {
                    Text(iv)
                        .font(TaliseFont.body(12, weight: on ? .semibold : .regular))
                        .foregroundStyle(on ? TaliseColor.fg : TaliseColor.fgDim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(
                            RoundedRectangle(cornerRadius: 9)
                                .fill(on ? TaliseColor.surface2 : .clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 12).fill(TaliseColor.surface))
    }

    // MARK: - Chart

    @ViewBuilder
    private var chart: some View {
        Group {
            if svc.candles.isEmpty { chartPlaceholder } else { candleChart }
        }
        .frame(height: 268)
    }

    private var chartPlaceholder: some View {
        RoundedRectangle(cornerRadius: 16).fill(TaliseColor.surface)
            .overlay(chartPlaceholderLabel)
    }

    @ViewBuilder
    private var chartPlaceholderLabel: some View {
        if svc.loadingChart {
            ProgressView().tint(TaliseColor.fgDim)
        } else {
            Text("No chart data").font(TaliseFont.body(12)).foregroundStyle(TaliseColor.fgDim)
        }
    }

    private var candleChart: some View {
        let cs = svc.candles
        let lo = cs.map(\.low).min() ?? 0
        let hi = cs.map(\.high).max() ?? 1
        let pad = (hi - lo) * 0.08
        return Chart(cs) { candleMarks($0) }
            .chartYScale(domain: (lo - pad)...(hi + pad))
            .chartYAxis { yAxisMarks }
            .chartXAxis { xAxisMarks }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 16).fill(TaliseColor.surface))
    }

    @AxisContentBuilder
    private var yAxisMarks: some AxisContent {
        AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { v in
            AxisGridLine().foregroundStyle(TaliseColor.line)
            AxisValueLabel {
                if let d = v.as(Double.self) {
                    Text(TradeFormat.price(d)).font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim)
                }
            }
        }
    }

    @AxisContentBuilder
    private var xAxisMarks: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
            AxisGridLine().foregroundStyle(TaliseColor.line)
        }
    }

    @ChartContentBuilder
    private func candleMarks(_ c: Candle) -> some ChartContent {
        let col: Color = c.close >= c.open ? TradeColor.long : TradeColor.short
        RuleMark(x: .value("t", c.date),
                 yStart: .value("l", c.low), yEnd: .value("h", c.high))
            .foregroundStyle(col.opacity(0.55))
            .lineStyle(StrokeStyle(lineWidth: 1))
        RectangleMark(x: .value("t", c.date),
                      yStart: .value("o", min(c.open, c.close)),
                      yEnd: .value("c", max(c.open, c.close)),
                      width: .fixed(4))
            .foregroundStyle(col)
    }

    private var statsStrip: some View {
        HStack(spacing: 0) {
            stat("24h", TradeFormat.signedPct(svc.change24h),
                 svc.change24h >= 0 ? TradeColor.long : TradeColor.short)
            divider
            stat("Max lev", "\(Int(svc.market?.maxLeverage ?? 0))x", TaliseColor.fg)
            divider
            stat("Funding", String(format: "%.3f%%", svc.market?.fundingRatePct ?? 0), TaliseColor.fgMuted)
            divider
            stat("Fee", String(format: "%.2f%%", (svc.market?.tradingFeeBps ?? 0) / 100), TaliseColor.fgMuted)
        }
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 14).fill(TaliseColor.surface))
    }

    private func stat(_ k: String, _ v: String, _ color: Color) -> some View {
        VStack(spacing: 3) {
            Text(k).font(TaliseFont.mono(9, weight: .regular)).kerning(0.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text(v).font(TaliseFont.heading(13, weight: .semibold)).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
    }

    private var divider: some View {
        Rectangle().fill(TaliseColor.line).frame(width: 1, height: 26)
    }

    // MARK: - Positions / history

    private var positionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                ForEach(PosTab.allCases, id: \.self) { t in
                    let on = posTab == t
                    Button { posTab = t } label: {
                        Text(t.rawValue + (t == .positions && !svc.positions.isEmpty ? " · \(svc.positions.count)" : ""))
                            .font(TaliseFont.body(13, weight: on ? .semibold : .regular))
                            .foregroundStyle(on ? TaliseColor.fg : TaliseColor.fgDim)
                            .padding(.vertical, 7).padding(.horizontal, 14)
                            .background(Capsule().fill(on ? TaliseColor.surface2 : .clear))
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }

            if posTab == .positions {
                if svc.positions.isEmpty {
                    emptyRow("No open positions", "Your open trades appear here.")
                } else {
                    ForEach(svc.positions) { p in PositionRow(p: p, svc: svc,
                                                              onResult: { result = $0 },
                                                              onBanner: { banner = $0 }) }
                }
            } else {
                if svc.history.isEmpty {
                    emptyRow("No trade history", "Opens, closes and transfers show up here.")
                } else {
                    ForEach(svc.history.prefix(40)) { TradeHistoryRow(entry: $0) }
                }
            }
        }
    }

    private func emptyRow(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(TaliseFont.heading(14, weight: .semibold)).foregroundStyle(TaliseColor.fgMuted)
            Text(sub).font(TaliseFont.body(12)).foregroundStyle(TaliseColor.fgDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 14).fill(TaliseColor.surface))
    }

    // MARK: - Sticky trade bar

    private var tradeBar: some View {
        HStack(spacing: 10) {
            tradeButton("Long", TradeColor.long) { orderSide = true }
            tradeButton("Short", TradeColor.short) { orderSide = false }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 84)   // sits above the floating nav pill
    }

    private func tradeButton(_ label: String, _ color: Color, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text("\(label) \(svc.market?.sym ?? svc.selected)")
                .font(TaliseFont.heading(16, weight: .semibold))
                .foregroundStyle(Color(hex: 0x0A130A))
                .frame(maxWidth: .infinity).frame(height: 52)
                .background(RoundedRectangle(cornerRadius: 16).fill(color))
                .shadow(color: color.opacity(0.35), radius: 16, x: 0, y: 8)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Banner + disabled

    @ViewBuilder private var bannerView: some View {
        if let b = banner {
            Text(b)
                .font(TaliseFont.body(13, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(Capsule().fill(TaliseColor.surface2))
                .overlay(Capsule().strokeBorder(TaliseColor.line, lineWidth: 1))
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task {
                    try? await Task.sleep(nanoseconds: 2_600_000_000)
                    withAnimation { banner = nil }
                }
        }
    }

    private var disabledState: some View {
        VStack(spacing: 12) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 34, weight: .light)).foregroundStyle(TaliseColor.fgDim)
            Text("Trading is rolling out").font(TaliseFont.heading(17, weight: .semibold)).foregroundStyle(TaliseColor.fg)
            Text("Perpetuals aren't switched on for your account yet.\nCheck back soon.")
                .multilineTextAlignment(.center)
                .font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgDim)
        }
        .padding(40)
    }

    // MARK: - Lifecycle

    private func boot() async {
        await svc.loadMarkets()
        await svc.loadHistory()
        await onSelect()
    }

    private func onSelect() async {
        await svc.refreshSelected()
        // Light polling of the live quote while this screen is up.
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if Task.isCancelled { break }
            await svc.loadQuote()
        }
    }
}

// MARK: - Market logo (reuses the web asset-icon proxy)

struct MarketLogo: View {
    let ticker: String
    var size: CGFloat = 32

    var body: some View {
        let url = URL(string: AppConfig.shared.apiBaseURL + "/api/asset-icon/\(ticker.uppercased())")
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let img): img.resizable().scaledToFill()
            default:
                Circle().fill(TaliseColor.surface2)
                    .overlay(Text(String(ticker.prefix(2)))
                        .font(TaliseFont.heading(size * 0.36, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgMuted))
            }
        }
        .frame(width: size, height: size)
        .background(Color.white)
        .clipShape(Circle())
    }
}
