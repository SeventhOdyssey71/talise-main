import SwiftUI

/// Full-screen "You just saved …" celebration shown after a successful
/// NAVI supply (invest). Implements Figma node 141:2 — dark theme: black
/// field with a soft green glow at the top, a half-toned piggy that
/// drops in scrapbook-style, the localized saved amount in light green,
/// a mono congratulations line, and a white "Back to Invest" pill.
///
/// `amountText` is pre-formatted in the user's display currency by the
/// caller (EarnView via `TaliseFormat.local2`), so a ₦ user sees
/// "₦12,000.00" and a $ user sees "$2.12".
///
/// Design tokens (Figma get_design_context, node 141:2):
///   bg            black + green glow blob (SuccessGlowBackground)
///   amount        DM Sans 40 / regular / #B1F49A / tracking -0.8
///   subtitle      JetBrains Mono 13 / regular / white / tracking -0.26
///   button        white pill, radius 30, 175×41
///   button text   DM Sans 15 / black / tracking -0.3
struct SavingsSuccessView: View {
    /// Pre-formatted, currency-aware amount, e.g. "$2.12".
    let amountText: String
    let onDismiss: () -> Void

    private let mintGreen = Color(hex: 0xB1F49A)

    var body: some View {
        ZStack {
            SuccessGlowBackground()

            VStack(spacing: 0) {
                Spacer()

                // Piggy drops in with the paper-placement wobble.
                Image("SavingsPiggy")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 330, height: 300)
                    .scrapbookEntry(delay: 0.05, tilt: -7)

                Spacer().frame(height: 30)

                Text("You just saved \(amountText)")
                    .font(TaliseFont.heading(40, weight: .regular))
                    .kerning(-0.8)
                    .foregroundStyle(mintGreen)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .padding(.horizontal, 24)
                    .scrapbookFadeUp(delay: 0.22)

                Text("Congratulations on taking this financial step! We getting rich step by step.")
                    .font(TaliseFont.mono(13, weight: .regular))
                    .kerning(-0.26)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 310)
                    .padding(.top, 14)
                    .scrapbookFadeUp(delay: 0.30)

                Spacer()

                Button(action: onDismiss) {
                    Text("Back to Invest")
                        .font(TaliseFont.body(15, weight: .medium))
                        .kerning(-0.3)
                        .foregroundStyle(.black)
                        .frame(width: 175, height: 41)
                        .background(Capsule().fill(.white))
                }
                .buttonStyle(.plain)
                .padding(.bottom, 40)
                .scrapbookFadeUp(delay: 0.38)
            }
        }
        .preferredColorScheme(.dark)
    }
}
