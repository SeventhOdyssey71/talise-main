import SwiftUI
import UIKit

// MARK: - Shareable PnL card (rendered to an image you can share or copy)

struct PnLResult: Identifiable {
    let id = UUID()
    let ticker: String
    let sym: String
    let isLong: Bool
    let leverage: Double
    let entryPriceUsd: Double
    let exitPriceUsd: Double
    let pnlUsd: Double
    let pnlPct: Double
    var win: Bool { pnlUsd >= 0 }
}

/// Full-screen PnL result on close: a clean branded card you can share or copy
/// as an image. The card art is rendered off-screen (logo pre-fetched) so the
/// shared image matches exactly what's on screen.
struct PnLShareCard: View {
    let result: PnLResult
    let onClose: () -> Void

    @State private var logo: UIImage?
    @State private var rendered: UIImage?
    @State private var copied = false

    private var accent: Color { result.win ? TradeColor.long : TradeColor.short }

    var body: some View {
        ZStack {
            LinearGradient(colors: [accent.opacity(0.22), TaliseColor.bg, TaliseColor.bg],
                           startPoint: .top, endPoint: .bottom)
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
                ShareablePnLCard(result: result, logo: logo)
                    .frame(width: 320)
                    .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .shadow(color: .black.opacity(0.5), radius: 30, y: 14)
                Spacer()
                actions.padding(.horizontal, 22).padding(.bottom, 28)
            }
        }
        .task { await prepare() }
    }

    private var actions: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                shareButton
                Button {
                    if let img = rendered { UIPasteboard.general.image = img; copied = true }
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 14, weight: .medium))
                        Text(copied ? "Copied" : "Copy").font(TaliseFont.heading(15, weight: .medium))
                    }
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity).frame(height: 52)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(TaliseColor.surface2))
                }
                .buttonStyle(.plain)
                .disabled(rendered == nil)
            }
            Button { onClose() } label: {
                Text("Done").font(TaliseFont.heading(15, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
                    .frame(maxWidth: .infinity).frame(height: 44)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private var shareButton: some View {
        if let img = rendered {
            ShareLink(item: Image(uiImage: img),
                      preview: SharePreview("Talise · \(result.sym) trade", image: Image(uiImage: img))) {
                HStack(spacing: 7) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 14, weight: .semibold))
                    Text("Share").font(TaliseFont.heading(15, weight: .semibold))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity).frame(height: 52)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(TaliseColor.accent))
            }
            .buttonStyle(.plain)
        } else {
            HStack { ProgressView().tint(TaliseColor.bg) }
                .frame(maxWidth: .infinity).frame(height: 52)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(TaliseColor.accent.opacity(0.5)))
        }
    }

    private func prepare() async {
        // Pre-fetch the market logo so the rendered image includes it.
        if let url = URL(string: AppConfig.shared.apiBaseURL + "/api/asset-icon/\(result.ticker.uppercased())"),
           let (data, _) = try? await URLSession.shared.data(from: url),
           let img = UIImage(data: data) {
            logo = img
        }
        await MainActor.run { render() }
    }

    @MainActor private func render() {
        let renderer = ImageRenderer(content: ShareablePnLCard(result: result, logo: logo).frame(width: 360))
        renderer.scale = max(UIScreen.main.scale, 3)
        rendered = renderer.uiImage
    }
}

/// The branded PnL card itself — used both on screen and by the renderer.
struct ShareablePnLCard: View {
    let result: PnLResult
    let logo: UIImage?

