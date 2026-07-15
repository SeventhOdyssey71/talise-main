import SwiftUI

// MARK: - Result of a closed trade (drives the celebratory / commiserating card)

struct TradeResult: Identifiable {
    let id = UUID()
    let sym: String
    let isLong: Bool
    let leverage: Double
    let entryPriceUsd: Double
    let markPriceUsd: Double
    let pnlUsd: Double
    let pnlPct: Double
    var win: Bool { pnlUsd >= 0 }
}

// MARK: - Order sheet (Long / Short ticket + account funding)

struct OrderSheet: View {
    @Bindable var svc: TradeService
    let session: AppSession
    let initialLong: Bool
    let onResult: (TradeResult) -> Void
    let onBanner: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var isLong = true
    @State private var leverage: Double = 10
    @State private var sizeTokens: Double = 0
    @State private var tpOn = false
    @State private var tp = ""
    @State private var sl = ""
    @State private var depositText = "5"
    @State private var withdrawText = "5"
    @State private var err: String?

    private var market: PerpMarket? { svc.market }
    private var price: Double { svc.price }
    private var sym: String { market?.sym ?? svc.selected }
    private var maxLev: Double { max(1, market?.maxLeverage ?? 25) }
    private var marginUsd: Double { price > 0 && leverage > 0 ? sizeTokens * price / leverage : 0 }
    private var notionalUsd: Double { sizeTokens * price }
    private var maxSize: Double {
        guard price > 0 else { return 0 }
        let byMargin = svc.availableUsd * leverage / price
        let byMarket = isLong ? (market?.availLongSize ?? 0) : (market?.availShortSize ?? 0)
        return max(0, min(byMargin, byMarket > 0 ? byMarket : byMargin))
    }
    private var acceptPrice: Double { price * (isLong ? 1.005 : 0.995) }
    private var liqPrice: Double {
        guard leverage > 0 else { return 0 }
        return isLong ? price * (1 - 1 / leverage) : price * (1 + 1 / leverage)
    }
    private var feeUsd: Double { notionalUsd * (market?.tradingFeeBps ?? 0) / 10_000 }
    private var canPlace: Bool {
        sizeTokens > 0 && marginUsd > 0 && svc.availableUsd >= marginUsd - 0.001 && svc.busy == nil
    }

