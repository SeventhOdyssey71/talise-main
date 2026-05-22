import SwiftUI

/// Dark-mode palette. Sourced directly from Figma node 42-1819
/// (Home design). The web product is still light mode — when we add a
/// shared design system across both platforms we'll thread these through
/// `@Environment(\.colorScheme)`; for now iOS is dark by spec.
enum TaliseColor {
    static let bg = Color(hex: 0x000000)                          // page background
    static let surface = Color(hex: 0x252525)                     // activity card
    static let surface2 = Color(hex: 0x3E3E3E)                    // small action buttons (+/send)
    static let surfaceGlass = Color.white.opacity(0.08)           // username card + nav pill
    static let surfaceGlassStrong = Color.white.opacity(0.14)     // active nav pill
    static let usernameCard = Color(hex: 0x504F4F).opacity(0.2)   // username card fill (matches Figma rgba(80,79,79,0.2))
    static let fg = Color(hex: 0xFFFFFF)                          // primary text
    static let fgSubtle = Color(hex: 0xFAFAFA)                    // jude@talise text
    static let fgMuted = Color(hex: 0xB5B5B5)
    static let fgDim = Color(hex: 0x636363)
    static let line = Color.white.opacity(0.08)
    static let accent = Color(hex: 0x79D96C)                      // "Earn up to 11%" green
    static let accentSoft = Color(hex: 0x2A2A2A)
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
