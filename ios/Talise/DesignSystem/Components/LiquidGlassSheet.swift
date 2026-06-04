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
                    // Solid opaque sheet surface — NO blur material. The sheet
                    // reads as a flat panel, not frosted glass.
                    Rectangle().fill(TaliseColor.bg)
                    if let accent {
                        // Quiet flat top wash (no blur) — a faint "lit from
                        // above" green tint matching the screens' TopGlow.
                        LinearGradient(
                            colors: [accent.opacity(0.10), .clear],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: 240)
                        .frame(maxWidth: .infinity, alignment: .top)
                        .allowsHitTesting(false)
                    }
                }
                .ignoresSafeArea()
            )
            .overlay(alignment: .top) {
                // Faint flat hairline at the sheet's top edge (grabber line).
                Rectangle()
                    .fill(TaliseColor.line)
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