    var body: some View {
        VStack(spacing: 0) {
            grabber
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    sideToggle
                    leverageField
                    sizeField
                    tpSlField
                    summary
                    Divider().overlay(TaliseColor.line)
                    accountPanel
                    if let err { errorLine(err) }
                }
                .padding(20)
                .padding(.bottom, 12)
            }
            placeBar
        }
        .background(TaliseColor.surface.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .onAppear {
            isLong = initialLong
            leverage = min(10, maxLev)
        }
    }

    private var grabber: some View {
        HStack {
            Capsule().fill(TaliseColor.fgDim.opacity(0.4)).frame(width: 40, height: 5)
        }
        .frame(maxWidth: .infinity).padding(.top, 10).padding(.bottom, 6)
    }

    private var sideToggle: some View {
        HStack(spacing: 6) {
            segButton("Long", isOn: isLong, color: TradeColor.long) { isLong = true }
            segButton("Short", isOn: !isLong, color: TradeColor.short) { isLong = false }
        }
        .padding(5)
        .background(RoundedRectangle(cornerRadius: 14).fill(TaliseColor.bg))
    }

    private func segButton(_ label: String, isOn: Bool, color: Color, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(label)
                .font(TaliseFont.heading(15, weight: .semibold))
                .foregroundStyle(isOn ? Color(hex: 0x0A130A) : TaliseColor.fgMuted)
                .frame(maxWidth: .infinity).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 11).fill(isOn ? color : .clear))
        }
        .buttonStyle(.plain)
    }

    private var leverageField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Leverage").font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
                Spacer()
                Text("\(Int(leverage))x").font(TaliseFont.heading(15, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
            }
            Slider(value: $leverage, in: 1...maxLev, step: 1).tint(TaliseColor.accent)
        }
    }

    private var sizeField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Size (\(sym))").font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
                Spacer()
                Text("Max \(TradeFormat.compact(maxSize))")
                    .font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.fgDim)
            }
            HStack {
                TextField("0.00", value: $sizeTokens, format: .number)
                    .keyboardType(.decimalPad)
                    .font(TaliseFont.heading(18, weight: .semibold))
                    .foregroundStyle(TaliseColor.fg)
                Spacer()
                Text("≈ $\(String(format: "%.2f", notionalUsd))")
                    .font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgDim)
            }
            .padding(.horizontal, 14).frame(height: 50)
            .background(RoundedRectangle(cornerRadius: 12).fill(TaliseColor.surface2))
            Slider(value: Binding(
                get: { min(sizeTokens, maxSize) },
                set: { sizeTokens = $0 }), in: 0...max(0.0001, maxSize)).tint(TaliseColor.accent)
            HStack {
                Text("Margin").font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
                Spacer()
                Text(String(format: "$%.2f", marginUsd))
                    .font(TaliseFont.heading(14, weight: .semibold)).foregroundStyle(TaliseColor.fg)
            }
        }
    }

    private var tpSlField: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $tpOn) {
                Text("Take profit / Stop loss").font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
            }
            .tint(TaliseColor.accent)
            .onChange(of: tpOn) { _, on in
                if on, price > 0 {
                    tp = String(format: "%.4f", price * (isLong ? 1.1 : 0.9))
                    sl = String(format: "%.4f", price * (isLong ? 0.95 : 1.05))
                }
            }
            if tpOn {
                HStack(spacing: 10) {
                    field("TP price", text: $tp, color: TradeColor.long)
                    field("SL price", text: $sl, color: TradeColor.short)
                }
            }
        }
    }

    private func field(_ label: String, text: Binding<String>, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(TaliseFont.mono(9)).kerning(0.4).foregroundStyle(TaliseColor.fgDim)
            TextField("0", text: text).keyboardType(.decimalPad)
                .font(TaliseFont.heading(15, weight: .semibold)).foregroundStyle(color)
                .padding(.horizontal, 12).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 11).fill(TaliseColor.surface2))
        }
    }

    private var summary: some View {
        VStack(spacing: 8) {
            row("Accept price", "$\(TradeFormat.price(acceptPrice))")
            row("Est. liq. price", liqPrice > 0 ? "$\(TradeFormat.price(liqPrice))" : "—")
            row("Trading fee", String(format: "$%.4f", feeUsd))
        }
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(TaliseFont.body(12)).foregroundStyle(TaliseColor.fgDim)
            Spacer()
            Text(v).font(TaliseFont.body(12, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
        }
    }

    private var accountPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Trading account").font(TaliseFont.heading(14, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                Spacer()
                Text(String(format: "$%.2f", svc.availableUsd))
                    .font(TaliseFont.heading(14, weight: .semibold)).foregroundStyle(TaliseColor.accent)
            }
            HStack(spacing: 10) {
                amountField("$", text: $depositText)
                Button { run { try await svc.deposit(usd: Double(depositText) ?? 0); onBanner("Deposit settled") } } label: {
                    label("Deposit", filled: true, busy: svc.busy == "deposit")
                }.buttonStyle(.plain)
            }
            HStack(spacing: 10) {
                amountField("$", text: $withdrawText)
                Button { run { try await svc.withdraw(usd: Double(withdrawText) ?? 0); onBanner("Withdrawal settled") } } label: {
                    label("Withdraw", filled: false, busy: svc.busy == "withdraw")
                }
                .buttonStyle(.plain)
                .disabled(svc.accountId == nil)
                .opacity(svc.accountId == nil ? 0.4 : 1)
            }
            Text("Collateral is USDsui. Gas is sponsored — you never pay a network fee.")
                .font(TaliseFont.body(11)).foregroundStyle(TaliseColor.fgDim)
        }
    }

    private func amountField(_ prefix: String, text: Binding<String>) -> some View {
        HStack(spacing: 2) {
            Text(prefix).foregroundStyle(TaliseColor.fgDim)
            TextField("0", text: text).keyboardType(.decimalPad).foregroundStyle(TaliseColor.fg)
        }
        .font(TaliseFont.heading(15, weight: .medium))
        .padding(.horizontal, 12).frame(height: 44)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 11).fill(TaliseColor.surface2))
    }

    private func label(_ t: String, filled: Bool, busy: Bool) -> some View {
        Group {
            if busy { ProgressView().tint(filled ? Color(hex: 0x0A130A) : TaliseColor.fg) }
            else { Text(t).font(TaliseFont.heading(14, weight: .semibold)) }
        }
        .foregroundStyle(filled ? Color(hex: 0x0A130A) : TaliseColor.fg)
        .frame(width: 104, height: 44)
        .background(RoundedRectangle(cornerRadius: 11)
            .fill(filled ? TaliseColor.greenMint : TaliseColor.surface2))
    }

    private func errorLine(_ e: String) -> some View {
        Text(e).font(TaliseFont.body(12)).foregroundStyle(TradeColor.short)
    }

    private var placeBar: some View {
        Button {
            run {
                let o = TradeService.OrderInput(
                    isLong: isLong, sizeTokens: sizeTokens, collateralUsd: marginUsd,
                    acceptablePriceUsd: acceptPrice,
                    tpPriceUsd: tpOn ? Double(tp) : nil, slPriceUsd: tpOn ? Double(sl) : nil)
                try await svc.placeOrder(o)
                onBanner("\(isLong ? "Long" : "Short") \(sym) opened")
                dismiss()
            }
        } label: {
            Group {
                if svc.busy == "order" { ProgressView().tint(Color(hex: 0x0A130A)) }
                else {
                    Text(svc.availableUsd < marginUsd - 0.001 && marginUsd > 0
                         ? "Deposit to trade"
                         : "\(isLong ? "Long" : "Short") \(sym) · \(Int(leverage))x")
                        .font(TaliseFont.heading(16, weight: .semibold))
                }
            }
            .foregroundStyle(Color(hex: 0x0A130A))
            .frame(maxWidth: .infinity).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 16).fill(isLong ? TradeColor.long : TradeColor.short))
            .opacity(canPlace ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!canPlace)
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 12)
        .background(TaliseColor.surface)
    }

    // Shared write runner: clears error, maps session-expiry to a clean sign-out.
    private func run(_ op: @escaping () async throws -> Void) {
        err = nil
        Task {
            do { try await op() }
            catch ZkLoginCoordinator.SessionError.rebindRequired {
                err = "Sign in again — your session needs a refresh."
                session.signOut()
            } catch {
                err = APIError.honestMoneyError(error, fallback: "Couldn't complete that. Try again.")
            }
        }
    }
}

