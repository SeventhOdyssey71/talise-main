import SwiftUI

/// The gift a rewarded user opens.
///
/// Drawn in SwiftUI rather than shipped as an image so the lid can genuinely
/// lift off on claim, and so it stays crisp at any size. Same surrounding
/// treatment as `GoalSuccessView` / `SuccessfulTxView` — glow background,
/// scrapbook entry, display headline, white capsule — so it reads as a Talise
/// moment rather than a promo interstitial.
///
/// Three states, one view: `sealed` (box closed, Claim button), `opening`
/// (button shows progress while the treasury pays), `opened` (lid off, amount
/// revealed). The amount is deliberately HIDDEN until claimed — a gift you can
/// already read the value of is just a notification.
struct RewardGiftSheet: View {
    enum Phase: Equatable { case sealed, opening, opened }

    let reason: String
    /// Pre-formatted in the user's display currency by the caller.
    let amountText: String
    var phase: Phase
    var errorText: String?
    let onClaim: () -> Void
    let onDone: () -> Void

    private var opened: Bool { phase == .opened }

    var body: some View {
        ZStack {
            SuccessGlowBackground()

            VStack(spacing: 0) {
                Spacer()

                GiftBox(opened: opened)
                    .frame(width: 210, height: 210)
                    .scrapbookEntry(delay: 0.05, tilt: -5)

                Spacer().frame(height: 34)

                Text(opened ? "It's yours" : "You've got a gift")
                    .font(TaliseFont.display(36, weight: .regular))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fg)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)
                    .padding(.horizontal, 24)
                    .animation(.easeInOut(duration: 0.25), value: opened)

                // Revealed only after claiming, so opening the box is the
                // moment something is learned.
                if opened {
                    Text(amountText)
                        .font(TaliseFont.display(54, weight: .medium))
                        .kerning(-1.4)
                        .foregroundStyle(TaliseColor.greenMint)
                        .padding(.top, 12)
                        .transition(.scale(scale: 0.7).combined(with: .opacity))
                }

                Text(opened ? "Added to your balance." : reason)
                    .font(TaliseFont.mono(13, weight: .regular))
                    .kerning(-0.26)
                    .foregroundStyle(TaliseColor.fgMuted)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 310)
                    .padding(.top, 14)

                if let errorText {
                    Text(errorText)
                        .font(TaliseFont.mono(12, weight: .regular))
                        .foregroundStyle(TaliseColor.danger)
                        .multilineTextAlignment(.center)
                        .frame(width: 300)
                        .padding(.top, 12)
                }

                Spacer()

                Button(action: opened ? onDone : onClaim) {
                    Group {
                        if phase == .opening {
                            ProgressView().tint(.black)
                        } else {
                            Text(opened ? "Done" : "Claim")
                                .font(TaliseFont.body(15, weight: .medium))
                                .kerning(-0.3)
                                .foregroundStyle(.black)
                        }
                    }
                    .frame(width: 175, height: 41)
                    .background(Capsule().fill(.white))
                }
                .buttonStyle(.plain)
                .disabled(phase == .opening)
                .padding(.bottom, 40)
                .scrapbookFadeUp(delay: 0.38)
            }
        }
        .preferredColorScheme(.dark)
        .animation(.spring(response: 0.5, dampingFraction: 0.7), value: phase)
    }
}

/// A wrapped box whose lid lifts, tilts and floats away when `opened`.
private struct GiftBox: View {
    let opened: Bool

    private let mint = TaliseColor.greenMint
    private var body_: Color { TaliseColor.greenMint.opacity(0.16) }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let boxW = w * 0.78
            let boxH = w * 0.60
            let lidH = w * 0.17

            ZStack(alignment: .bottom) {
                // Glow pooling under the box, brighter once open.
                Ellipse()
                    .fill(mint.opacity(opened ? 0.28 : 0.12))
                    .frame(width: boxW * 1.15, height: 26)
                    .blur(radius: 18)
                    .offset(y: 10)

                // ── body ──────────────────────────────────────────────
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(body_)
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(mint.opacity(0.55), lineWidth: 1.5)
                    // Vertical ribbon down the front.
                    Rectangle()
                        .fill(mint.opacity(0.75))
                        .frame(width: boxW * 0.13)
                }
                .frame(width: boxW, height: boxH)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                // ── lid ───────────────────────────────────────────────
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(mint.opacity(0.30))
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(mint.opacity(0.7), lineWidth: 1.5)
                    Rectangle()
                        .fill(mint.opacity(0.85))
                        .frame(width: boxW * 0.13)
                }
                .frame(width: boxW * 1.1, height: lidH)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .top) { Bow(mint: mint).frame(width: w * 0.34, height: w * 0.17).offset(y: -w * 0.13) }
                // Lift, tilt and drift off to the side when the gift opens.
                .offset(y: opened ? -(boxH + lidH * 2.4) : -(boxH - lidH * 0.1))
                .offset(x: opened ? w * 0.16 : 0)
                .rotationEffect(.degrees(opened ? 16 : 0), anchor: .bottomLeading)
                .opacity(opened ? 0.85 : 1)
            }
            .frame(width: w, height: geo.size.height, alignment: .bottom)
        }
    }
}

/// Two loops and a knot. Simple arcs rather than an SF Symbol so it matches the
/// box's stroke weight exactly.
private struct Bow: View {
    let mint: Color
    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            ZStack {
                Ellipse()
                    .stroke(mint.opacity(0.8), lineWidth: 1.5)
                    .frame(width: w * 0.44, height: h * 0.78)
                    .rotationEffect(.degrees(-24))
                    .offset(x: -w * 0.19)
                Ellipse()
                    .stroke(mint.opacity(0.8), lineWidth: 1.5)
                    .frame(width: w * 0.44, height: h * 0.78)
                    .rotationEffect(.degrees(24))
                    .offset(x: w * 0.19)
                Circle()
                    .fill(mint.opacity(0.9))
                    .frame(width: w * 0.13, height: w * 0.13)
            }
            .frame(width: w, height: h, alignment: .bottom)
        }
    }
}
