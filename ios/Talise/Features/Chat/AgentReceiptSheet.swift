import SwiftUI

/// A clean paper-style receipt for a successful agent transaction — a white
/// slip with a torn bottom edge, monospace ledger rows, a barcode, and a
/// "thank you". The same slip is rendered to an image so "Share receipt" hands
/// the system share sheet a crisp graphic.
struct AgentReceiptSheet: View {
    let amountUsd: Double
    let recipient: String
    let digest: String
    var title: String = "Sent"

    @Environment(\.dismiss) private var dismiss
    @State private var rendered: Image?

    private let ink = Color(red: 0.10, green: 0.13, blue: 0.09)   // near-black green
    private let paper = Color(red: 0.98, green: 0.98, blue: 0.96) // warm white
    private var suiscanURL: URL? { URL(string: "https://suiscan.xyz/mainnet/tx/\(digest)") }

    var body: some View {
        VStack(spacing: 20) {
            ScrollView(showsIndicators: false) {
                slip
                    .padding(.horizontal, 36)
                    .padding(.top, 24)
            }

            VStack(spacing: 12) {
                if let img = rendered {
                    ShareLink(item: img, preview: SharePreview("Talise receipt", image: img)) { shareLabel }
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
            .padding(.bottom, 6)
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

    /// The paper slip (also what we snapshot to share).
    private var slip: some View {
        VStack(spacing: 0) {
            VStack(spacing: 14) {
                // Brand mark (tinted to the receipt ink) instead of a text wordmark.
                Image("TaliseLogo")
                    .resizable()
                    .renderingMode(.template)
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 34, height: 31)
                    .foregroundStyle(ink)
                    .padding(.top, 28)
                Text("PAYMENT RECEIPT")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .tracking(3)
                    .foregroundStyle(ink.opacity(0.5))

                dashed

                VStack(spacing: 10) {
                    line(title.uppercased(), TaliseFormat.usd2(amountUsd))
                    line("TO", recipient)
                    line("DATE", shortDate)
                    line("NETWORK FEE", "FREE")
                    line("STATUS", "CONFIRMED")
                }
                .padding(.horizontal, 22)

                dashed

                HStack(alignment: .firstTextBaseline) {
                    Text("TOTAL").font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundStyle(ink)
                    Spacer()
                    Text(TaliseFormat.usd2(amountUsd)).font(.system(size: 17, weight: .heavy, design: .monospaced)).foregroundStyle(ink)
                }
                .padding(.horizontal, 22)

                Barcode(seed: digest, ink: ink)
                    .frame(height: 46)
                    .padding(.horizontal, 22)
                    .padding(.top, 4)
                Text(shortDigest)
                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                    .foregroundStyle(ink.opacity(0.55))

                Text("THANK YOU")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .tracking(3)
                    .foregroundStyle(ink.opacity(0.75))
                    .padding(.top, 6)
                    .padding(.bottom, 22)
            }
            .frame(maxWidth: .infinity)
            .background(paper)
            // Torn bottom edge.
            TornEdge().fill(paper).frame(height: 12)
        }
        .compositingGroup()
        .shadow(color: .black.opacity(0.35), radius: 18, x: 0, y: 10)
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 11, weight: .regular, design: .monospaced)).foregroundStyle(ink.opacity(0.5))
            Spacer(minLength: 12)
            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(ink)
                .lineLimit(1).truncationMode(.middle)
        }
    }

    private var dashed: some View {
        Line().stroke(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .foregroundStyle(ink.opacity(0.25))
            .frame(height: 1)
            .padding(.horizontal, 22)
    }

    private var shortDigest: String {
        digest.count > 16 ? "\(digest.prefix(8))…\(digest.suffix(8))" : digest
    }
    private var shortDate: String {
        let f = DateFormatter(); f.dateFormat = "MMM d, yyyy  HH:mm"; return f.string(from: Date())
    }

    @MainActor private func renderImage() {
        let renderer = ImageRenderer(content: slip.frame(width: 320).padding(28).background(TaliseColor.bg))
        renderer.scale = 3
        if let ui = renderer.uiImage { rendered = Image(uiImage: ui) }
    }
}

// MARK: - Shapes

private struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path(); p.move(to: CGPoint(x: rect.minX, y: rect.midY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)); return p
    }
}

/// A zigzag "torn paper" bottom edge.
private struct TornEdge: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let teeth = 22
        let w = rect.width / CGFloat(teeth)
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        var x = rect.maxX
        var down = true
        while x > rect.minX {
            x -= w
            p.addLine(to: CGPoint(x: max(x, rect.minX), y: down ? rect.maxY : rect.minY))
            down.toggle()
        }
        p.closeSubpath()
        return p
    }
}

/// A faux barcode whose bar widths are derived from the tx digest (stable).
private struct Barcode: View {
    let seed: String
    let ink: Color
    var body: some View {
        Canvas { ctx, size in
            let bytes = Array(seed.utf8)
            guard !bytes.isEmpty else { return }
            var x: CGFloat = 0
            var i = 0
            while x < size.width {
                let b = bytes[i % bytes.count]
                let bar = CGFloat(1 + Int(b) % 4)       // 1...4 pt wide
                let gap = CGFloat(1 + Int(b >> 2) % 3)  // 1...3 pt gap
                if i % 2 == 0 {
                    ctx.fill(Path(CGRect(x: x, y: 0, width: bar, height: size.height)), with: .color(ink))
                }
                x += bar + gap
                i += 1
            }
        }
    }
}
