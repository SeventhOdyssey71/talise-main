import SwiftUI
import CoreImage.CIFilterBuiltins

struct ReceiveView: View {
    @Environment(AppSession.self) private var session

    var address: String {
        if case .ready(let user) = session.phase { return user.suiAddress }
        return ""
    }

    var subname: String? {
        // TODO: resolve via /api/username/lookup once user is loaded.
        nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    PageHeader(eyebrow: "Receive", title: "Get paid")

                    VStack(spacing: 16) {
                        Eyebrow(text: subname ?? "Your wallet")
                        QRView(content: "sui:\(address)")
                            .frame(width: 220, height: 220)
                        Text(shortAddress(address))
                            .font(TaliseFont.mono(13))
                            .foregroundStyle(TaliseColor.fg)
                        HStack(spacing: 12) {
                            TaliseButton(title: "Copy", variant: .secondary, icon: "doc.on.doc") {
                                UIPasteboard.general.string = address
                            }
                            TaliseButton(title: "Share", variant: .secondary, icon: "square.and.arrow.up") {
                                share(text: address)
                            }
                        }
                    }
                    .padding(24)
                    .background(TaliseColor.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: TaliseRadius.lg)
                            .stroke(TaliseColor.line, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.lg))
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
            .navigationBarHidden(true)
            .background(TaliseColor.bg)
        }
    }

    private func shortAddress(_ a: String) -> String {
        guard a.count > 12 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
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
