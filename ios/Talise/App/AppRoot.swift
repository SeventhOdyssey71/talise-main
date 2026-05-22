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
    enum Tab: Hashable { case home, invest, rewards, profile }
    @State private var tab: Tab = .home
    @State private var sendSheetVisible = false
    @State private var receiveSheetVisible = false
    @State private var claimSheetVisible = false

    /// True whenever ANY sheet is being presented over the tab content.
    /// Drives the blur applied to the underlying tab — the system sheet
    /// only dims by default; this makes the background read as a true
    /// glass blur, matching the Figma's depth treatment.
    private var anySheetUp: Bool {
        sendSheetVisible || receiveSheetVisible || claimSheetVisible
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            TaliseColor.bg.ignoresSafeArea()

            Group {
                switch tab {
                case .home: HomeView()
                case .invest: EarnView()
                case .rewards: RewardsView()
                case .profile: ProfileView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .blur(radius: anySheetUp ? 14 : 0)
            .animation(.easeInOut(duration: 0.22), value: anySheetUp)
            .allowsHitTesting(!anySheetUp)

            BottomNavPill(active: $tab)
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
                .blur(radius: anySheetUp ? 14 : 0)
                .animation(.easeInOut(duration: 0.22), value: anySheetUp)
        }
        .sheet(isPresented: $sendSheetVisible) {
            SendView(onDone: { sendSheetVisible = false })
                .presentationDetents([.large])
                .presentationBackground(TaliseColor.bg)
        }
        .sheet(isPresented: $receiveSheetVisible) {
            ReceiveView()
                .presentationDetents([.medium, .large])
                .presentationBackground(TaliseColor.bg)
        }
        .sheet(isPresented: $claimSheetVisible) {
            ClaimHandleSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(TaliseColor.bg)
        }
        .onReceive(NotificationCenter.default.publisher(for: .taliseRequestSendSheet)) { _ in
            sendSheetVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .taliseRequestReceiveSheet)) { _ in
            receiveSheetVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .taliseRequestClaimSheet)) { _ in
            claimSheetVisible = true
        }
    }
}

extension Notification.Name {
    static let taliseRequestReceiveSheet = Notification.Name("io.talise.requestReceiveSheet")
    static let taliseRequestClaimSheet = Notification.Name("io.talise.requestClaimSheet")
}

/// Floating pill nav with the Figma's "Glass" treatment.
///
/// Layering, outer → inner:
///  1. `.ultraThinMaterial` capsule — system glass blur backdrop.
///  2. A subtle dark tint on top of the material so it reads dark mode
///     (the system material alone is too neutral against a black bg).
///  3. Top + bottom hairlines for the refraction/edge feel from Figma:
///     top stroke is white-translucent (specular highlight); bottom is
///     a darker stroke to give the pill thickness.
///  4. Drop shadow under the whole pill for depth against the page bg.
///
/// The active tab gets its own smaller capsule with a stronger material
/// fill + white top hairline so it pops out of the pill — matches the
/// "Home" inset in the Figma reference.
private struct BottomNavPill: View {
    @Binding var active: MainTabView.Tab

    var body: some View {
        HStack(spacing: 4) {
            tabButton(.home, icon: "house.fill", label: "Home")
            tabButton(.invest, icon: "leaf.fill", label: "Invest")
            tabButton(.rewards, icon: "gift.fill", label: "Rewards")
            tabButton(.profile, icon: "person.crop.circle.fill", label: "Profile")
        }
        .padding(.horizontal, 6)
        .frame(height: 64)
        .background(
            ZStack {
                // System glass blur — captures whatever sits behind the
                // pill (the activity card, the page bg).
                Capsule().fill(.ultraThinMaterial)
                // Dark tint pulls it into dark-mode territory. Without
                // this, .ultraThinMaterial reads too light.
                Capsule().fill(Color.black.opacity(0.45))
            }
        )
        .overlay(
            // Top specular highlight — thin white hairline.
            Capsule()
                .strokeBorder(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.22),
                            Color.white.opacity(0.04),
                            Color.white.opacity(0.10),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
        )
        .shadow(color: Color.black.opacity(0.6), radius: 24, x: 0, y: 10)
        .shadow(color: Color.black.opacity(0.4), radius: 4, x: 0, y: 2)
    }

    private func tabButton(_ which: MainTabView.Tab, icon: String, label: String) -> some View {
        let isActive = active == which
        return Button {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.78)) {
                active = which
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
                Text(label)
                    .font(TaliseFont.body(10, weight: .regular))
                    .kerning(-0.36)
                    .foregroundStyle(TaliseColor.fg)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(activeBackdrop(isActive))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func activeBackdrop(_ isActive: Bool) -> some View {
        if isActive {
            ZStack {
                Capsule().fill(.ultraThinMaterial)
                Capsule().fill(Color.white.opacity(0.10))
                Capsule()
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.35),
                                Color.white.opacity(0.05),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
            }
            // Tiny inset so the active capsule clearly nests inside the
            // outer pill (the Figma effect).
            .padding(.vertical, 2)
        } else {
            Color.clear
        }
    }
}
