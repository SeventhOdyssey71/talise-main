import SwiftUI

/// Animated check used by `SendCompleteView`. Matches the
/// `AnimatedPaperPlane` aesthetic: gradient-stroke ring + check,
/// gentle floating motion, soft drop-shadow for depth. No expanding
/// halo / glow — the previous pulsing ring read as a system
/// notification instead of a confirmed transfer.
struct SendSuccessAnimation: View {
    var size: CGFloat = 120
    var color: Color = TaliseColor.accent

    @State private var ringProgress: CGFloat = 0
    @State private var checkProgress: CGFloat = 0
    @State private var float = false

    private var strokeGradient: LinearGradient {
        LinearGradient(
            colors: [color.opacity(0.9), color],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        ZStack {
            Circle()
                .trim(from: 0, to: ringProgress)
                .stroke(
                    strokeGradient,
                    style: StrokeStyle(lineWidth: 2.6, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .frame(width: size, height: size)

            CheckmarkPath()
                .trim(from: 0, to: checkProgress)
                .stroke(
                    strokeGradient,
                    style: StrokeStyle(
                        lineWidth: 3.2,
                        lineCap: .round,
                        lineJoin: .round
                    )
                )
                .frame(width: size * 0.50, height: size * 0.50)
        }
        .rotationEffect(.degrees(float ? -2 : 2))
        .offset(y: float ? -3 : 3)
        .shadow(color: color.opacity(0.35), radius: 14, x: 0, y: 6)
        .onAppear { runIn() }
    }

    private func runIn() {
        withAnimation(.easeOut(duration: 0.55)) { ringProgress = 1 }
        withAnimation(.easeOut(duration: 0.45).delay(0.45)) { checkProgress = 1 }
        withAnimation(
            .easeInOut(duration: 1.6).repeatForever(autoreverses: true)
        ) { float.toggle() }
    }
}

/// Two-segment checkmark, sized to its bounding box so it scales with
/// the parent Shape frame. Lives here (not in DesignSystem) because the
/// rest of the app doesn't need it yet.
struct CheckmarkPath: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let w = rect.width
        let h = rect.height
        p.move(to: CGPoint(x: w * 0.10, y: h * 0.55))
        p.addLine(to: CGPoint(x: w * 0.40, y: h * 0.82))
        p.addLine(to: CGPoint(x: w * 0.92, y: h * 0.20))
        return p
    }
}

private extension Comparable {
    func clamped(to limits: ClosedRange<Self>) -> Self {
        min(max(self, limits.lowerBound), limits.upperBound)
    }
}
