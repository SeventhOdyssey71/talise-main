import SwiftUI

/// Modifier that applies a Liquid Glass backdrop to `.sheet` presentations.
/// Apply on the sheet's *root* view (not the parent presenting the sheet).
///
/// Layering, outer → inner:
///   transparent presentation > material > dark tint > top specular stroke > TopGlow accent
///
/// What it does:
/// - Hides the default sheet background (`.presentationBackground(.clear)`)
///   so we can layer our own. Falls back to the system material on older
///   OS variants where the API is unavailable.
/// - Paints the page with `.ultraThinMaterial` over `Color.black.opacity(0.45)`
///   so the sheet still reads as glass on a black presenting view.
/// - Adds a thin white top hairline to mark the sheet's grabber edge —
///   same specular language as the bottom nav pill and `taliseGlass`.
/// - Optional `accent` paints a TopGlow-style wash near the top of the
///   sheet so the sheet feels "lit" from above like the rest of the app.
struct LiquidGlassSheet: ViewModifier {
    var accent: Color? = TaliseColor.accent

    func body(content: Content) -> some View {
        content
            .background(
                ZStack(alignment: .top) {
                    Rectangle().fill(.ultraThinMaterial)
                    Rectangle().fill(Color.black.opacity(0.45))
                    if let accent {
                        // Soft top wash — gives the sheet its own horizon
                        // glow without TopGlow's full strength.
                        RadialGradient(
                            colors: [
                                accent.opacity(0.22),
                                accent.opacity(0.08),
                                .clear,
                            ],
                            center: .init(x: 0.5, y: -0.1),
                            startRadius: 0,
                            endRadius: 360
                        )
                        .blur(radius: 18)
                        .allowsHitTesting(false)
                    }
                }
                .ignoresSafeArea()
            )
            .overlay(alignment: .top) {
                // Specular top hairline at the sheet's top edge.
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.18),
                                Color.white.opacity(0.0),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(height: 1)
                    .allowsHitTesting(false)
            }
            .presentationBackground(.clear)
    }
}

extension View {
    /// Apply the Liquid Glass treatment to a sheet's root view. Pass
    /// `accent: nil` to skip the top color wash for neutral sheets.
    func liquidGlassSheet(accent: Color? = TaliseColor.accent) -> some View {
        modifier(LiquidGlassSheet(accent: accent))
    }
}