    private var accent: Color { result.win ? TradeColor.long : TradeColor.short }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("talise").font(TaliseFont.heading(17, weight: .bold)).foregroundStyle(TaliseColor.fg)
                Text("PERPS").font(TaliseFont.mono(9, weight: .regular)).tracking(1.5)
                    .foregroundStyle(accent)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Capsule().fill(accent.opacity(0.16)))
                Spacer()
            }
            .padding(.bottom, 22)

            HStack(spacing: 10) {
                Group {
                    if let logo { Image(uiImage: logo).resizable().scaledToFill() }
                    else { Circle().fill(TaliseColor.surface2).overlay(Text(String(result.sym.prefix(2))).font(TaliseFont.heading(12, weight: .semibold)).foregroundStyle(TaliseColor.fgMuted)) }
                }
                .frame(width: 30, height: 30).background(Color.white).clipShape(Circle())
                Text("\(result.sym)/USD").font(TaliseFont.heading(16, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                Text("\(result.isLong ? "LONG" : "SHORT") \(Int(result.leverage))x")
                    .font(TaliseFont.mono(9, weight: .regular)).tracking(0.5)
                    .foregroundStyle(result.isLong ? TradeColor.long : TradeColor.short)
            }
            .padding(.bottom, 14)

            Text("\(result.pnlPct >= 0 ? "+" : "")\(String(format: "%.2f", result.pnlPct))%")
                .font(TaliseFont.display(52, weight: .bold)).kerning(-1)
                .foregroundStyle(accent)
            Text("\(result.win ? "+" : "-")$\(String(format: "%.2f", abs(result.pnlUsd)))")
                .font(TaliseFont.heading(19, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                .padding(.bottom, 20)

            HStack(spacing: 28) {
                stat("Entry", "$\(TradeFormat.price(result.entryPriceUsd))")
                stat("Exit", "$\(TradeFormat.price(result.exitPriceUsd))")
            }
            .padding(.bottom, 18)

            Text("talise.io · gasless perps on Sui")
                .font(TaliseFont.mono(9, weight: .regular)).foregroundStyle(TaliseColor.fgDim)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ZStack {
                TaliseColor.surface
                LinearGradient(colors: [accent.opacity(0.18), .clear], startPoint: .top, endPoint: .center)
            }
        )
    }

    private func stat(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(k).font(TaliseFont.mono(9, weight: .regular)).foregroundStyle(TaliseColor.fgDim)
            Text(v).font(TaliseFont.heading(15, weight: .semibold)).foregroundStyle(TaliseColor.fg)
        }
    }
}

// MARK: - Target pop (confirmation that scales in on open / close)

struct TargetPopData: Identifiable, Equatable {
    let id = UUID()
    let title: String       // "Long SUI" / "Closed SUI"
    let subtitle: String    // "Position opened" / "+$1.20"
    let win: Bool
}

/// A crisp target/scope icon that scales + fades in center-screen to confirm a
/// trade opened or closed, then auto-dismisses. Clean, quick, no heavy card.
struct TargetPop: View {
    let data: TargetPopData
    @State private var shown = false

    private var accent: Color { data.win ? TradeColor.long : TradeColor.short }

    var body: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle().fill(accent.opacity(0.16)).frame(width: 108, height: 108)
                Circle().strokeBorder(accent.opacity(0.5), lineWidth: 1.5).frame(width: 108, height: 108)
                Image(systemName: "scope")
                    .font(.system(size: 50, weight: .regular))
                    .foregroundStyle(accent)
                    .rotationEffect(.degrees(shown ? 0 : -35))
            }
            .scaleEffect(shown ? 1 : 0.6)
            VStack(spacing: 4) {
                Text(data.title).font(TaliseFont.heading(18, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                Text(data.subtitle).font(TaliseFont.heading(15, weight: .semibold)).foregroundStyle(accent)
            }
            .opacity(shown ? 1 : 0)
        }
        .padding(28)
        .background(RoundedRectangle(cornerRadius: 28).fill(TaliseColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 28).strokeBorder(TaliseColor.line, lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 30, y: 12)
        .scaleEffect(shown ? 1 : 0.9)
        .opacity(shown ? 1 : 0)
        .onAppear {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.68)) { shown = true }
        }
    }
}

// MARK: - Order sheet (Long / Short ticket + account funding)

struct OrderSheet: View {
    @Bindable var svc: TradeService
    let session: AppSession
    let initialLong: Bool
    let onPop: (TargetPopData) -> Void
    let onBanner: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var isLong = true
    @State private var leverage: Double = 10
    @State private var amountUsd: Double = 0     // USDsui collateral the user puts up
    @State private var tpSlOn = false
    @State private var tpPct: Double = 10
    @State private var slPct: Double = 5
    @State private var acct: AcctMode = .none
    @State private var acctAmount = ""
    @State private var err: String?

    enum AcctMode { case none, deposit, withdraw }

