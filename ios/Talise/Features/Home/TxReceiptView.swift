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
    }

    // MARK: - Direction badge

    private var directionBadge: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(entry.isReceived ? TaliseColor.badgeReceived : TaliseColor.badgeSent)
                    .frame(width: 64, height: 64)
                Image(systemName: entry.isReceived ? "arrow.down.left" : "arrow.up.right")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(
                        entry.isReceived
                            ? Color(hex: 0x79D96C)
                            : Color(hex: 0xE08D8A)
                    )
            }
            MicroLabel(text: entry.isReceived ? "Received" : "Sent", color: TaliseColor.fgDim)
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
                .foregroundStyle(TaliseColor.fg)
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
        let prefix = entry.isReceived ? "+" : "-"
        if let usd = entry.amountUsdsui {
            return prefix + TaliseFormat.local2(Swift.abs(usd))
        }
        if let sui = entry.amountSui {
            return String(format: "\(prefix)%.4f SUI", Swift.abs(sui))
        }
        return prefix + "—"
    }

    // MARK: - Details card

    private var detailsCard: some View {
        VStack(spacing: 0) {
            row(label: "From", value: counterpartyOrAddress, mono: !hasCounterpartyName)
            divider
            row(label: "Date", value: dateFormatter.string(from: timestamp))
            divider
            row(label: "Network", value: "Sui Mainnet")
            divider
            row(label: "Digest", value: shortDigest, mono: true)
        }
        .padding(.vertical, 4)
        .background(TaliseColor.usernameCard)
        .clipShape(RoundedRectangle(cornerRadius: 22))
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
                .background(TaliseColor.surface2)
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
