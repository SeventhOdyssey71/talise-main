import SwiftUI
import CoreText

@main
struct TaliseApp: App {
    @State private var session = AppSession()
    @Environment(\.scenePhase) private var scenePhase
    @State private var locked = false

    init() {
        Self.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            AppRoot()
                .environment(session)
                .task { await session.bootstrap() }
                .overlay {
                    if locked {
                        AppLockOverlay()
                            .transition(.opacity)
                    }
                }
                .onOpenURL { url in
                    // talise://auth/callback handled inside the
                    // ASWebAuthenticationSession completion. Reserved here
                    // for talise://pay/<handle>?amount=... in future.
                }
                .onChange(of: scenePhase) { _, newPhase in
                    switch newPhase {
                    case .background, .inactive:
                        locked = true
                    case .active:
                        locked = false
                    @unknown default:
                        break
                    }
                }
        }
    }

    /// Registers Google Sans Variable (bundled at Resources/GoogleSans).
    /// If the .ttf isn't present in dev, fonts fall back to SF Pro and the
    /// app still works.
    private static func registerFonts() {
        let names = ["GoogleSans-Variable.ttf"]
        for name in names {
            let parts = name.split(separator: ".")
            guard parts.count == 2,
                  let url = Bundle.main.url(forResource: String(parts[0]), withExtension: String(parts[1])) else {
                continue
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

private struct AppLockOverlay: View {
    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(TaliseColor.fgDim)
                Text("Talise")
                    .font(TaliseFont.heading(20))
                    .foregroundStyle(TaliseColor.fg)
            }
        }
    }
}
