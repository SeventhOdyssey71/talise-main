import SwiftUI

/// Animated checkmark used by `SendCompleteView`. The two stroke
/// segments (the circle ring + the check) trim from 0→1 on appear so
/// it reads as the chain confirmation drawing itself in.
struct SendSuccessAnimation: View {
    var size: CGFloat = 96
    var color: Color = TaliseColor.accent

    @State private var ringProgress: CGFloat = 0
    @State private var checkProgress: CGFloat = 0
    @State private var pulse: CGFloat = 0.6

    var body: some View {
        ZStack {
            // Soft halo behind the ring — a pulse on appear so the
            // moment of confirmation has weight.
            Circle()
                .fill(color.opacity(0.18))
                .frame(width: size * 1.4, height: size * 1.4)
                .scaleEffect(pulse)
                .opacity(Double(2 - pulse).clamped(to: 0...1))

            Circle()
                .trim(from: 0, to: ringProgress)
                .stroke(color, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .frame(width: size, height: size)

            CheckmarkPath()
                .trim(from: 0, to: checkProgress)
                .stroke(color, style: StrokeStyle(
                    lineWidth: 4, lineCap: .round, lineJoin: .round
                ))
                .frame(width: size * 0.55, height: size * 0.55)
        }
        .onAppear { runIn() }
    }

    private func runIn() {
        withAnimation(.easeOut(duration: 0.55)) {
            ringProgress = 1
        }
        withAnimation(.easeOut(duration: 0.45).delay(0.45)) {
            checkProgress = 1
        }
        withAnimation(.easeOut(duration: 0.9)) {
            pulse = 1.6
        }
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