    private var market: PerpMarket? { svc.market }
    private var price: Double { svc.price }
    private var sym: String { market?.sym ?? svc.selected }
    private var maxLev: Double { max(1, market?.maxLeverage ?? 25) }

    // The amount IS the collateral/margin. Size (tokens) + notional are derived,
    // so the user never thinks about token amounts.
    private var marginUsd: Double { amountUsd }
    private var notionalUsd: Double { amountUsd * leverage }
    private var sizeTokens: Double { price > 0 ? notionalUsd / price : 0 }

    /// WaterX minimum collateral, rounded up to a clean 0.1 with a safety
    /// cushion (e.g. 3.04 → 3.10) so an order is never rejected for being a hair
    /// under the on-chain minimum.
    private var minMargin: Double {
        let raw = market?.minCollUsd ?? 0
        let base = raw > 0 ? raw : 1.0
        var m = (base * 10).rounded(.up) / 10
        if m <= base + 0.001 { m += 0.1 }
        return m
    }
    /// Most collateral the user can post: what they've deposited, capped by the
    /// market's open-interest headroom.
    private var maxAmount: Double {
        let avail = svc.availableUsd
        guard price > 0, leverage > 0 else { return avail }
        let headroom = (isLong ? (market?.availLongSize ?? 0) : (market?.availShortSize ?? 0)) * price / leverage
        return max(0, min(avail, headroom > 0 ? headroom : avail))
    }

