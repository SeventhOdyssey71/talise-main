import SwiftUI

/// Full-screen success confirmation shown after a successful NAVI supply
/// (invest). Calm, premium treatment: black field with the shared green
/// glow at the top (`SuccessGlowBackground`), a single accent checkmark
/// that settles in, a white headline, one quiet mono sub-line, and the
/// white "Back to Invest" pill.
///
/// `amountText` is pre-formatted in the user's display currency by the
/// caller (EarnView via `TaliseFormat.local2`), so a ₦ user sees
/// "₦12,000.00" and a $ user sees "$2.12".
struct SavingsSuccessView: View {
    /// Pre-formatted, currency-aware amount, e.g. "$2.12".
    let amountText: String
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            SuccessGlowBackground()

            VStack(spacing: 0) {
                Spacer()

                // One calm hero: the accent checkmark settles in on a soft
                // translucent-glass halo so it reads as a lit iOS-26 mark.
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
                    .padding(26)
                    .background(
                        Circle()
                            .fill(.ultraThinMaterial)
                            .overlay(
                                Circle().fill(TaliseColor.accent.opacity(0.10))
                            )
                            .overlay(
                                Circle().strokeBorder(
                                    LinearGradient(
                                        colors: [
                                            Color.white.opacity(0.22),
                                            TaliseColor.accent.opacity(0.10),
                                        ],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    ),
                                    lineWidth: 1
                                )
                            )
                    )
                    .scrapbookFadeUp(delay: 0.05)

                Spacer().frame(height: 30)

                Text("You're now earning")
                    .font(TaliseFont.display(40, weight: .regular))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fg)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .padding(.horizontal, 24)
                    .scrapbookFadeUp(delay: 0.22)

                Text("\(amountText) is now earning interest in your wallet.")
                    .font(TaliseFont.mono(13, weight: .regular))
                    .kerning(-0.26)
                    .foregroundStyle(TaliseColor.fgMuted)
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
                        .overlay(
                            // Faint top specular so the white pill catches the
                            // light like the rest of the liquid-glass surfaces.
                            Capsule().strokeBorder(Color.white.opacity(0.5), lineWidth: 0.5)
                        )
                }
                .buttonStyle(.plain)
                .padding(.bottom, 40)
                .scrapbookFadeUp(delay: 0.38)
            }
        }
        .preferredColorScheme(.dark)
    }
}
