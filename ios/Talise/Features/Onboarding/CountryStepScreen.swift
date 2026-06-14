import SwiftUI

/// Onboarding "Where are you based?" step. Captures the user's country so the
/// ramps gate correctly (a Nigerian gets Nigeria cash-out; others see "coming
/// soon"). Persists via the additive `/api/me/country` endpoint — it sets ONLY
/// the country, never `account_type`, so it can't interfere with sign-up
/// completion. Skips cleanly on any network error (country defaults to NG).
struct CountryStepScreen: View {
    var onContinue: () -> Void

    @State private var selected = "NG"
    @State private var saving = false

    // Real ISO alpha-2 codes (each has a circular flag in Assets/Flags).
    private let countries: [(String, String)] = [
        ("NG", "Nigeria"),
        ("GH", "Ghana"),
        ("KE", "Kenya"),
        ("ZA", "South Africa"),
        ("US", "United States"),
        ("GB", "United Kingdom"),
    ]

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                OnboardingProgressBar(totalSteps: 5, currentStep: 3)
                    .padding(.top, 8)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Where are you based?")
                        .font(TaliseFont.display(28, weight: .medium))
                        .kerning(-0.7)
                        .foregroundStyle(TaliseColor.fg)
                    Text("So we show the right ways to add money and cash out for you.")
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 28)

                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(countries, id: \.0) { code, name in
                            Button {
                                selected = code
                                UISelectionFeedbackGenerator().selectionChanged()
                            } label: {
                                HStack(spacing: 14) {
                                    RoundedFlag(code: code, size: 36)
                                    Text(name)
                                        .font(TaliseFont.heading(16, weight: .medium))
                                        .foregroundStyle(TaliseColor.fg)
                                    Spacer()
                                    if selected == code {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(TaliseColor.greenMint)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                                .background(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .fill(TaliseColor.surface)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .strokeBorder(
                                            selected == code ? TaliseColor.greenMint.opacity(0.5) : TaliseColor.line,
                                            lineWidth: 1
                                        )
                                )
                                .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 22)
                }

                Button {
                    Task { await saveAndContinue() }
                } label: {
                    HStack(spacing: 8) {
                        if saving {
                            ProgressView().controlSize(.small).tint(Color(hex: 0x0A140C))
                        } else {
                            Text("Continue")
                                .font(TaliseFont.heading(16, weight: .medium))
                        }
                    }
                    .foregroundStyle(Color(hex: 0x0A140C))
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(TaliseColor.greenMint))
                }
                .buttonStyle(.plain)
                .disabled(saving)
                .padding(.bottom, 20)
            }
            .padding(.horizontal, 24)
        }
    }

    private func saveAndContinue() async {
        saving = true
        // Best-effort persist — never blocks onboarding. Gating defaults to NG
        // if this doesn't land, so a failure degrades gracefully.
        struct Body: Encodable { let country: String }
        struct Resp: Decodable { let ok: Bool? }
        _ = try? await APIClient.shared.post("/api/me/country", body: Body(country: selected)) as Resp
        saving = false
        onContinue()
    }
}