// MARK: - Position row

struct PositionRow: View {
    let p: PerpPosition
    @Bindable var svc: TradeService
    let onResult: (TradeResult) -> Void
    let onBanner: (String) -> Void
    @State private var closing = false

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                MarketLogo(ticker: p.ticker, size: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(TradeMeta.sym(p.ticker)).font(TaliseFont.heading(14, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                    HStack(spacing: 6) {
                        Text(p.isLong ? "LONG" : "SHORT")
                            .font(TaliseFont.mono(9, weight: .regular)).kerning(0.4)
                            .foregroundStyle(p.isLong ? TradeColor.long : TradeColor.short)
                        Text("\(Int(p.leverage))x").font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(TradeFormat.signedUsd(p.pnlUsd))
                        .font(TaliseFont.heading(15, weight: .semibold))
                        .foregroundStyle(p.pnlUsd >= 0 ? TradeColor.long : TradeColor.short)
                    Text(TradeFormat.signedPct(p.pnlPct))
                        .font(TaliseFont.body(11)).foregroundStyle(TaliseColor.fgDim)
                }
            }
            HStack(spacing: 0) {
                metric("Size", TradeFormat.compact(p.sizeTokens))
                metric("Entry", "$\(TradeFormat.price(p.entryPriceUsd))")
                metric("Mark", "$\(TradeFormat.price(p.markPriceUsd))")
                metric("Liq", p.liqPriceUsd > 0 ? "$\(TradeFormat.price(p.liqPriceUsd))" : "—")
            }
            Button {
                closing = true
                Task {
                    do {
                        let pnl = try await svc.close(p)
                        onResult(TradeResult(sym: TradeMeta.sym(p.ticker), isLong: p.isLong,
                                             leverage: p.leverage, entryPriceUsd: p.entryPriceUsd,
                                             markPriceUsd: p.markPriceUsd, pnlUsd: pnl, pnlPct: p.pnlPct))
                    } catch {
                        onBanner(APIError.honestMoneyError(error, fallback: "Couldn't close. Try again."))
                    }
                    closing = false
                }
            } label: {
                Group {
                    if closing { ProgressView().tint(TaliseColor.fg) }
                    else { Text("Close position").font(TaliseFont.heading(13, weight: .semibold)) }
                }
                .foregroundStyle(TaliseColor.fg)
                .frame(maxWidth: .infinity).frame(height: 42)
                .background(RoundedRectangle(cornerRadius: 12).fill(TaliseColor.surface2))
            }
            .buttonStyle(.plain)
            .disabled(closing)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16).fill(TaliseColor.surface))
    }

    private func metric(_ k: String, _ v: String) -> some View {
        VStack(spacing: 3) {
            Text(k).font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim)
            Text(v).font(TaliseFont.body(12, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - History row

struct TradeHistoryRow: View {
    let entry: TradeLogEntry

    private var actionColor: Color {
        switch entry.type {
        case "open": return TaliseColor.fg
        case "close": return (entry.pnlUsd ?? 0) >= 0 ? TradeColor.long : TradeColor.short
        default: return TaliseColor.fgMuted
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(entry.type.capitalized).font(TaliseFont.heading(13, weight: .semibold)).foregroundStyle(actionColor)
                    if let t = entry.ticker { Text(TradeMeta.sym(t)).font(TaliseFont.body(12)).foregroundStyle(TaliseColor.fgMuted) }
                    if let s = entry.side { Text(s.uppercased()).font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim) }
                }
                Text(entry.date, format: .dateTime.month().day().hour().minute())
                    .font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.fgDim)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                if let pnl = entry.pnlUsd {
                    Text(TradeFormat.signedUsd(pnl)).font(TaliseFont.heading(13, weight: .semibold))
                        .foregroundStyle(pnl >= 0 ? TradeColor.long : TradeColor.short)
                } else if let c = entry.collateralUsd {
                    Text(String(format: "$%.2f", c)).font(TaliseFont.body(12, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
                }
                if let d = entry.digest, let url = URL(string: "https://suiscan.xyz/mainnet/tx/\(d)") {
                    Link(destination: url) {
                        Text("tx ↗").font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.accent)
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 12).fill(TaliseColor.surface))
    }
}

// MARK: - Market picker

struct MarketPickerSheet: View {
    @Bindable var svc: TradeService
    let onClose: () -> Void
    @State private var search = ""
    @State private var cat = "all"

    private let cats = ["all", "crypto", "stock", "fx", "commodity"]

    private var filtered: [PerpMarket] {
        svc.markets.filter { m in
            (cat == "all" || m.category == cat) &&
            (search.isEmpty || m.name.localizedCaseInsensitiveContains(search)
             || m.sym.localizedCaseInsensitiveContains(search)
             || m.symbol.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Markets").font(TaliseFont.heading(18, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                Spacer()
                Button { onClose() } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgMuted).frame(width: 30, height: 30)
                        .background(Circle().fill(TaliseColor.surface2))
                }.buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(TaliseColor.fgDim)
                TextField("Search markets", text: $search).foregroundStyle(TaliseColor.fg)
            }
            .font(TaliseFont.body(14))
            .padding(.horizontal, 14).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 12).fill(TaliseColor.surface2))
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(cats, id: \.self) { c in
                        let on = cat == c
                        Button { cat = c } label: {
                            Text(c.capitalized).font(TaliseFont.body(12, weight: on ? .semibold : .regular))
                                .foregroundStyle(on ? Color(hex: 0x0A130A) : TaliseColor.fgMuted)
                                .padding(.horizontal, 14).padding(.vertical, 7)
                                .background(Capsule().fill(on ? TaliseColor.accent : TaliseColor.surface2))
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.vertical, 12)

            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 4) {
                    ForEach(filtered) { m in
                        Button {
                            svc.selected = m.symbol
                            onClose()
                        } label: { marketRow(m) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 30)
            }
        }
        .background(TaliseColor.surface.ignoresSafeArea())
        .presentationDetents([.large])
    }

    private func marketRow(_ m: PerpMarket) -> some View {
        HStack(spacing: 12) {
            MarketLogo(ticker: m.symbol, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(m.sym)/USD").font(TaliseFont.heading(14, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                Text(m.name).font(TaliseFont.body(11)).foregroundStyle(TaliseColor.fgDim)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(m.refPriceUsd > 0 ? "$\(TradeFormat.price(m.refPriceUsd))" : "—")
                    .font(TaliseFont.heading(13, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                Text("\(Int(m.maxLeverage))x").font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim)
            }
            if m.symbol == svc.selected {
                Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(TaliseColor.accent)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: 12).fill(m.symbol == svc.selected ? TaliseColor.surface2 : .clear))
    }
}

