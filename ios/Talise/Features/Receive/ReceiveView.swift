import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

struct ReceiveView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    /// Optional USD amount to request. Empty = a plain receive QR; a value
    /// turns the card into a payment REQUEST (merchant charge / P2P ask) by
    /// encoding `talise://pay/<handle>?amount=` so the payer's scanner
    /// prefills the amount. ConfirmPaymentSheet treats `amount` as USD.
    @State private var amountText = ""
    @FocusState private var amountFocused: Bool

    private var address: String {
        if case .ready(let user) = session.phase { return user.suiAddress }
        return ""
    }

    /// Bare on-chain handle (e.g. "alice"), nil until the user claims one.
    private var taliseHandle: String? {
        if case .ready(let user) = session.phase { return user.taliseHandle }
        return nil
    }

    /// Parsed requested amount in USD, if a positive value was entered.
    private var requestedAmount: Double? {
        let v = Double(amountText.trimmingCharacters(in: .whitespaces))
        guard let v, v > 0 else { return nil }
        return v
    }

    /// What the QR encodes. With an amount → a payable request link
    /// (handle-first so the payer sees the @handle; address fallback).
    /// Without an amount → the plain `sui:<address>` receive code that
    /// external Sui wallets also understand.
    private var qrContent: String {
        if let amt = requestedAmount {
            let a = String(format: "%.2f", amt)
            if let h = taliseHandle, !h.isEmpty {
                return "talise://pay/\(h)?amount=\(a)"
            }
            return "sui:\(address)?amount=\(a)"
        }
        return "sui:\(address)"
    }

    /// What Copy/Share emit — the request link when an amount is set, else
    /// the raw address.
    private var shareContent: String {
        requestedAmount != nil ? qrContent : address
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

                amountField
                    .padding(.horizontal, 24)

                qrCard
                    .padding(.horizontal, 24)

                actions
                    .padding(.horizontal, 24)

                Spacer(minLength: 40)
            }
        }
        .background(
            ZStack(alignment: .top) {
                TaliseColor.bg.ignoresSafeArea()
                TopGlow().ignoresSafeArea(edges: .top)
            }
        )
        .presentationDragIndicator(.visible)
    }

    /// Optional "request a specific amount" input. Empty → the card is a
    /// plain receive code; a value turns it into a payment request (merchant
    /// charge or P2P ask) that the payer's scanner prefills.
    private var amountField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Request a specific amount (optional)")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            HStack(spacing: 8) {
                Text("$")
                    .font(TaliseFont.heading(20, weight: .medium))
                    .foregroundStyle(TaliseColor.fgSubtle)
                TextField("0.00", text: $amountText)
                    .keyboardType(.decimalPad)
                    .focused($amountFocused)
                    .font(TaliseFont.heading(20, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                if !amountText.isEmpty {
                    Button {
                        amountText = ""
                        amountFocused = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(TaliseColor.surface2.opacity(0.55))
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [Color.white.opacity(0.14), Color.white.opacity(0.03)],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private var qrCard: some View {
        VStack(spacing: 18) {
            Text(handleLine)
                .font(TaliseFont.heading(20, weight: .medium))
                .kerning(-0.8)
                .foregroundStyle(TaliseColor.fgSubtle)

            if let amt = requestedAmount {
                Text("Requesting $\(String(format: "%.2f", amt))")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
            }

            QRView(content: qrContent)
                .frame(width: 220, height: 220)
                .padding(18)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(color: Color.black.opacity(0.35), radius: 18, x: 0, y: 10)

            Text(short(address))
                .font(TaliseFont.mono(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.vertical, 30)
        .frame(maxWidth: .infinity)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(.ultraThinMaterial)
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(TaliseColor.surface.opacity(0.5))
                // Soft brand-green wash lit from the top — the iOS-26 look.
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [TaliseColor.greenMint.opacity(0.10), .clear],
                            startPoint: .top,
                            endPoint: .center
                        )
                    )
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [Color.white.opacity(0.18), Color.white.opacity(0.04)],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
        )
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Color.black.opacity(0.4), radius: 24, x: 0, y: 14)
    }

    private var actions: some View {
        HStack(spacing: 12) {
            actionButton(
                icon: copied ? "checkmark" : "doc.on.doc",
                label: copied ? "Copied" : (requestedAmount != nil ? "Copy link" : "Copy address"),
                primary: false
            ) {
                UIPasteboard.general.string = shareContent
                withAnimation(.easeInOut(duration: 0.15)) { copied = true }
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    await MainActor.run { copied = false }
                }
            }
            actionButton(
                icon: "square.and.arrow.up",
                label: requestedAmount != nil ? "Share request" : "Share",
                primary: true
            ) {
                share(text: shareContent)
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
                Capsule().fill(TaliseColor.surface2.opacity(0.5))
            }
        }
    }

    /// Top specular hairline for the secondary pill — a soft gradient stroke
    /// in the Liquid Glass language. Nothing on the primary (white) pill.
    @ViewBuilder
    private func secondaryGlassStroke(primary: Bool) -> some View {
        if !primary {
            Capsule().strokeBorder(
                LinearGradient(
                    colors: [Color.white.opacity(0.16), Color.white.opacity(0.04)],
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
