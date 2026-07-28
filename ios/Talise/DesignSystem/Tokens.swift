import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// ADAPTIVE palette. Every token is a light/dark pair resolved per trait at
/// draw time, so the ~2,000 `TaliseColor.…` call sites across the app switch
/// theme without a single edit at the call site. Dark values are the original
/// Figma node 42-1819 palette; light values are the Talise light system
/// (white ground, #000000/#666666 text hierarchy, grey filled cards) with the
/// brand FOREST kept for CTAs and accents so light mode still reads as Talise
/// rather than a generic white fintech app.
enum TaliseColor {
    static let bg = Color(light: 0xFFFFFF, dark: 0x000000)                 // page background
    static let surface = Color(light: 0xF5F5F5, dark: 0x161616)            // filled card (activity, sheets, panels)
    static let surface2 = Color(light: 0xEBEBEB, dark: 0x242424)           // raised fill (chips, small action buttons)
    // Glassmorphism is retired — these are SOLID surfaces on both themes.
    static let surfaceGlass = Color(light: 0xF5F5F5, dark: 0x1C1C1C)       // flat card / nav pill
    static let surfaceGlassStrong = Color(light: 0xE4E4E4, dark: 0x2C2C2C) // active nav pill (raised)
    static let usernameCard = Color(light: 0xF5F5F5, dark: 0x161616)       // flat username card
    static let fg = Color(light: 0x000000, dark: 0xFFFFFF)                 // primary text
    static let fgSubtle = Color(light: 0x141414, dark: 0xFAFAFA)
    static let fgMuted = Color(light: 0x666666, dark: 0xB5B5B5)            // secondary text
    static let fgDim = Color(light: 0x8E8E8E, dark: 0x636363)              // tertiary / micro labels
    /// Hairline. Black-on-light, white-on-dark, both at low alpha.
    static let line = Color(light: 0x000000, dark: 0xFFFFFF, lightAlpha: 0.10, darkAlpha: 0.08)
    /// Accent green. The dark value is a bright mint-green that would nearly
    /// vanish on white, so light mode uses brand forest instead.
    static let accent = Color(light: 0x2F6A1F, dark: 0x79D96C)
    static let accentSoft = Color(light: 0xEAF3E6, dark: 0x2A2A2A)
    // The two canonical Talise brand greens (matches web/app/globals.css).
    // `greenMint` reads as an accent ON DARK; on light it must become forest or
    // it disappears (mint on white is invisible as text/icon).
    static let greenMint = Color(light: 0x2F6A1F, dark: 0xCAFFB8)
    static let greenDeep = Color(light: 0x2F6A1F, dark: 0x4B8A37)          // forest — solid CTA fill (white text)
    static let live = Color(light: 0x1E7B34, dark: 0x79D96C)
    static let success = Color(light: 0x1E7B34, dark: 0x79D96C)
    static let warmGold = Color(light: 0x8A5E20, dark: 0xC08A3E)
    static let danger = Color(light: 0xB03A24, dark: 0xA05A3E)

    /// Tint for the Talise mark. The shipped PNG is a WHITE glyph with alpha, so
    /// on light it must be re-tinted or the logo disappears into the page. Forest
    /// (not black) keeps it the brand mark, matching the marketing treatment.
    static let logoTint = Color(light: 0x2F6A1F, dark: 0xFFFFFF)

    // Activity row badge backgrounds. Dark = muted Figma fills; light = pale
    // tints so the row reads as a soft chip on white.
    static let badgeSent = Color(light: 0xF7E4E0, dark: 0x6C3A38, lightAlpha: 1.0, darkAlpha: 0.5)
    static let badgeReceived = Color(light: 0xE3F1E5, dark: 0x355F40, lightAlpha: 1.0, darkAlpha: 0.5)
    static let badgeNeutral = Color(light: 0xEDEDED, dark: 0x4A4A4A, lightAlpha: 1.0, darkAlpha: 0.6)
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

    /// A light/dark PAIR resolved per trait at draw time.
    ///
    /// This is what lets one edit to `TaliseColor` re-theme the whole app: the
    /// value is a dynamic `UIColor` under the hood, so a `.foregroundStyle(
    /// TaliseColor.fg)` written for dark mode automatically flips on light —
    /// no `@Environment(\.colorScheme)` plumbing at ~2,000 call sites.
    init(light: UInt32, dark: UInt32, lightAlpha: Double = 1, darkAlpha: Double = 1) {
        #if canImport(UIKit)
        self = Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(rgb: dark, alpha: darkAlpha)
                : UIColor(rgb: light, alpha: lightAlpha)
        })
        #else
        self = Color(hex: light).opacity(lightAlpha)
        #endif
    }
}

#if canImport(UIKit)
private extension UIColor {
    convenience init(rgb: UInt32, alpha: Double) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
            green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
            blue: CGFloat(rgb & 0xFF) / 255.0,
            alpha: CGFloat(alpha)
        )
    }
}
#endif

// MARK: - Flat surface helpers (glassmorphism retired)
//
// Glassmorphism is retired. This enum kept ONLY so the 100+ existing call
// sites (`TaliseGlass.edge`, `.topSheen`, `.wash(...)`, etc.) keep compiling —
// every member now returns a FLAT, calm value: a hairline color, a clear
// (no-op) fill, or a quiet solid tint. No more specular gradients, no white
// sheens, no diagonal washes. The Apple-system flat look.
enum TaliseGlass {
    /// Was a bright specular edge stroke; now a single flat hairline color.
    /// Used as a `strokeBorder` so a `LinearGradient`-shaped API still works
    /// — but it's a uniform `TaliseColor.line` (no top-to-bottom highlight).
    static let edge = LinearGradient(colors: [TaliseColor.line, TaliseColor.line], startPoint: .top, endPoint: .bottom)

    /// Was a quieter specular edge; now the same flat hairline.
    static let edgeSoft = LinearGradient(colors: [TaliseColor.line, TaliseColor.line], startPoint: .top, endPoint: .bottom)

    /// Was an interior white "crown" sheen; now a clear (no-op) fill so any
    /// `.fill(TaliseGlass.topSheen)` paints nothing.
    static let topSheen = LinearGradient(colors: [Color.clear, Color.clear], startPoint: .top, endPoint: .bottom)

    /// Was a soft ambient float shadow; now fully transparent so any
    /// `.shadow(color: TaliseGlass.shadow, …)` renders nothing.
    static let shadow = Color.clear

    /// Was a diagonal brand wash; now a quiet FLAT solid tint at a low
    /// opacity — same call signature, but a single uniform color (no
    /// gradient, no fade).
    static func wash(_ color: Color, strength: Double = 0.16) -> LinearGradient {
        let c = color.opacity(min(strength, 0.14))
        return LinearGradient(colors: [c, c], startPoint: .top, endPoint: .bottom)
    }
}

extension TaliseColor {
    /// Was a dimensional CTA gradient; now a FLAT solid forest fill. Kept as
    /// a `LinearGradient` (two identical stops) so `.fill(TaliseColor.greenCTA)`
    /// call sites compile unchanged while rendering a clean solid pill.
    static let greenCTA = LinearGradient(colors: [greenDeep, greenDeep], startPoint: .top, endPoint: .bottom)

    /// Was a mint→deep sweep; now a FLAT solid accent fill (uniform two-stop
    /// gradient) for progress fills — calm, no neon sweep.
    static let greenSweep = LinearGradient(colors: [accent, accent], startPoint: .leading, endPoint: .trailing)
}
