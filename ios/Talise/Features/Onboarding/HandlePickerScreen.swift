import SwiftUI

/// Step 2/4 of the post-Welcome onboarding: pick a `*.talise.sui` username.
///
/// Visual: `OnboardingBackground` + top progress bar (step 2 of 4) +
/// left-aligned title/subtitle + a text field with a muted `.talise.sui`
/// suffix + primary "Continue" CTA pinned near the bottom.
///
/// Validation: ≥3 chars, lowercase alphanumeric only, no spaces. The
/// CTA stays disabled until the handle parses.
///
/// Persistence trade-off (see report): no dedicated "reserve at
/// onboarding" endpoint exists today — the canonical mint happens
/// later via `/api/handle/retarget`. So we stash the chosen handle in
/// UserDefaults under `talise.onboarding.handle` and the next post-auth
/// hop can pick it up. Server-side reservation can be wired later by
/// flipping a single call site.
struct HandlePickerScreen: View {
    let onContinue: (String) -> Void

    @State private var handle: String = ""
    @FocusState private var fieldFocused: Bool

    private func kern(_ size: CGFloat) -> CGFloat { -size * 0.03 }

    private var sanitized: String {
        handle
            .lowercased()
            .filter { $0.isLetter || $0.isNumber }
    }

    private var isValid: Bool {
        sanitized.count >= 3 && sanitized.count <= 24
    }

    var body: some View {
        ZStack(alignment: .top) {
            OnboardingBackground()

            VStack(spacing: 0) {
                OnboardingProgressBar(totalSteps: 5, currentStep: 2)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Create a username")
                        .font(TaliseFont.heading(23.5, weight: .semibold))
                        .kerning(kern(23.5))
                        .foregroundStyle(TaliseColor.fg)
                        .multilineTextAlignment(.leading)

                    Text("Usernames are used for your Talise ID, for swift identification and verification.")
                        .font(TaliseFont.body(13, weight: .light))
                        .kerning(kern(13))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .lineSpacing(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 28)

                handleField
                    .padding(.horizontal, 24)
                    .padding(.top, 28)

                Spacer(minLength: 0)

                primaryCTA
                    .padding(.horizontal, 24)
                    .padding(.bottom, 28)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            // Restore in-progress handle if user backgrounded mid-flow.
            if let saved = UserDefaults.standard.string(forKey: "talise.onboarding.handle"),
               !saved.isEmpty {
                handle = saved
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                fieldFocused = true
            }
        }
    }

    // MARK: - Subviews

    private var handleField: some View {
        HStack(spacing: 0) {
            TextField("", text: $handle, prompt: Text("yourname").foregroundColor(TaliseColor.fgDim))
                .focused($fieldFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .keyboardType(.asciiCapable)
                .font(TaliseFont.body(16, weight: .medium))
                .kerning(kern(16))
                .foregroundStyle(TaliseColor.fg)
                .submitLabel(.done)
                .onChange(of: handle) { _, newValue in
                    let s = newValue
                        .lowercased()
                        .filter { $0.isLetter || $0.isNumber }
                    if s != newValue { handle = s }
                }

            Text(".talise.sui")
                .font(TaliseFont.body(15, weight: .light))
                .kerning(kern(15))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .padding(.horizontal, 18)
        .frame(height: 54)
        .background(
            RoundedRectangle(cornerRadius: 27, style: .continuous)
                .fill(Color.white.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 27, style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        )
    }

    private var primaryCTA: some View {
        Button {
            UserDefaults.standard.set(sanitized, forKey: "talise.onboarding.handle")
            onContinue(sanitized)
        } label: {
            Text("Continue")
                .font(TaliseFont.body(15, weight: .medium))
                .kerning(kern(15))
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(isValid ? TaliseColor.accent : TaliseColor.accent.opacity(0.4))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!isValid)
        .animation(.easeInOut(duration: 0.18), value: isValid)
    }
}
