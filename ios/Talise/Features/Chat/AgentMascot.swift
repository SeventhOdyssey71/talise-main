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
    /// Explicit body colour. When nil (the default), the mascot wears the
    /// user's chosen Copilot skin, so changing the skin recolours it live
    /// everywhere it's shown (Home, Chat) via the Observation framework.
    var tint: Color? = nil

    @State private var blink = false
    @State private var lift = false
    @State private var sway = false   // head tilt + 3D rotate
    @State private var look: CGFloat = 0  // eyes glance left/right occasionally

    private var deep: Color { TaliseColor.bg }              // deep-ink face features
    private var mint: Color { tint ?? CopilotSkin.shared.color } // brick body / skin

    var body: some View {
        ZStack {
            // 3D head — a soft squircle with spherical shading: a top-left
            // specular highlight, bottom volume shadow, and a rim light. No
            // studs/ears, just a clean dimensional face.
            RoundedRectangle(cornerRadius: size * 0.40, style: .continuous)
                .fill(mint)
                .overlay(  // spherical highlight (top-left light source)
                    RadialGradient(
                        colors: [.white.opacity(0.55), .white.opacity(0.0)],
                        center: UnitPoint(x: 0.32, y: 0.26),
                        startRadius: 0, endRadius: size * 0.58
                    )
                )
                .overlay(  // volume shading toward the bottom
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.20)],
                        startPoint: .center, endPoint: .bottom
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: size * 0.40, style: .continuous))
                .overlay(  // rim light: bright top edge easing to a soft bottom
                    RoundedRectangle(cornerRadius: size * 0.40, style: .continuous)
                        .strokeBorder(
                            LinearGradient(
                                colors: [.white.opacity(0.55), .white.opacity(0.04)],
                                startPoint: .top, endPoint: .bottom
                            ),
                            lineWidth: max(0.5, size * 0.02)
                        )
                )
                .frame(width: size * 0.84, height: size * 0.80)
                .shadow(color: .black.opacity(0.28), radius: size * 0.07, y: size * 0.045)

            // Face: two eyes over a soft smile. Eyes glance with `look`.
            VStack(spacing: size * 0.085) {
                HStack(spacing: size * 0.17) {
                    eye
                    eye
                }
                .offset(x: look * size)
                smile
            }
            .offset(y: size * 0.02)
        }
        .frame(width: size, height: size)
        .offset(y: lift ? -size * 0.03 : 0)
        // Lively idle: a gentle head sway + a touch of real 3D rotation.
        .rotationEffect(.degrees(sway ? 3 : -3))
        .rotation3DEffect(.degrees(sway ? 10 : -10), axis: (x: 0.2, y: 1, z: 0))
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

    // One eye — a deep-ink rounded pill with a tiny catch-light for life.
    private var eye: some View {
        RoundedRectangle(cornerRadius: size * 0.06, style: .continuous)
            .fill(deep)
            .frame(width: size * 0.12, height: blink ? size * 0.02 : size * 0.16)
            .overlay(alignment: .topTrailing) {
                if !blink {
                    Circle()
                        .fill(.white.opacity(0.85))
                        .frame(width: size * 0.035, height: size * 0.035)
                        .padding(.top, size * 0.02)
                        .padding(.trailing, size * 0.015)
                }
            }
    }

    // A gentle upward smile, drawn as a rounded arc.
    private var smile: some View {
        SmileArc()
            .stroke(deep, style: StrokeStyle(lineWidth: size * 0.05, lineCap: .round))
            .frame(width: size * 0.26, height: size * 0.12)
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

/// A gentle upward-curving smile — a single quad curve that dips at the centre.
private struct SmileArc: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.midX, y: rect.maxY)
        )
        return p
    }
}
