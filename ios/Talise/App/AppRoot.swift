import SwiftUI

/// Top-level coordinator. Switches between sign-in, KYC, and the
/// authenticated tab bar depending on `AppSession.phase`.
struct AppRoot: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Group {
            switch session.phase {
            case .launching:
                LaunchView()
            case .signedOut:
                SignInView()
            case .onboarding(let user):
                KYCView(user: user)
            case .ready:
                MainTabView()
            case .locked:
                LaunchView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: phaseKey)
    }

    private var phaseKey: String {
        switch session.phase {
        case .launching: return "launching"
        case .signedOut: return "signedOut"
        case .onboarding(let user): return "onboarding-\(user.id)"
        case .ready: return "ready"
        case .locked: return "locked"
        }
    }
}

private struct LaunchView: View {
    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            Text("Talise")
                .font(TaliseFont.heading(28))
                .foregroundStyle(TaliseColor.fg)
        }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            SendView()
                .tabItem { Label("Send", systemImage: "arrow.up.right") }
            ReceiveView()
                .tabItem { Label("Receive", systemImage: "arrow.down.left") }
            EarnView()
                .tabItem { Label("Earn", systemImage: "chart.line.uptrend.xyaxis") }
            RewardsView()
                .tabItem { Label("Rewards", systemImage: "gift.fill") }
        }
        .tint(TaliseColor.fg)
    }
}
