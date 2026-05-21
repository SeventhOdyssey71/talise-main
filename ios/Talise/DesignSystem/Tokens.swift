import SwiftUI

enum TaliseColor {
    static let bg = Color(hex: 0xFFFFFF)
    static let surface = Color(hex: 0xFFFFFF)
    static let surface2 = Color(hex: 0xF5F5F5)
    static let fg = Color(hex: 0x0A0A0A)
    static let fgMuted = Color(hex: 0x525252)
    static let fgDim = Color(hex: 0xA3A3A3)
    static let line = Color(hex: 0xE5E5E5)
    static let accent = Color(hex: 0x0A0A0A)
    static let accentSoft = Color(hex: 0x2A2A2A)
    static let live = Color(hex: 0x404040)
    static let success = Color(hex: 0x21A179)
    static let warmGold = Color(hex: 0xC08A3E)
    static let danger = Color(hex: 0xA05A3E)
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
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
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
