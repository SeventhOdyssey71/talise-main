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
        .preferredColorScheme(.dark)
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

/// Three-tab pill nav matching Figma node 42-1819. Home, Invest, Rewards
/// — Send and Receive live as actions on Home, not as nav destinations.
struct MainTabView: View {
    enum Tab: Hashable { case home, invest, rewards }
    @State private var tab: Tab = .home

    var body: some View {
        ZStack(alignment: .bottom) {
            TaliseColor.bg.ignoresSafeArea()

            Group {
                switch tab {
                case .home: HomeView()
                case .invest: EarnView()
                case .rewards: RewardsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            BottomNavPill(active: $tab)
                .padding(.horizontal, 49)
                .padding(.bottom, 20)
        }
    }
}

/// Floating pill nav. Filled with a soft white glass; the active tab gets
/// a smaller filled pill behind it (matches the Figma's nested rounded
/// rectangles at the bottom).
private struct BottomNavPill: View {
    @Binding var active: MainTabView.Tab

    var body: some View {
        HStack(spacing: 0) {
            tabButton(.home, icon: "house.fill", label: "Home")
            tabButton(.invest, icon: "leaf.fill", label: "Invest")
            tabButton(.rewards, icon: "gift.fill", label: "Rewards")
        }
        .padding(.horizontal, 10)
        .frame(height: 60)
        .background(
            Capsule().fill(TaliseColor.surfaceGlass)
        )
        .overlay(
            Capsule().stroke(Color.white.opacity(0.06), lineWidth: 1)
        )
    }

    private func tabButton(_ which: MainTabView.Tab, icon: String, label: String) -> some View {
        let isActive = active == which
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) { active = which }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
                Text(label)
                    .font(TaliseFont.body(9, weight: .regular))
                    .kerning(-0.36)
                    .foregroundStyle(TaliseColor.fg)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .background(
                Capsule()
                    .fill(isActive ? TaliseColor.surfaceGlassStrong : Color.clear)
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
