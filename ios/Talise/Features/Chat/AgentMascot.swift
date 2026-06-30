import SwiftUI

/// Talise Agent mascot — a clean, lego-style blocky assistant drawn entirely in
/// SwiftUI (crisp at any size, tints to the brand palette, animates cheaply).
///
/// A mint "brick" head with two studs on top, friendly deep-green eyes and a
/// small smile. Used as the Home top-bar agent entry (small, static) and the
/// chat empty-state hero (large, gently animated).
struct AgentMascot: View {
    var size: CGFloat = 40
    /// Gentle idle blink + float — on for the large hero, off for the chip.
    var animated: Bool = false

    @State private var blink = false
    @State private var lift = false
    @State private var sway = false   // head tilt + 3D rotate
    @State private var look: CGFloat = 0  // eyes glance left/right occasionally

    private var deep: Color { TaliseColor.bg }        // deep-green face features
    private var mint: Color { TaliseColor.greenMint } // brick body

    var body: some View {
        ZStack {
            // Two lego studs sitting on top of the head.
            HStack(spacing: size * 0.14) {
                stud
                stud
            }
            .offset(y: -size * 0.32)

            // Head brick.
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [mint, mint.opacity(0.82)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: size * 0.80, height: size * 0.64)
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                        .strokeBorder(.white.opacity(0.22), lineWidth: max(0.5, size * 0.015))
                )

            // Face: two eyes over a small smile. Eyes glance with `look`.
            VStack(spacing: size * 0.085) {
                HStack(spacing: size * 0.15) {
                    eye
                    eye
                }
                .offset(x: look * size)
                Capsule(style: .continuous)
                    .fill(deep)
                    .frame(width: size * 0.18, height: size * 0.045)
            }
            .offset(y: size * 0.04)
        }
        .frame(width: size, height: size)
        .offset(y: lift ? -size * 0.03 : 0)
        // Lively idle: a gentle head sway + a touch of 3D rotation for depth.
        .rotationEffect(.degrees(sway ? 3.5 : -3.5))
        .rotation3DEffect(.degrees(sway ? 9 : -9), axis: (x: 0.25, y: 1, z: 0))
        .onAppear {
            guard animated else { return }
            withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
                lift = true
            }
            withAnimation(.easeInOut(duration: 3.4).repeatForever(autoreverses: true)) {
                sway = true
            }
            scheduleBlink()
            scheduleLook()
        }
    }

    // A single lego stud: a mint cap with a soft top highlight + hairline edge.
    private var stud: some View {
        RoundedRectangle(cornerRadius: size * 0.07, style: .continuous)
            .fill(mint)
            .frame(width: size * 0.20, height: size * 0.13)
            .overlay(alignment: .top) {
                Capsule()
                    .fill(.white.opacity(0.30))
                    .frame(width: size * 0.12, height: size * 0.035)
                    .padding(.top, size * 0.025)
            }
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.07, style: .continuous)
                    .strokeBorder(deep.opacity(0.12), lineWidth: 0.5)
            )
    }

    private var eye: some View {
        RoundedRectangle(cornerRadius: size * 0.06, style: .continuous)
            .fill(deep)
            .frame(width: size * 0.11, height: blink ? size * 0.02 : size * 0.14)
    }

    private func scheduleBlink() {
        DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 2.5...5.5)) {
            withAnimation(.easeInOut(duration: 0.12)) { blink = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.13) {
                withAnimation(.easeInOut(duration: 0.12)) { blink = false }
                scheduleBlink()
            }
        }
    }

    // Every few seconds the eyes glance to one side, then re-center — a little
    // "looking around" beat on top of the sway.
    private func scheduleLook() {
        DispatchQueue.main.asyncAfter(deadline: .now() + Double.random(in: 3.0...6.0)) {
            let dir: CGFloat = Bool.random() ? 0.045 : -0.045
            withAnimation(.easeInOut(duration: 0.4)) { look = dir }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                withAnimation(.easeInOut(duration: 0.4)) { look = 0 }
                scheduleLook()
            }
        }
    }
}