    private var acceptPrice: Double { price * (isLong ? 1.005 : 0.995) }
    private var liqPrice: Double {
        guard leverage > 0 else { return 0 }
        return isLong ? price * (1 - 1 / leverage) : price * (1 + 1 / leverage)
    }
    private var feeUsd: Double { notionalUsd * (market?.tradingFeeBps ?? 0) / 10_000 }
    private var tpPrice: Double { isLong ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100) }
    private var slPrice: Double { isLong ? price * (1 - slPct / 100) : price * (1 + slPct / 100) }
    private var canPlace: Bool {
        amountUsd >= minMargin && amountUsd <= svc.availableUsd + 0.001
            && amountUsd <= maxAmount + 0.01 && sizeTokens > 0 && svc.busy == nil
    }
    private var sideColor: Color { isLong ? TradeColor.long : TradeColor.short }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    marketHeader
                    sideToggle
                    leverageField
                    sizeField
                    tpSlField
                    summaryCard
                    accountSection
                    if let err {
                        Text(err).font(TaliseFont.body(12, weight: .light)).foregroundStyle(TaliseColor.danger)
                    }
                    Spacer(minLength: 8)
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)
            }
            placeBar
        }
        .liquidGlassSheet(accent: sideColor)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear { isLong = initialLong; leverage = min(10, maxLev) }
    }

    // Compact market context so the ticket reads on its own.
    private var marketHeader: some View {
        HStack(spacing: 10) {
            MarketLogo(ticker: svc.selected, size: 32)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(sym)/USD").font(TaliseFont.heading(16, weight: .semibold)).foregroundStyle(TaliseColor.fg)
                Text(price > 0 ? "$\(TradeFormat.price(price))" : "—")
                    .font(TaliseFont.body(12)).foregroundStyle(TaliseColor.fgMuted)
            }
            Spacer()
        }
    }

    // Branded two-segment control — Long = green, Short = red, selected = ink.
    private var sideToggle: some View {
        HStack(spacing: 4) {
            sideSeg("Long", on: isLong, color: TradeColor.long) { setSide(true) }
            sideSeg("Short", on: !isLong, color: TradeColor.short) { setSide(false) }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface2))
    }

    private func setSide(_ long: Bool) {
        withAnimation(.easeOut(duration: 0.15)) { isLong = long }
    }

    private func sideSeg(_ t: String, on: Bool, color: Color, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(t)
                .font(TaliseFont.body(14, weight: on ? .semibold : .light))
                .foregroundStyle(on ? TaliseColor.bg : TaliseColor.fgMuted)
                .frame(maxWidth: .infinity).frame(height: 40)
                .background(
                    Group { if on { RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color) } }
                )
                .contentShape(Rectangle())   // whole segment tappable, not just the text
        }
        .buttonStyle(.plain)
    }

    private var leverageField: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionHeader("Leverage")
                Spacer()
                Text("\(Int(leverage))x").font(TaliseFont.heading(16, weight: .semibold)).foregroundStyle(TaliseColor.accent)
            }
            Slider(value: $leverage, in: 1...max(2, maxLev), step: 1).tint(TaliseColor.accent)
            HStack(spacing: 6) {
                ForEach(levChips, id: \.self) { l in
                    chip("\(l)x", on: Int(leverage) == l) { withAnimation(.easeOut(duration: 0.12)) { leverage = Double(l) } }
                }
            }
        }
    }

    private var levChips: [Int] {
        [2, 5, 10, 25, 50, Int(maxLev)].filter { $0 >= 1 && $0 <= Int(maxLev) }.reduced()
    }

    private var sizeField: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Amount")
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text("$").font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fgDim)
                    TextField("0.00", value: $amountUsd, format: .number)
                        .keyboardType(.decimalPad)
                        .font(TaliseFont.heading(22, weight: .medium)).kerning(-0.6)
                        .foregroundStyle(TaliseColor.fg).tint(TaliseColor.accent)
                    Spacer()
                    Text("USDsui").font(TaliseFont.mono(11, weight: .regular)).foregroundStyle(TaliseColor.fgDim)
                }
                HStack {
                    MicroLabel(text: "Min \(usd(minMargin)) · Available \(usd(svc.availableUsd))", color: TaliseColor.fgDim)
                    Spacer()
                    LiquidGlassPill(title: "MAX", tint: TaliseColor.accent, compact: true) { amountUsd = maxAmount }
                }
            }
            .padding(16).earnFieldGlass()
            HStack {
                MicroLabel(text: "Buying power · \(Int(leverage))x", color: TaliseColor.fgDim)
                Spacer()
                Text(usd(notionalUsd)).font(TaliseFont.heading(14, weight: .semibold)).foregroundStyle(TaliseColor.fg)
            }
        }
    }

    // Percentage-based TP/SL — quick % presets with the resulting price shown.
    private var tpSlField: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $tpSlOn.animation(.easeOut(duration: 0.15))) {
                SectionHeader("Take profit / Stop loss")
            }
            .tint(TaliseColor.accent)
            if tpSlOn {
                TpSlRow(title: "Take profit", pct: $tpPct, entryPrice: price,
                        isProfit: true, isLong: isLong, color: TradeColor.long)
                TpSlRow(title: "Stop loss", pct: $slPct, entryPrice: price,
                        isProfit: false, isLong: isLong, color: TradeColor.short)
            }
        }
    }

    private var summaryCard: some View {
        VStack(spacing: 10) {
            sRow("Accept price", "$\(TradeFormat.price(acceptPrice))")
            sRow("Est. liq. price", liqPrice > 0 ? "$\(TradeFormat.price(liqPrice))" : "—")
            sRow("Trading fee", String(format: "$%.4f", feeUsd))
        }
        .padding(16).earnFieldGlass()
    }

    private func sRow(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(TaliseFont.body(12)).foregroundStyle(TaliseColor.fgDim)
            Spacer()
            Text(v).font(TaliseFont.body(12, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
        }
    }

    // Account: Deposit / Withdraw buttons that reveal an amount card on tap.
    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeader("Trading account")
                Spacer()
                Text(usd(svc.availableUsd)).font(TaliseFont.heading(15, weight: .semibold)).foregroundStyle(TaliseColor.accent)
            }
            if acct == .none {
                HStack(spacing: 10) {
                    TaliseButton(title: "Deposit", variant: .secondary, size: .md) {
                        acctAmount = ""; withAnimation(.easeOut(duration: 0.15)) { acct = .deposit }
                    }
                    TaliseButton(title: "Withdraw", variant: .secondary, size: .md) {
                        acctAmount = ""; withAnimation(.easeOut(duration: 0.15)) { acct = .withdraw }
                    }
                    .opacity(svc.accountId == nil ? 0.4 : 1)
                    .disabled(svc.accountId == nil)
                }
            } else {
                acctAmountCard
            }
            MicroLabel(text: "Collateral is USDsui · gas is sponsored", color: TaliseColor.fgDim)
        }
    }

    private var acctAmountCard: some View {
        let isDep = acct == .deposit
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Text("$").font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fgDim)
                    TextField("0.00", text: $acctAmount)
                        .keyboardType(.decimalPad)
                        .font(TaliseFont.heading(22, weight: .medium)).kerning(-0.6)
                        .foregroundStyle(TaliseColor.fg).tint(TaliseColor.accent)
                    Spacer()
                    Text("USDsui").font(TaliseFont.mono(11, weight: .regular)).foregroundStyle(TaliseColor.fgDim)
                }
                HStack {
                    MicroLabel(text: isDep ? "From your Talise balance" : "Available \(usd(svc.availableUsd))",
                               color: TaliseColor.fgDim)
                    Spacer()
                    if !isDep {
                        LiquidGlassPill(title: "MAX", tint: TaliseColor.accent, compact: true) {
                            acctAmount = String(format: "%.2f", svc.availableUsd)
                        }
                    }
                }
            }
            .padding(16).earnFieldGlass()
            HStack(spacing: 10) {
                TaliseButton(title: "Cancel", variant: .ghost, size: .md) {
                    withAnimation(.easeOut(duration: 0.15)) { acct = .none }
                }
                TaliseButton(title: isDep ? "Deposit" : "Withdraw", variant: .primary, size: .md,
                             loading: svc.busy == "deposit" || svc.busy == "withdraw") {
                    let amt = Double(acctAmount) ?? 0
                    run {
                        if isDep { try await svc.deposit(usd: amt); onBanner("Deposit settled") }
                        else { try await svc.withdraw(usd: amt); onBanner("Withdrawal settled") }
                        withAnimation(.easeOut(duration: 0.15)) { acct = .none }
                    }
                }
                .disabled((Double(acctAmount) ?? 0) <= 0 || svc.busy != nil)
            }
        }
    }

    private var placeBar: some View {
        Button {
            run {
                let o = TradeService.OrderInput(
                    isLong: isLong, sizeTokens: sizeTokens, collateralUsd: marginUsd,
                    acceptablePriceUsd: acceptPrice,
                    tpPriceUsd: tpSlOn ? tpPrice : nil, slPriceUsd: tpSlOn ? slPrice : nil)
                try await svc.placeOrder(o)
                dismiss()
                onPop(TargetPopData(title: "\(isLong ? "Long" : "Short") \(sym)",
                                    subtitle: "Position opened", win: true))
            }
        } label: {
            Group {
                if svc.busy == "order" { ProgressView().tint(TaliseColor.bg) }
                else {
                    Text(placeLabel).font(TaliseFont.heading(16, weight: .semibold))
                }
            }
            .foregroundStyle(TaliseColor.bg)
            .frame(maxWidth: .infinity).frame(height: 52)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(sideColor))
            .opacity(canPlace ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!canPlace)
        .padding(.horizontal, 22).padding(.top, 10).padding(.bottom, 14)
    }

    private var placeLabel: String {
        if amountUsd > svc.availableUsd + 0.001 { return "Deposit to trade" }
        if amountUsd > 0 && amountUsd < minMargin { return "Min \(usd(minMargin)) to trade" }
        return "\(isLong ? "Long" : "Short") \(sym) · \(Int(leverage))x"
    }

    // MARK: - Shared bits

    private func usd(_ v: Double) -> String { String(format: "$%.2f", v) }

    private func chip(_ t: String, on: Bool, color: Color = TaliseColor.accent, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(t)
                .font(TaliseFont.body(12, weight: on ? .semibold : .light))
                .foregroundStyle(on ? TaliseColor.bg : TaliseColor.fgMuted)
                .frame(maxWidth: .infinity).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(on ? color : TaliseColor.surface2))
        }
        .buttonStyle(.plain)
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

