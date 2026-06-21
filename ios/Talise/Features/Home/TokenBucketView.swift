import SwiftUI

/// The token bucket: every token the user holds BESIDES USDsui, with its
/// amount, a Send action, and a Swap-to-USDsui action (the successor to the
/// archived auto-swap). Opened from the home card carousel.
struct TokenBucketView: View {
    /// Snapshot of the non-USDsui coins at open time.
    let coinsInput: [WalletCoinBalance]
    /// Best-effort symbol from the coin type (provided by Home).
    let symbolFor: (WalletCoinBalance) -> String
    /// Convert one coin to USDsui. Returns true on success.
    let onSwap: (WalletCoinBalance) async -> Bool
    /// Open the send flow.
    let onSend: () -> Void
    /// Dismiss the bucket.
    let onDone: () -> Void

    init(
        coins: [WalletCoinBalance],
        symbolFor: @escaping (WalletCoinBalance) -> String,
        onSwap: @escaping (WalletCoinBalance) async -> Bool,
        onSend: @escaping () -> Void,
        onDone: @escaping () -> Void
    ) {
        self.coinsInput = coins
        self.symbolFor = symbolFor
        self.onSwap = onSwap
        self.onSend = onSend
        self.onDone = onDone
        _coins = State(initialValue: coins)
    }

    @State private var coins: [WalletCoinBalance]
    @State private var swappingType: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            if coins.isEmpty {
                emptyState
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 12) {
                        ForEach(coins, id: \.coinType) { coin in
                            coinCard(coin)
                        }
                        Color.clear.frame(height: 24)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                }
            }
        }
        .taliseScreenBackground()
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button { onDone() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(width: 38, height: 38)
                    .glassCircle()
            }
            Spacer()
            HStack(spacing: 6) {
                Image(systemName: "circle.hexagongrid.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(TaliseColor.greenMint)
                MicroLabel(text: "Token bucket", color: TaliseColor.fgMuted)
                    .kerning(2.0)
            }
            Spacer()
            Color.clear.frame(width: 38, height: 38)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "circle.hexagongrid")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            Text("No other tokens yet")
                .font(TaliseFont.heading(19, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
            Text("Tokens you hold besides USDsui will show up here. You can swap any of them to USDsui in one tap.")
                .font(TaliseFont.body(14))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
            Spacer()
        }
    }

    // MARK: - Coin card

    private func coinCard(_ coin: WalletCoinBalance) -> some View {
        let symbol = symbolFor(coin)
        let busy = swappingType == coin.coinType
        return VStack(spacing: 16) {
            HStack(spacing: 13) {
                ZStack {
                    Circle().fill(TaliseColor.surface2)
                    Text(String(symbol.prefix(1)))
                        .font(TaliseFont.heading(17, weight: .semibold))
                        .foregroundStyle(TaliseColor.greenMint)
                }
                .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text(symbol)
                        .font(TaliseFont.heading(17, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    Text("\(amountText(coin)) \(symbol)")
                        .font(TaliseFont.body(13))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
                Spacer()
            }
            HStack(spacing: 10) {
                Button { onSend() } label: {
                    actionLabel("Send", filled: false)
                }
                .buttonStyle(LiquidGlassPressStyle())
                .disabled(busy)

                Button {
                    Task {
                        swappingType = coin.coinType
                        let ok = await onSwap(coin)
                        swappingType = nil
                        if ok {
                            withAnimation { coins.removeAll { $0.coinType == coin.coinType } }
                        }
                    }
                } label: {
                    if busy {
                        HStack(spacing: 7) {
                            ProgressView().tint(TaliseColor.bg)
                            Text("Swapping…")
                        }
                        .font(TaliseFont.body(15, weight: .semibold))
                        .foregroundStyle(TaliseColor.bg)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14).fill(TaliseColor.greenMint))
                    } else {
                        actionLabel("Swap to USDsui", filled: true)
                    }
                }
                .buttonStyle(LiquidGlassPressStyle())
                .disabled(busy)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(TaliseColor.surface))
    }

    private func actionLabel(_ t: String, filled: Bool) -> some View {
        Text(t)
            .font(TaliseFont.body(15, weight: .semibold))
            .foregroundStyle(filled ? TaliseColor.bg : TaliseColor.fg)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(filled ? TaliseColor.greenMint : TaliseColor.fg.opacity(0.08))
            )
    }

    // MARK: - Formatting

    /// Decimals for the verified coin set (the only coins shown). Defaults to 9.
    private func decimals(for coinType: String) -> Int {
        let t = coinType.lowercased()
        if t.contains("::usdc::") { return 6 }
        if t.contains("::deep::") { return 6 }
        if t.contains("::usdsui::") { return 6 }
        if t.contains("::cetus::") { return 9 }
        if t.contains("::sui::sui") { return 9 }
        return 9
    }

    private func amountText(_ b: WalletCoinBalance) -> String {
        let v = (Double(b.amount) ?? 0) / pow(10, Double(decimals(for: b.coinType)))
        let nf = NumberFormatter()
        nf.numberStyle = .decimal
        nf.maximumFractionDigits = 4
        nf.minimumFractionDigits = 0
        return nf.string(from: NSNumber(value: v)) ?? "\(v)"
    }
}
