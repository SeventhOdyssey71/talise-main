import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

struct ReceiveView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    private var address: String {
        if case .ready(let user) = session.phase { return user.suiAddress }
        return ""
    }

    /// Receive card title. Prefers the on-chain handle; if the user
    /// hasn't claimed one yet we show the canonical short address so
    /// the QR card still identifies the wallet (the QR encodes the
    /// full address regardless).
    private var handleLine: String {
        guard case .ready(let user) = session.phase else { return "your wallet" }
        return user.displayHandle() ?? short(user.suiAddress)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    MicroLabel(text: "Receive", color: TaliseColor.fgDim).kerning(1.5)
                    Text("Get paid")
                        .font(TaliseFont.heading(28, weight: .medium))
                        .kerning(-1)
                        .foregroundStyle(TaliseColor.fg)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 12)

                qrCard
                    .padding(.horizontal, 24)

                actions
                    .padding(.horizontal, 24)

                Spacer(minLength: 40)
            }
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
    }

    private var qrCard: some View {
        VStack(spacing: 18) {
            Text(handleLine)
                .font(TaliseFont.heading(20, weight: .medium))
                .kerning(-0.8)
                .foregroundStyle(TaliseColor.fgSubtle)

            QRView(content: "sui:\(address)")
                .frame(width: 220, height: 220)
                .padding(16)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))

            Text(short(address))
                .font(TaliseFont.mono(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
        .taliseGlass(cornerRadius: 25)
    }

    private var actions: some View {
        HStack(spacing: 12) {
            actionButton(
                icon: copied ? "checkmark" : "doc.on.doc",
                label: copied ? "Copied" : "Copy address",
                primary: false
            ) {
                UIPasteboard.general.string = address
                withAnimation(.easeInOut(duration: 0.15)) { copied = true }
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    await MainActor.run { copied = false }
                }
            }
            actionButton(
                icon: "square.and.arrow.up",
                label: "Share",
                primary: true
            ) {
                share(text: address)
            }
        }
    }

    private func actionButton(
        icon: String,
        label: String,
        primary: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                Text(label)
                    .font(TaliseFont.heading(14, weight: .medium))
            }
            .foregroundStyle(primary ? TaliseColor.bg : TaliseColor.fg)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(secondaryGlassBackground(primary: primary))
            .overlay(secondaryGlassStroke(primary: primary))
            .clipShape(Capsule())
            .shadow(color: Color.black.opacity(primary ? 0 : 0.35), radius: 12, x: 0, y: 6)
        }
    }

    /// Background swap for the secondary (Copy address) pill: keep the
    /// primary Share pill flat-white (it's the high-affordance action),
    /// but render the secondary pill as a liquid-glass capsule —
    /// ultraThinMaterial + dark tint, so it sits on the page background
    /// the same way the bottom nav pill does.
    @ViewBuilder
    private func secondaryGlassBackground(primary: Bool) -> some View {
        if primary {
            Capsule().fill(TaliseColor.fg)
        } else {
            ZStack {
                Capsule().fill(.ultraThinMaterial)
                Capsule().fill(Color.black.opacity(0.45))
            }
        }
    }

    /// Top specular hairline for the secondary pill — same gradient
    /// recipe as TaliseGlassCard. Nothing on the primary (white) pill.
    @ViewBuilder
    private func secondaryGlassStroke(primary: Bool) -> some View {
        if !primary {
            Capsule().strokeBorder(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0.22),
                        Color.white.opacity(0.04),
                        Color.white.opacity(0.10),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                lineWidth: 1
            )
        }
    }

    private func short(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(10)) + "…" + String(a.suffix(8))
    }

    private func share(text: String) {
        let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?
            .rootViewController?
            .present(activity, animated: true)
    }
}

struct QRView: View {
    let content: String

    var body: some View {
        if let image = qr() {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
        } else {
            Color.gray
        }
    }

    private func qr() -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(content.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cgImage = context.createCGImage(output, from: output.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}
