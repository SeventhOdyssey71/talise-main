import SwiftUI

/// Full-screen "Successful" celebration shown after a payment lands.
/// Implements Figma node 132:2 ("Successful PopUp") verbatim — pastel
/// green field, two soft cloud blobs in the top corners, half-toned
/// coin-stack illustration, the sent amount, a two-line mono "gas cost
/// = 0 / money arrives < 1s" reassurance, and a Share Receipt + Done
/// button row.
///
/// `amountText` is pre-formatted in the user's display currency by the
/// caller via `TaliseFormat.local2`, so a $ user sees "$65.00" and a ₦
/// user sees "₦95,400.00".
///
/// Design tokens (Figma get_design_context, node 132:2):
///   bg              #CAFFB8
///   amount          DM Sans 50 / regular / #4B8A37 / tracking -1
///   subtitle        JetBrains Mono 13 / regular / #6E9C5F / tracking -0.26
///   Share Receipt   #4B8A37 @ 20% pill, 158×41, text #4B8A37
///   Done            #4B8A37 pill, 92×41, text #B1F49A
struct SuccessfulTxView: View {
    /// Pre-formatted, currency-aware amount, e.g. "$65.00".
    let amountText: String
    /// Fired by "Share Receipt". Optional — when nil the button still
    /// renders (matching the design) but is inert.
    var onShareReceipt: (() -> Void)? = nil
    let onDone: () -> Void

    private let bg = Color(hex: 0xCAFFB8)
    private let deepGreen = Color(hex: 0x4B8A37)
    private let subtitleGreen = Color(hex: 0x6E9C5F)
    private let buttonText = Color(hex: 0xB1F49A)

    var body: some View {
        ZStack {
            bg.ignoresSafeArea()

            // Decorative cloud blobs in the top corners. Anchored to the
            // edges and pushed partially off-screen, matching the Figma
            // insets (left cloud ~20% down hugging the left edge, right
            // cloud near the top hugging the right edge).
            GeometryReader { proxy in
                let w = proxy.size.width
                let h = proxy.size.height
                Image("SuccessCloudRight")
                    .resizable()
                    .scaledToFit()
                    .frame(width: w * 0.55)
                    .position(x: w * 0.92, y: h * 0.12)
                Image("SuccessCloudLeft")
                    .resizable()
                    .scaledToFit()
                    .frame(width: w * 0.46)
                    .position(x: w * 0.02, y: h * 0.30)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 0) {
                Spacer()

                Image("SuccessCoins")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 256, height: 200)

                Spacer().frame(height: 30)

                Text(amountText)
                    .font(TaliseFont.heading(50, weight: .regular))
                    .kerning(-1)
                    .foregroundStyle(deepGreen)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .padding(.horizontal, 24)

                VStack(spacing: 2) {
                    Text("gas cost = 0")
                    Text("money arrives < 1s")
                }
                .font(TaliseFont.mono(13, weight: .regular))
                .kerning(-0.26)
                .foregroundStyle(subtitleGreen)
                .multilineTextAlignment(.center)
                .padding(.top, 16)

                Spacer()

                HStack(spacing: 13) {
                    Button(action: { onShareReceipt?() }) {
                        HStack(spacing: 6) {
                            Text("Share Receipt")
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 12, weight: .medium))
                        }
                        .font(TaliseFont.body(15, weight: .medium))
                        .kerning(-0.3)
                        .foregroundStyle(deepGreen)
                        .frame(width: 158, height: 41)
                        .background(
                            Capsule().fill(deepGreen.opacity(0.2))
                        )
                    }
                    .buttonStyle(.plain)

                    Button(action: onDone) {
                        Text("Done")
                            .font(TaliseFont.body(15, weight: .medium))
                            .kerning(-0.3)
                            .foregroundStyle(buttonText)
                            .frame(width: 92, height: 41)
                            .background(
                                Capsule().fill(deepGreen)
                            )
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 40)
            }
        }
        .preferredColorScheme(.light)
    }
}
