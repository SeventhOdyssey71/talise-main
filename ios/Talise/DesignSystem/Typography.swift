import SwiftUI
import UIKit

/// Figma node 42-1819 uses DM Sans (Light/Regular/Medium with opsz 14)
/// for display + body, and JetBrains Mono (ExtraLight/Light) for the
/// micro-labels ($0.00 FEE, YOUR MONEY LANDS HERE, timestamps, Details).
///
/// To bundle the actual .ttf files: drop them under
/// `Resources/DMSans/` and `Resources/JetBrainsMono/` and register from
/// TaliseApp.registerFonts(). Until then everything falls back to SF Pro
/// / SF Mono — visually close enough that the layout reads right.
enum TaliseFont {
    // PostScript family name from the registered variable .ttf (verified
    // via `fc-scan` on the bundled `Resources/DMSans/DMSans-Variable.ttf`
    // — the family carries a space, the file name doesn't).
    static let displayFamily = "DM Sans"
    static let monoFamily = "JetBrainsMono"

    static func display(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        custom(displayFamily, size: size, fallbackDesign: .default, weight: weight)
    }

    static func heading(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        custom(displayFamily, size: size, fallbackDesign: .default, weight: weight)
    }

    static func body(_ size: CGFloat = 14, weight: Font.Weight = .light) -> Font {
        custom(displayFamily, size: size, fallbackDesign: .default, weight: weight)
    }

    static func mono(_ size: CGFloat = 11, weight: Font.Weight = .regular) -> Font {
        // Default weight bumped to .regular (was .light) so monospaced
        // subtexts ("Balance", "$0.00 FEE", "YOUR MONEY LANDS HERE")
        // read with proper presence on screen. Light JetBrains Mono
        // reads as washed-out at small sizes against dark backgrounds.
        custom(monoFamily, size: size, fallbackDesign: .monospaced, weight: weight)
    }

    private static func custom(
        _ family: String,
        size: CGFloat,
        fallbackDesign: Font.Design,
        weight: Font.Weight
    ) -> Font {
        if UIFont(name: family, size: size) != nil {
            return .custom(family, size: size).weight(weight)
        }
        return .system(size: size, weight: weight, design: fallbackDesign)
    }
}

/// JetBrains-Mono micro-label, uppercase tracking 0.22em — for "$0.00 FEE",
/// "YOUR MONEY LANDS HERE", and timestamps in activity rows.
struct MicroLabel: View {
    let text: String
    var color: Color = TaliseColor.fg
    var size: CGFloat = 8

    var body: some View {
        Text(text)
            .font(TaliseFont.mono(size, weight: .regular))
            .kerning(-0.32)
            .foregroundStyle(color)
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(TaliseFont.mono(10, weight: .regular))
            .tracking(2.0)
            .foregroundStyle(TaliseColor.fgDim)
    }
}
