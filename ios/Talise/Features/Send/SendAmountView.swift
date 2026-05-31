import SwiftUI

/// Step 1: enter an amount in the user's display currency. Big centered
/// amount, secondary USDsui-equivalent line, "MAIN WALLET" pill, custom
/// numpad. No keyboard.
struct SendAmountView: View {
    @Bindable var draft: SendDraft
    var onNext: () -> Void
    var onCancel: () -> Void

    @State private var balance: BalancesDTO?

    var body: some View {
        VStack(spacing: 0) {
            header

            Spacer(minLength: 12)

            amountBlock

            Spacer(minLength: 12)

            walletPill
                .padding(.bottom, 18)

            SendNumpad(input: $draft.rawAmount)
                .padding(.horizontal, 24)
                .padding(.bottom, 12)

            reviewButton
                .padding(.horizontal, 24)
                .padding(.bottom, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { Task { await loadBalance() } }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(TaliseColor.surfaceGlass))
            }
            Spacer()
            MicroLabel(text: "Send", color: TaliseColor.fgDim).kerning(1.5)
            Spacer()
            Color.clear.frame(width: 36, height: 36)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    // MARK: - Amount

    private var amountBlock: some View {
        VStack(spacing: 10) {
            // Symbol + number at the SAME font size so the cap-tops
            // and baselines naturally line up. Visual hierarchy comes
            // from weight (.thin symbol vs .medium number) + color
            // (fgMuted vs fg), not from a size delta — that's what
            // produced the misaligned "tiny ₦ next to giant 0" look.
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(draft.currency.symbol)
                    .font(TaliseFont.heading(72, weight: .thin))
                    .foregroundStyle(TaliseColor.fgMuted)
                Text(displayAmount)
                    .font(TaliseFont.heading(72, weight: .medium))
                    .kerning(-2)
                    .foregroundStyle(TaliseColor.fg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    // Smooth digit + comma transitions as the user
                    // types past thousands boundaries. SwiftUI's
                    // numericText transition crossfades the
                    // appearing/disappearing glyphs in place, so the
                    // comma slides in cleanly when "999" → "1,000".
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.18), value: displayAmount)
            }

            Text(usdsuiSecondary)
                .font(TaliseFont.mono(13, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .contentTransition(.numericText())
                .animation(.snappy(duration: 0.18), value: usdsuiSecondary)

            // Cross-border only: show what the recipient actually
            // receives in *their* currency. Hidden for same-currency
            // sends (recipientReceiveLine == nil) so the single-currency
            // layout is untouched.
            if let recipientLine = recipientReceiveLine {
                HStack(spacing: 5) {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(TaliseColor.accent)
                    Text(recipientLine)
                        .font(TaliseFont.mono(12, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .contentTransition(.numericText())
                }
                .padding(.top, 1)
                .animation(.snappy(duration: 0.18), value: recipientLine)
            }

            if exceedsBalance {
                MicroLabel(
                    text: "OVER AVAILABLE BALANCE",
                    color: TaliseColor.danger
                )
                .kerning(1.5)
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 24)
    }

    /// What we render inside the big number. Formats the integer part
    /// with thousand-separator commas while preserving the raw decimal
    /// the user has typed — so mid-typing states like "12." stay as
    /// "12." (with the dangling dot) and "1234.5" reads "1,234.5".
    private var displayAmount: String {
        let raw = draft.rawAmount
        if raw.isEmpty { return "0" }
        // Locate the decimal point (if any) and group only the digits
        // to its LEFT. The right side is purely user-controlled — we
        // never reformat what they've typed past the dot.
        if let dotIdx = raw.firstIndex(of: ".") {
            let intPart = String(raw[raw.startIndex..<dotIdx])
            let fracPart = String(raw[raw.index(after: dotIdx)...])
            return "\(groupDigits(intPart)).\(fracPart)"
        }
        return groupDigits(raw)
    }

    /// Insert thousands-separator commas into a pure-digit integer
    /// string. Returns the input unchanged for strings ≤ 3 chars or
    /// for any string containing non-digits (defensive — the input
    /// here is the user's typed amount, but bracket against surprises).
    private func groupDigits(_ s: String) -> String {
        guard s.count > 3, s.allSatisfy({ $0.isNumber }) else { return s }
        var out = ""
        for (i, ch) in s.reversed().enumerated() {
            if i > 0 && i % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return String(out.reversed())
    }

    /// USDsui equivalent of what's typed, formatted as "1,234.56 USDsui".
    /// Shows "0.00 USDsui" before the user enters anything so the layout
    /// doesn't shift on the first keypress.
    private var usdsuiSecondary: String {
        let amt = typedAmountUsdsui
        let fmt = NumberFormatter()
        fmt.numberStyle = .decimal
        fmt.minimumFractionDigits = 2
        fmt.maximumFractionDigits = 2
        let body = fmt.string(from: NSNumber(value: amt)) ?? "0.00"
        return "\(body) USDsui"
    }

    private var typedAmountUsdsui: Double {
        guard let typed = Double(draft.rawAmount), typed > 0 else { return 0 }
        let rate = CurrencySettings.shared.rates[draft.currency.code] ?? 1
        guard rate > 0 else { return 0 }
        return typed / rate
    }

    /// "Recipient gets ¥15,000" line — present only for cross-border
    /// sends (different recipient currency). Returns nil for same-
    /// currency sends so the secondary block collapses to the existing
    /// single line. Mirrors the post-spread receive figure shown on the
    /// locked-quote block in Review.
    private var recipientReceiveLine: String? {
        guard let recv = draft.liveRecipientReceiveLocal() else { return nil }
        let amount = TaliseCurrency.recipientSymbolic(recv.amount, currency: recv.currency)
        return "Recipient gets \(amount)"
    }

    private var exceedsBalance: Bool {
        guard let have = balance?.usdsui else { return false }
        let amt = typedAmountUsdsui
        return amt > 0 && amt > have
    }

    // MARK: - Wallet pill

    private var walletPill: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(TaliseColor.accent)
                .frame(width: 6, height: 6)
            Text("MAIN WALLET")
                .font(TaliseFont.mono(10, weight: .light))
                .kerning(1.5)
                .foregroundStyle(TaliseColor.fg)
            if let avail = availableLocal {
                Text("·")
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                Text(avail)
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Capsule().fill(TaliseColor.surfaceGlass))
        .overlay(
            Capsule().stroke(TaliseColor.line, lineWidth: 0.5)
        )
    }

    private var availableLocal: String? {
        guard let usdsui = balance?.usdsui else { return nil }
        return TaliseFormat.local2(usdsui)
    }

    // MARK: - Review button

    private var reviewButton: some View {
        Button(action: handleNext) {
            Text("Review")
                .font(TaliseFont.heading(16, weight: .medium))
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(canAdvance ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
                .clipShape(Capsule())
        }
        .disabled(!canAdvance)
    }

    private var canAdvance: Bool {
        typedAmountUsdsui > 0 && !exceedsBalance
    }

    private func handleNext() {
        guard canAdvance else { return }
        draft.amountUsdsui = typedAmountUsdsui
        onNext()
    }

    // MARK: - Balance

    private func loadBalance() async {
        do {
            balance = try await APIClient.shared.get("/api/balances")
        } catch {
            balance = nil
        }
    }
}