private extension Array where Element == Int {
    /// De-dupe while preserving order (leverage chips can collide at maxLev).
    func reduced() -> [Int] {
        var seen = Set<Int>(); return filter { seen.insert($0).inserted }
    }
}

// MARK: - TP / SL row (preset % chips + manual % or price entry)

private struct TpSlRow: View {
    let title: String
    @Binding var pct: Double
    let entryPrice: Double
    let isProfit: Bool      // take-profit vs stop-loss (direction)
    let isLong: Bool
    let color: Color

    @State private var mode: Mode = .percent
    @State private var text = ""
    enum Mode { case percent, price }

    /// Resolved target price for the current %, respecting side + TP/SL direction.
    private var targetPrice: Double {
        let sign = (isLong ? 1.0 : -1.0) * (isProfit ? 1.0 : -1.0)
        return entryPrice * (1 + sign * pct / 100)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
                Spacer()
                Text("\(pctText)% · $\(TradeFormat.price(targetPrice))")
                    .font(TaliseFont.mono(11, weight: .regular)).foregroundStyle(color)
            }
            // Manual entry: type a % or a target price (toggle the unit).
            HStack(spacing: 8) {
                TextField(mode == .percent ? "10" : "0.00", text: $text)
                    .keyboardType(.decimalPad)
                    .font(TaliseFont.heading(15, weight: .semibold))
                    .foregroundStyle(color)
                    .onChange(of: text) { _, v in apply(v) }
                Spacer()
                unitToggle
            }
            .padding(.horizontal, 12).frame(height: 42)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(TaliseColor.surface2))
            // Quick presets.
            HStack(spacing: 6) {
                ForEach([5.0, 10.0, 25.0, 50.0], id: \.self) { o in
                    presetChip("\(Int(o))%", on: pct == o) { set(pct: o) }
                }
            }
        }
        .padding(14).earnFieldGlass()
        .onAppear { syncText() }
    }

    private var pctText: String {
        pct == pct.rounded() ? String(Int(pct)) : String(format: "%.1f", pct)
    }

    private var unitToggle: some View {
        HStack(spacing: 2) {
            unitButton("%", on: mode == .percent) { mode = .percent; syncText() }
            unitButton("$", on: mode == .price) { mode = .price; syncText() }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(TaliseColor.bg))
    }

    private func unitButton(_ t: String, on: Bool, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(t).font(TaliseFont.body(12, weight: .semibold))
                .foregroundStyle(on ? TaliseColor.bg : TaliseColor.fgMuted)
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(on ? color : .clear))
        }
        .buttonStyle(.plain)
    }

    private func presetChip(_ t: String, on: Bool, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(t).font(TaliseFont.body(12, weight: on ? .semibold : .light))
                .foregroundStyle(on ? TaliseColor.bg : TaliseColor.fgMuted)
                .frame(maxWidth: .infinity).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(on ? color : TaliseColor.surface2))
        }
        .buttonStyle(.plain)
    }

    private func set(pct v: Double) {
        withAnimation(.easeOut(duration: 0.12)) { pct = v }
        syncText()
    }

    // Parse the field as a % or a target price → resolve back to a %.
    private func apply(_ v: String) {
        let d = Double(v) ?? 0
        if mode == .percent {
            pct = max(0, d)
        } else if entryPrice > 0, d > 0 {
            pct = abs(d / entryPrice - 1) * 100
        }
    }

    private func syncText() {
        text = mode == .percent ? pctText : String(format: "%.4f", targetPrice)
    }
}

// MARK: - Position row

struct PositionRow: View {
    let p: PerpPosition
    @Bindable var svc: TradeService
    let onPnL: (PnLResult) -> Void
    let onBanner: (String) -> Void
    @State private var closing = false

    private func pnlResult(_ realized: Double, exit: Double) -> PnLResult {
        PnLResult(ticker: p.ticker, sym: TradeMeta.sym(p.ticker), isLong: p.isLong,
                  leverage: p.leverage, entryPriceUsd: p.entryPriceUsd, exitPriceUsd: exit,
                  pnlUsd: realized, pnlPct: p.pnlPct)
    }

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
                // Share this position's live PnL as a card.
                Button { onPnL(pnlResult(p.pnlUsd, exit: p.markPriceUsd)) } label: {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 13, weight: .medium))
                        .foregroundStyle(TaliseColor.fgMuted).frame(width: 30, height: 30)
                        .background(Circle().fill(TaliseColor.surface2))
                }.buttonStyle(.plain)
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
                        onPnL(pnlResult(pnl, exit: p.markPriceUsd))
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
        svc.tradableMarkets.filter { m in
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
                let px = svc.priceFor(m.symbol)
                Text(px > 0 ? "$\(TradeFormat.price(px))" : "—")
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
