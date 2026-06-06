import SwiftUI

/// Dark-mode palette. Sourced directly from Figma node 42-1819
/// (Home design). The web product is still light mode — when we add a
/// shared design system across both platforms we'll thread these through
/// `@Environment(\.colorScheme)`; for now iOS is dark by spec.
enum TaliseColor {
    static let bg = Color(hex: 0x000000)                          // page background
    static let surface = Color(hex: 0x161616)                     // flat card surface (activity, sheets, panels)
    static let surface2 = Color(hex: 0x242424)                    // raised flat surface (chips, small action buttons)
    // Glassmorphism is retired. These two were translucent-white blurs
    // (`.white.opacity(0.08/0.14)`); they're now SOLID flat surfaces so every
    // card / nav pill that referenced them reads as a clean opaque panel.
    static let surfaceGlass = Color(hex: 0x1C1C1C)                // flat card / nav pill
    static let surfaceGlassStrong = Color(hex: 0x2C2C2C)          // active nav pill (raised)
    static let usernameCard = Color(hex: 0x161616)                // flat username card
    static let fg = Color(hex: 0xFFFFFF)                          // primary text
    static let fgSubtle = Color(hex: 0xFAFAFA)                    // jude@talise text
    static let fgMuted = Color(hex: 0xB5B5B5)
    static let fgDim = Color(hex: 0x636363)
    static let line = Color.white.opacity(0.08)
    static let accent = Color(hex: 0x79D96C)                      // "Earn up to 11%" green
    static let accentSoft = Color(hex: 0x2A2A2A)
    // The two canonical Talise brand greens (matches web/app/globals.css).
    // `greenMint` is the bright/mint accent that reads ON dark; `greenDeep`
    // is the forest CTA fill. Additive — existing surfaces keep `accent`.
    static let greenMint = Color(hex: 0xCAFFB8)                   // mint — readable accent on dark
    static let greenDeep = Color(hex: 0x4B8A37)                   // forest — solid CTA fill
    static let live = Color(hex: 0x79D96C)
    static let success = Color(hex: 0x79D96C)
    static let warmGold = Color(hex: 0xC08A3E)
    static let danger = Color(hex: 0xA05A3E)

    // Activity row badge backgrounds (extracted from the Figma Ellipse fills).
    static let badgeSent = Color(hex: 0x6C3A38).opacity(0.5)      // muted red
    static let badgeReceived = Color(hex: 0x355F40).opacity(0.5)  // muted green
    static let badgeNeutral = Color(hex: 0x4A4A4A).opacity(0.6)   // claim/invest
}

enum TaliseSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
}

enum TaliseRadius {
    static let sm: CGFloat = 10
    static let md: CGFloat = 14
    static let lg: CGFloat = 20
    static let xl: CGFloat = 25      // Figma uses 25 for big cards (activity + username)
    static let pill: CGFloat = 40    // bottom nav + active pill
}

enum TaliseHeight {
    static let buttonSm: CGFloat = 32
    static let buttonMd: CGFloat = 40
    static let buttonLg: CGFloat = 44
}

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}

// MARK: - iOS-26 Liquid Glass gradient + material helpers
//
// Additive only. These compose the new Apple-2026 "Liquid Glass" look —
// translucent fills, a soft top-down specular highlight stroke, a gentle
// brand wash. Existing `TaliseColor.*` names are untouched, so every
// feature view keeps compiling; these just give the LiquidGlass* components
// (and any view that wants the look) a shared vocabulary.
enum TaliseGlass {
    /// The specular edge stroke for a glass surface — a bright top highlight
    /// that fades to a near-invisible bottom edge. This is what reads as
    /// "lit from above" on the translucent material.
    static let edge = LinearGradient(
        colors: [
            Color.white.opacity(0.22),
            Color.white.opacity(0.06),
            Color.white.opacity(0.015),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// A quieter edge for small chrome (pills, knobs) where the bright
    /// highlight would otherwise dominate.
    static let edgeSoft = LinearGradient(
        colors: [
            Color.white.opacity(0.16),
            Color.white.opacity(0.04),
            Color.clear,
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// The interior top highlight — a faint white sheen pooled at the top
    /// inside the surface, fading out by ~40% height. Layer it over the
    /// material to give the glass a curved, polished crown.
    static let topSheen = LinearGradient(
        colors: [
            Color.white.opacity(0.10),
            Color.white.opacity(0.0),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Soft ambient shadow tuned for dark glass cards — deep but diffuse,
    /// so cards float a hair off the black canvas without a harsh halo.
    static let shadow = Color.black.opacity(0.55)

    /// A directional brand wash (for tinted glass) — a diagonal sweep of a
    /// color, brightest at the top-leading corner.
    static func wash(_ color: Color, strength: Double = 0.16) -> LinearGradient {
        LinearGradient(
            colors: [color.opacity(strength), color.opacity(strength * 0.25), .clear],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

extension TaliseColor {
    /// The canonical green CTA gradient — `greenDeep` deepening toward a
    /// darker forest at the bottom, so a filled primary button reads as a
    /// dimensional pill rather than a flat block.
    static let greenCTA = LinearGradient(
        colors: [Color(hex: 0x5BA343), Color(hex: 0x3C7A2C)],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Mint→deep accent sweep, for hero glints / progress fills that want a
    /// little brand life without going neon.
    static let greenSweep = LinearGradient(
        colors: [greenMint, greenDeep],
        startPoint: .leading,
        endPoint: .trailing
    )
}
