import SwiftUI
import UIKit

/// Google Sans Variable is bundled at Resources/GoogleSans/GoogleSans-Variable.ttf.
/// Register once at app launch (see TaliseApp.swift). If the font isn't bundled
/// in dev, every text style falls back to SF Pro and the app still ships.
enum TaliseFont {
    static let family = "GoogleSans"
    static let monoFamily = "JetBrainsMono"

    static func display(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        custom(size, weight: weight)
    }

    static func heading(_ size: CGFloat) -> Font {
        custom(size, weight: .medium)
    }

    static func body(_ size: CGFloat = 14) -> Font {
        custom(size, weight: .regular)
    }

    static func mono(_ size: CGFloat = 11, weight: Font.Weight = .medium) -> Font {
        if UIFont(name: monoFamily, size: size) != nil {
            return .custom(monoFamily, size: size).weight(weight)
        }
        return .system(size: size, weight: weight, design: .monospaced)
    }

    private static func custom(_ size: CGFloat, weight: Font.Weight) -> Font {
        if UIFont(name: family, size: size) != nil {
            return .custom(family, size: size).weight(weight)
        }
        return .system(size: size, weight: weight, design: .default)
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(TaliseFont.mono(10))
            .tracking(2.2)
            .foregroundStyle(TaliseColor.fgDim)
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 12) {
        Eyebrow(text: "Dashboard")
        Text("Total balance").font(TaliseFont.heading(22))
        Text("Send money across the globe.").font(TaliseFont.body(14))
            .foregroundStyle(TaliseColor.fgMuted)
    }
    .padding()
}
