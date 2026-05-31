import SwiftUI

/// Full-screen "Transaction Successful!" celebration shown after a
/// payment lands. Implements Figma node 141:18 — dark theme: black field
/// with a soft green glow, a half-toned coin stack that drops in
/// scrapbook-style, a large light-green amount, a "Transaction
/// Successful!" line, a one-line mono "gas cost = 0, money arrives < 1s"
/// reassurance, and a Share Receipt + Done button row.
///
/// `amountText` is pre-formatted in the user's display currency by the
/// caller via `TaliseFormat.local2`, e.g. "$65.00".
///
/// Design tokens (Figma get_design_context, node 141:18):
///   bg              black + green glow blob (SuccessGlowBackground)
///   amount          DM Sans 75 / regular / #B1F49A / tracking -1.5
///   title           DM Sans 25 / medium / #B1F49A / tracking -0.5
///   subtitle        JetBrains Mono 13 / regular / white / tracking -0.26
///   Share Receipt   white @ 20% pill, 158×41, text white
///   Done            white pill, 92×41, text black
struct SuccessfulTxView: View {
    /// Pre-formatted, currency-aware amount, e.g. "$65.00".
    let amountText: String
    var onShareReceipt: (() -> Void)? = nil
    let onDone: () -> Void

    private let mintGreen = Color(hex: 0xB1F49A)

    var body: some View {
        ZStack {
            SuccessGlowBackground()

            VStack(spacing: 0) {
                Spacer()

                // Coin stack drops in with the paper-placement wobble,
                // tilted the opposite way from the savings piggy so the
                // two screens feel hand-placed rather than templated.
                Image("SuccessCoins")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 360, height: 282)
                    .scrapbookEntry(delay: 0.05, tilt: 6)

                Spacer().frame(height: 24)

                Text(amountText)
                    .font(TaliseFont.heading(75, weight: .regular))
                    .kerning(-1.5)
                    .foregroundStyle(mintGreen)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.4)
                    .lineLimit(1)
                    .padding(.horizontal, 20)
                    .scrapbookFadeUp(delay: 0.20)

                Text("Transaction Successful!")
                    .font(TaliseFont.heading(25, weight: .medium))
                    .kerning(-0.5)
                    .foregroundStyle(mintGreen)
                    .padding(.top, 18)
                    .scrapbookFadeUp(delay: 0.28)

                Text("gas cost = 0, money arrives < 1s")
                    .font(TaliseFont.mono(13, weight: .regular))
                    .kerning(-0.26)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
                    .scrapbookFadeUp(delay: 0.34)

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
                        .foregroundStyle(.white)
                        .frame(width: 158, height: 41)
                        .background(Capsule().fill(Color.white.opacity(0.2)))
                    }
                    .buttonStyle(.plain)

                    Button(action: onDone) {
                        Text("Done")
                            .font(TaliseFont.body(15, weight: .medium))
                            .kerning(-0.3)
                            .foregroundStyle(.black)
                            .frame(width: 92, height: 41)
                            .background(Capsule().fill(.white))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 40)
                .scrapbookFadeUp(delay: 0.40)
            }
        }
        .preferredColorScheme(.dark)
    }
}
