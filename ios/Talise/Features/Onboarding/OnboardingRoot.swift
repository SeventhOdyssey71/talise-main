import SwiftUI

/// Pre-auth coordinator: drives the user from launch splash through the
/// brand intro carousel, Google sign-in, KYC-tier picker, and a brief
/// completion screen. After Free-tier is picked (or the user signs in
/// with an existing account that already has a tier locally), control
/// is handed back to `AppSession` which will then route to either the
/// existing `KYCView` (country + account-type — that's Plan 11 territory)
/// or to `MainTabView`.
///
/// State machine is a plain enum + a single `@State step` so the file
/// reads top-to-bottom. Transitions use SwiftUI's built-in transition
/// modifiers — `.opacity` for the splash hand-off, `.slide` for the rest
/// of the flow.
enum OnboardingStep: Hashable {
    case splash
    case welcome
    case intro1
    case intro2
    case intro3
    case signIn
    case kycTier
    case done
}

struct OnboardingRoot: View {
    @Environment(AppSession.self) private var session
    @State private var step: OnboardingStep = .splash
    /// Carried from the SignIn screen into the KYC-tier picker so we can
    /// finalize the session phase only after the user has chosen a tier
    /// (or skipped past the upgrade prompts).
    @State private var signedInUser: UserDTO?

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()

            Group {
                switch step {
                case .splash:
                    SplashView(onAdvance: { advance(to: .welcome) })
                        .transition(.opacity)
                case .welcome:
                    WelcomeView(onContinue: { advance(to: .intro1) })
                        .transition(.opacity)
                case .intro1, .intro2, .intro3:
                    BrandIntroCarousel(
                        selection: Binding(
                            get: { step },
                            set: { newStep in advance(to: newStep) }
                        ),
                        onContinue: { advance(to: .signIn) }
                    )
                    .transition(.slide)
                case .signIn:
                    SignInScreen(onSignedIn: { user in
                        signedInUser = user
                        advance(to: .kycTier)
                    })
                    .transition(.slide)
                case .kycTier:
                    KycTierPicker(onFreeChosen: { handleTierSelected() })
                        .transition(.slide)
                case .done:
                    OnboardingCompletedView(onDismiss: { finish() })
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.32), value: step)
        }
    }

    private func advance(to next: OnboardingStep) {
        withAnimation(.easeInOut(duration: 0.32)) {
            step = next
        }
    }

    private func handleTierSelected() {
        // Persist the chosen tier locally — Plan 11 will wire this to the
        // backend `/api/kyc` once Sumsub lands.
        UserDefaults.standard.set("free", forKey: "talise.kyc_tier")
        NotificationCenter.default.post(
            name: Notification.Name("io.talise.onboardingCompleted"),
            object: nil
        )
        advance(to: .done)
    }

    private func finish() {
        // Hand control back to AppSession. If signIn populated the user,
        // route via handleSignedIn (preserves the existing AppSession
        // onboarding → ready transition for country + account-type).
        // Otherwise — defensive fallback — kick a bootstrap.
        if let user = signedInUser {
            session.handleSignedIn(user: user)
        } else {
            Task { await session.bootstrap() }
        }
    }
}
