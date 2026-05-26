import SwiftUI

/// Talise color tokens. Now sourced from `Assets.xcassets/Colors/*.colorset`
/// with light + dark appearances baked into each asset, so colors swap
/// automatically when the user (or system) flips appearance. The
/// app-wide theme override lives in `@AppStorage("preferredColorScheme")`
/// and is applied at the AppRoot via `.preferredColorScheme(...)`.
///
/// Property names match the pre-asset palette so callers keep compiling.
enum TaliseColor {
    static let bg = Color("BgPrimary")                          // page background
    static let surface = Color("Surface")                       // activity card
    static let surface2 = Color("Surface2")                     // small action buttons (+/send)
    static let surfaceGlass = Color("SurfaceGlass")             // username card + nav pill
    static let surfaceGlassStrong = Color("SurfaceGlassStrong") // active nav pill
    static let usernameCard = Color("UsernameCard")             // username card fill
    static let fg = Color("FgPrimary")                          // primary text
    static let fgSubtle = Color("FgSubtle")                     // jude@talise text
    static let fgMuted = Color("FgMuted")
    static let fgDim = Color("FgDim")
    static let line = Color("Line")
    static let accent = Color("Accent")                         // brand green
    static let accentSoft = Color("AccentSoft")
    static let live = Color("Live")
    static let success = Color("Success")
    static let warmGold = Color("WarmGold")
    static let danger = Color("Danger")

    // Activity row badge backgrounds.
    static let badgeSent = Color("BadgeSent")
    static let badgeReceived = Color("BadgeReceived")
    static let badgeNeutral = Color("BadgeNeutral")

    // --- Liquid Glass support tokens ---
    //
    // These weren't in the pre-asset palette because the glass recipes
    // hard-coded `Color.white.opacity(...)` and `Color.black.opacity(...)`.
    // In light mode those white-on-white strokes / black-on-white tints
    // read wrong, so we route them through assets with mode-specific values.

    /// Top stop of the specular highlight gradient on glass surfaces.
    /// Dark mode: white@~0.24. Light mode: black@~0.12.
    static let strokeSpecularTop = Color("StrokeSpecularTop")
    /// Middle stop — dimmest part of the specular gradient.
    static let strokeSpecularMid = Color("StrokeSpecularMid")
    /// Bottom stop — small return-bright at the lower edge.
    static let strokeSpecularBottom = Color("StrokeSpecularBottom")
    /// Tint that sits on top of `.ultraThinMaterial` to pull it into
    /// the right luminosity bucket. Dark mode: black@0.42; light: white@0.55.
    static let glassTint = Color("GlassTint")
    /// Slightly heavier variant used for full-screen sheets.
    static let glassTintSheet = Color("GlassTintSheet")
    /// Press-pulse overlay color for `LiquidGlassPressStyle`. Dark: white@0.08; light: black@0.08.
    static let pressPulse = Color("PressPulse")
    /// Sign-out destructive foreground / fill base (Profile).
    static let signOutFg = Color("SignOutFg")
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
