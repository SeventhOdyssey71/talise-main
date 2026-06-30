import SwiftUI

/// A clean, shareable receipt for a successful agent transaction. The same card
/// the user sees is rendered to an image so "Share receipt" hands the system
/// share sheet a crisp graphic (not just a link).
struct AgentReceiptSheet: View {
    let amountUsd: Double
    let recipient: String
    let digest: String
    var title: String = "Sent"

    @Environment(\.dismiss) private var dismiss
    @State private var rendered: Image?

    private var suiscanURL: URL? { URL(string: "https://suiscan.xyz/mainnet/tx/\(digest)") }

    var body: some View {
        VStack(spacing: 18) {
            receiptCard
                .padding(.horizontal, 22)
                .padding(.top, 16)

            VStack(spacing: 12) {
                if let img = rendered {
                    ShareLink(item: img, preview: SharePreview("Talise receipt", image: img)) {
                        shareLabel
                    }
                    .buttonStyle(.plain)
                } else {
                    shareLabel.opacity(0.55)
                }
                if let url = suiscanURL {
                    Link(destination: url) {
                        Text("View on Suiscan")
                            .font(TaliseFont.body(13, weight: .medium))
                            .foregroundStyle(TaliseColor.fgMuted)
                    }
                }
            }
            .padding(.horizontal, 22)

            Spacer(minLength: 8)
        }
        .frame(maxWidth: .infinity)
        .background(TaliseColor.bg)
        .task { renderImage() }
    }

    private var shareLabel: some View {
        HStack(spacing: 8) {
            Image(systemName: "square.and.arrow.up").font(.system(size: 15, weight: .semibold))
            Text("Share receipt").font(TaliseFont.body(15, weight: .semibold))
        }
        .foregroundStyle(TaliseColor.bg)
        .frame(maxWidth: .infinity).frame(height: 50)
        .background(Capsule().fill(TaliseColor.greenMint))
    }

    /// The receipt visual — also what we snapshot to an image for sharing.
    private var receiptCard: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(TaliseColor.greenMint.opacity(0.16)).frame(width: 62, height: 62)
                Image(systemName: "checkmark")
                    .font(.system(size: 25, weight: .bold))
                    .foregroundStyle(TaliseColor.greenMint)
            }
            .padding(.top, 28)

            Text(title.uppercased())
                .font(TaliseFont.mono(11, weight: .medium)).tracking(2)
                .foregroundStyle(TaliseColor.fgMuted)
            Text(TaliseFormat.usd2(amountUsd))
                .font(TaliseFont.display(40, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
            Text("to \(recipient)")
                .font(TaliseFont.body(15))
                .foregroundStyle(TaliseColor.fgMuted)
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, 24)

            Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1)
                .padding(.horizontal, 24).padding(.top, 6)

            VStack(spacing: 11) {
                receiptRow("Date", shortDate)
                receiptRow("Network fee", "Free")
                receiptRow("Transaction", shortDigest, mono: true)
            }
            .padding(.horizontal, 24)

            HStack(spacing: 6) {
                Image("TaliseLogo").resizable().scaledToFit().frame(width: 16, height: 14)
                Text("talise").font(TaliseFont.body(12, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(.top, 8).padding(.bottom, 26)
        }
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(TaliseColor.surface))
    }

    private func receiptRow(_ label: String, _ value: String, mono: Bool = false) -> some View {
        HStack {
            Text(label).font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgDim)
            Spacer(minLength: 12)
            Text(value)
                .font(mono ? TaliseFont.mono(13, weight: .regular) : TaliseFont.body(13, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private var shortDigest: String {
        digest.count > 14 ? "\(digest.prefix(6))…\(digest.suffix(6))" : digest
    }
    private var shortDate: String {
        let f = DateFormatter()
        f.dateFormat = "MMM d, yyyy · h:mm a"
        return f.string(from: Date())
    }

    @MainActor private func renderImage() {
        let renderer = ImageRenderer(
            content: receiptCard
                .frame(width: 340)
                .padding(22)
                .background(TaliseColor.bg)
        )
        renderer.scale = 3
        if let ui = renderer.uiImage { rendered = Image(uiImage: ui) }
    }
}