// MARK: - Trade result card (clean gradient, shown full-screen after a close)

struct TradeResultCard: View {
    let result: TradeResult
    let onClose: () -> Void

    private var top: Color { result.win ? Color(hex: 0x143A1B) : Color(hex: 0x3A1414) }
    private var accent: Color { result.win ? TradeColor.long : TradeColor.short }

    var body: some View {
        ZStack {
            LinearGradient(colors: [top, TaliseColor.bg], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button { onClose() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(TaliseColor.fgMuted).frame(width: 34, height: 34)
                            .background(Circle().fill(TaliseColor.surface2))
                    }.buttonStyle(.plain)
                }
                .padding(20)
                Spacer()
                VStack(spacing: 14) {
                    Text(result.win ? "In profit" : "Closed")
                        .font(TaliseFont.mono(11, weight: .regular)).kerning(1.2).textCase(.uppercase)
                        .foregroundStyle(accent)
                    Text(TradeFormat.signedPct(result.pnlPct))
                        .font(.system(size: 62, weight: .bold, design: .rounded))
                        .foregroundStyle(accent)
                    Text(TradeFormat.signedUsd(result.pnlUsd))
                        .font(TaliseFont.heading(22, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                    HStack(spacing: 8) {
                        Text("\(result.isLong ? "LONG" : "SHORT") \(result.sym)")
                        Text("·")
                        Text("\(Int(result.leverage))x")
                    }
                    .font(TaliseFont.body(13, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
                    HStack(spacing: 26) {
                        stat("Entry", "$\(TradeFormat.price(result.entryPriceUsd))")
                        stat("Exit", "$\(TradeFormat.price(result.markPriceUsd))")
                    }
                    .padding(.top, 6)
                }
                Spacer()
                Button { onClose() } label: {
                    Text("Done").font(TaliseFont.heading(16, weight: .semibold))
                        .foregroundStyle(Color(hex: 0x0A130A))
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .background(RoundedRectangle(cornerRadius: 16).fill(TaliseColor.greenMint))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 24).padding(.bottom, 30)
            }
        }
    }

    private func stat(_ k: String, _ v: String) -> some View {
        VStack(spacing: 4) {
            Text(k).font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim)
            Text(v).font(TaliseFont.heading(15, weight: .semibold)).foregroundStyle(TaliseColor.fg)
        }
    }
}

// MARK: - Ticker → display symbol (no dependency on the web asset map)

enum TradeMeta {
    static func sym(_ ticker: String) -> String {
        var t = ticker.uppercased()
        for suffix in ["USDT", "USD"] where t.hasSuffix(suffix) && t.count > suffix.count {
            t = String(t.dropLast(suffix.count)); break
        }
        return t.hasSuffix("X") && t.count > 1 ? String(t.dropLast()) : t
    }
}
