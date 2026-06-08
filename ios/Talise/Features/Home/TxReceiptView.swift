import SwiftUI
import UIKit

/// On-chain receipt — appears when the user taps "Details" on an
/// activity row. Mirrors the web app's receipt: amount in the user's
/// display currency, USDsui below, counterparty, timestamp, and the
/// Suiscan link to the canonical tx digest. Always the chain as the
/// source of truth.
struct TxReceiptView: View {
    let entry: ActivityEntryDTO
    @Environment(\.dismiss) private var dismiss
    @State private var digestCopied = false

    private let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                directionBadge
                amountBlock
                detailsCard
                actions
                Color.clear.frame(height: 24)
            }
            .padding(.horizontal, 24)
            .padding(.top, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .task {
            // If the FX cache is stale (cold launch with old persisted
            // rates), refresh in the background so the amount picks up
            // the right local-currency conversion the next time the
            // view re-renders.
            if CurrencySettings.shared.isStale() {
                await CurrencySettings.shared.refresh()
            }
        }
    }

    // MARK: - Direction badge

    /// Category — mirrors HistoryRow's classification so the receipt
    /// hero matches the row the user tapped. Earlier versions hardcoded
    /// `isReceived ? received : sent`, which left every invest/withdraw
    /// receipt rendering with the brick-red "Sent" badge + label.
    private enum Category {
        case sent, received, invest, withdraw, cashout
    }

    private var category: Category {
        // A fiat off-ramp (Linq) rides direction "sent" but renders as its
        // own CASH-OUT receipt — bank destination, naira payout, FX rate.
        if entry.offramp != nil { return .cashout }
        switch entry.direction {
        case "received": return .received
        case "invest":   return .invest
        case "withdraw": return .withdraw
        default:         return .sent
        }
    }

    private var badgeBg: Color {
        switch category {
        case .sent:     return TaliseColor.badgeSent
        case .cashout:  return TaliseColor.badgeSent
        case .received: return TaliseColor.badgeReceived
        case .invest:   return TaliseColor.accent.opacity(0.22)
        case .withdraw: return TaliseColor.badgeReceived
        }
    }

    private var badgeFg: Color {
        switch category {
        case .sent:     return Color(hex: 0xE08D8A)
        case .cashout:  return Color(hex: 0xE08D8A)
        case .received: return Color(hex: 0x79D96C)
        case .invest:   return TaliseColor.accent
        case .withdraw: return Color(hex: 0x79D96C)
        }
    }

    private var badgeIcon: String {
        switch category {
        case .sent:     return "arrow.up.right"
        case .cashout:  return "building.columns"
        case .received: return "arrow.down.left"
        case .invest:   return "leaf.fill"
        case .withdraw: return "leaf"
        }
    }

    private var headerLabel: String {
        switch category {
        case .sent:     return "Sent"
        case .cashout:  return "Cash out"
        case .received: return "Received"
        case .invest:
            if let v = entry.venue, !v.isEmpty {
                return "Invested in \(displayVenueName(v))"
            }
            return "Invested"
        case .withdraw:
            if let v = entry.venue, !v.isEmpty {
                return "Withdrew from \(displayVenueName(v))"
            }
            return "Withdrew"
        }
    }

    private var directionBadge: some View {
        VStack(spacing: 10) {
            ZStack {
                // FLAT hero chip — a solid tinted disc, no gradient highlight,
                // white rim, or shadow.
                Circle()
                    .fill(badgeBg)
                    .frame(width: 68, height: 68)
                Image(systemName: badgeIcon)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(badgeFg)
            }
            MicroLabel(text: headerLabel, color: TaliseColor.fgDim)
                .kerning(2.0)
        }
        .padding(.top, 16)
    }

    // MARK: - Amount

    private var amountBlock: some View {
        VStack(spacing: 6) {
            Text(primaryAmount)
                .font(TaliseFont.display(40, weight: .medium))
                .kerning(-1.4)
                .foregroundStyle(category == .cashout ? Color(hex: 0xE5484D) : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let usdsui = entry.amountUsdsui {
                Text(String(format: "%@ USDsui", TaliseFormat.usd2(Swift.abs(usdsui))))
                    .font(TaliseFont.mono(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        }
    }

    private var primaryAmount: String {
        // U+202F NARROW NO-BREAK SPACE between sign and currency symbol
        // so "-₦0.01" doesn't render with the minus stroke kissing the
        // ₦ glyph at this big point size.
        // Inflow (received + withdraw from a venue) reads "+"; outflow
        // (sent + invest into a venue) reads "-".
        // Cash-out hero is the NGN payout the user received, in red-outflow
        // form ("-‍₦142,350.00"). The USDsui leg drops to the subtitle below.
        if let off = entry.offramp {
            return "-\u{202F}" + TaliseFormat.ngn(off.amountNgn)
        }
        let isInflow = entry.isReceived || entry.isWithdraw
        let prefix = isInflow ? "+\u{202F}" : "-\u{202F}"
        if let usd = entry.amountUsdsui {
            return prefix + TaliseFormat.local2(Swift.abs(usd))
        }
        if let sui = entry.amountSui {
            return String(format: "\(prefix)%.4f SUI", Swift.abs(sui))
        }
        return prefix + "—"
    }

    // MARK: - Details card

    @ViewBuilder
    private var detailsCard: some View {
        if let off = entry.offramp {
            cashOutDetailsCard(off)
        } else {
            transferDetailsCard
        }
    }

    /// CASH-OUT receipt body: destination bank, the USDsui debited, the
    /// applied FX rate, the disbursement status, date, and the on-chain
    /// digest (the chain leg is still the source of truth — keeps the
    /// Suiscan link working).
    private func cashOutDetailsCard(_ off: OfframpInfo) -> some View {
        VStack(spacing: 0) {
            row(label: "To", value: cashOutDestination(off))
            divider
            if let usd = entry.amountUsdsui {
                row(label: "You sent",
                    value: String(format: "%@ USDsui", TaliseFormat.usd2(Swift.abs(usd))))
                divider
            }
            row(label: "Rate", value: "$1 = \(TaliseFormat.ngn(off.rate))")
            divider
            row(label: "Status", value: cashOutStatusLabel(off.status))
            divider
            row(label: "Date", value: dateFormatter.string(from: timestamp))
            divider
            row(label: "Digest", value: shortDigest, mono: true)
        }
        .padding(.vertical, 4)
        .receiptFlatCard(cornerRadius: 22)
    }

    private func cashOutDestination(_ off: OfframpInfo) -> String {
        let bank = (off.bankName?.isEmpty == false) ? off.bankName! : "Bank"
        if let last4 = off.accountLast4, !last4.isEmpty {
            return "\(bank) \u{2022}\u{2022}\u{2022}\u{2022}\(last4)"
        }
        return bank
    }

    /// Friendly Linq status → user-facing copy.
    private func cashOutStatusLabel(_ status: String) -> String {
        // Linq statuses are free text (e.g. "Settled in treasury") — substring-match.
        let s = status.lowercased()
        if s.contains("disburse") || s.contains("settled") || s.contains("complete")
            || s.contains("success") || s.contains("paid") {
            return "Paid out"
        }
        if s.contains("timeout") || s.contains("fail") || s.contains("error")
            || s.contains("cancel") || s.contains("reject") || s.contains("declin") {
            return "Failed"
        }
        return "Pending"
    }

    private var transferDetailsCard: some View {
        VStack(spacing: 0) {
            // Counterparty row depends on direction:
            //   sent     → "To"   <recipient>
            //   received → "From" <sender>
            //   invest   → "Venue" <NAVI/DEEPBOOK>
            //   withdraw → "Venue" <NAVI/DEEPBOOK>
            // Old code always said "From" which read backwards for any
            // outgoing transfer, and showed "—" for venue txs because
            // there's no AddressOwner counterparty.
            switch category {
            // `.cashout` is routed to `cashOutDetailsCard` before we ever
            // reach here, so this branch is unreachable — but the switch
            // must remain exhaustive.
            case .sent, .cashout:
                row(label: "To", value: counterpartyOrAddress, mono: !hasCounterpartyName)
            case .received:
                row(label: "From", value: counterpartyOrAddress, mono: !hasCounterpartyName)
            case .invest, .withdraw:
                row(
                    label: "Venue",
                    value: entry.venue.map(displayVenueName) ?? "—"
                )
            }
            divider
            row(label: "Date", value: dateFormatter.string(from: timestamp))
            divider
            row(label: "Network", value: "Sui Mainnet")
            divider
            row(label: "Digest", value: shortDigest, mono: true)
        }
        .padding(.vertical, 4)
        .receiptFlatCard(cornerRadius: 22)
    }

    private func row(label: String, value: String, mono: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer()
            Text(value)
                .font(mono
                      ? TaliseFont.mono(12, weight: .light)
                      : TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }

    private var divider: some View {
        Rectangle().fill(Color.white.opacity(0.05))
            .frame(height: 1).padding(.horizontal, 14)
    }

    // MARK: - Actions

    private var actions: some View {
        VStack(spacing: 10) {
            Button {
                openSuiscan()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 13, weight: .medium))
                    Text("View on Suiscan")
                        .font(TaliseFont.heading(15, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(TaliseColor.fg)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            Button {
                UIPasteboard.general.string = entry.digest
                withAnimation(.easeInOut(duration: 0.15)) { digestCopied = true }
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    await MainActor.run { digestCopied = false }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: digestCopied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 13, weight: .medium))
                    Text(digestCopied ? "Copied" : "Copy digest")
                        .font(TaliseFont.heading(15, weight: .medium))
                }
                .foregroundStyle(TaliseColor.fg)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                // FLAT secondary action — a solid surface2 capsule. No
                // material, gradient, or rim.
                .background(Capsule().fill(TaliseColor.surface2))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Helpers

    private var hasCounterpartyName: Bool {
        (entry.counterpartyName?.isEmpty == false)
    }

    private var counterpartyOrAddress: String {
        if let name = entry.counterpartyName, !name.isEmpty { return name }
        if let addr = entry.counterparty {
            return short(addr)
        }
        return "—"
    }

    private var shortDigest: String {
        let d = entry.digest
        guard d.count > 14 else { return d }
        return String(d.prefix(10)) + "…" + String(d.suffix(6))
    }

    private var timestamp: Date {
        Date(timeIntervalSince1970: entry.timestampMs / 1000)
    }

    private func short(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }

    private func openSuiscan() {
        guard let url = URL(string: "https://suiscan.xyz/mainnet/tx/\(entry.digest)") else {
            return
        }
        UIApplication.shared.open(url)
    }
}

/// FLAT card for the receipt's details block — a single solid
/// `TaliseColor.surface` fill on a continuous rounded rectangle. No
/// material, blur, gradient sheen, gradient stroke, or shadow.
private struct ReceiptFlatCard: ViewModifier {
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(shape.fill(TaliseColor.surface))
            .clipShape(shape)
    }
}

private extension View {
    func receiptFlatCard(cornerRadius: CGFloat = 22) -> some View {
        modifier(ReceiptFlatCard(cornerRadius: cornerRadius))
    }
}
