import SwiftUI

/// Plan 12 — the AI finance chat tab.
///
/// Layout (top → bottom):
///   1. Greeting header (time-of-day aware, first-name from /api/me).
///      Subtitle: "Let's make sense of your numbers."
///   2. Scrollable transcript. User bubbles right-aligned in accent green,
///      assistant bubbles left-aligned in surface gray. Auto-scrolls to
///      the newest message as SSE deltas arrive.
///   3. Suggested-prompt chips (only when the transcript is empty AND no
///      stream is in flight — they get out of the way after the first turn).
///   4. "Ask anything" input pill — glass capsule, submit on return.
///
/// Streaming token rendering happens entirely inside `ChatViewModel` —
/// the view just observes `messages` and re-renders. The bottom nav pill
/// from `MainTabView` floats over the input so we add bottom safe padding.
struct ChatTabView: View {
    @Environment(AppSession.self) private var session
    @State private var vm = ChatViewModel()
    @FocusState private var inputFocused: Bool
    /// Set when presented modally (e.g. from the Home mascot) — shows a close
    /// affordance and drops the floating-nav bottom padding. nil = tab usage.
    var onClose: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.top, 8)

            transcript

            if vm.messages.isEmpty && !vm.streaming {
                suggestedPrompts
                    .padding(.horizontal, 24)
                    .padding(.bottom, 8)
            }

            inputPill
                .padding(.horizontal, 24)
                // Float above the bottom nav pill (≈ 84pt) when used as a tab;
                // when presented modally there's no nav pill, so sit lower.
                .padding(.bottom, onClose != nil ? 28 : 110)
        }
        .padding(.top, onClose != nil ? 12 : 0)
        .background(TaliseColor.bg.ignoresSafeArea())
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            AgentMascot(size: 34)
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting)
                    .font(TaliseFont.heading(23, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text("Let's make sense of your numbers.")
                    .font(TaliseFont.body(13.5, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            Spacer(minLength: 8)
            // Just a close button — nothing else (per the design ask).
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .frame(width: 34, height: 34)
                        .background(.ultraThinMaterial, in: Circle())
                        .overlay(Circle().strokeBorder(.white.opacity(0.12), lineWidth: 0.5))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let slot: String
        switch hour {
        case 5..<12: slot = "Good morning"
        case 12..<17: slot = "Good afternoon"
        case 17..<22: slot = "Good evening"
        default: slot = "Hey"
        }
        let name = firstName(from: session.phase) ?? "there"
        return "\(slot), \(name)"
    }

    private func firstName(from phase: AppSession.Phase) -> String? {
        let n: String?
        switch phase {
        case .ready(let user): n = user.name
        case .onboarding(let user): n = user.name
        default: n = nil
        }
        guard let raw = n?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty
        else { return nil }
        return raw.split(separator: " ").first.map(String.init)
    }

    // MARK: - Transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if vm.messages.isEmpty {
                        emptyState
                            .padding(.top, 60)
                    } else {
                        ForEach(vm.messages) { msg in
                            row(for: msg).id(msg.id)
                        }
                    }
                    Color.clear.frame(height: 8).id(scrollAnchorId)
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
            }
            .onChange(of: vm.messages.last?.id) { _, _ in
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo(scrollAnchorId, anchor: .bottom)
                }
            }
            .onChange(of: vm.messages.last?.content) { _, _ in
                // Newest tokens trickling in — keep the tail pinned.
                proxy.scrollTo(scrollAnchorId, anchor: .bottom)
            }
        }
    }

    private let scrollAnchorId = "chat-bottom"

    private var emptyState: some View {
        VStack(spacing: 16) {
            AgentMascot(size: 76, animated: true)
            Text("Ask me anything about your money.")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .frame(maxWidth: .infinity)
    }

    /// One transcript row: the prose bubble (when there's text or it's still
    /// streaming) plus, once the stream closes, the Talise Agent action card
    /// for any parsed intent. A pure-intent turn shows just the card.
    @ViewBuilder
    private func row(for msg: ChatMessage) -> some View {
        VStack(alignment: msg.role == .user ? .trailing : .leading, spacing: 8) {
            if msg.role == .assistant && msg.streaming && msg.content.isEmpty {
                // Proper "thinking" loader — staggered pulsing dots where the
                // reply will land (the model reasons/streams with a real pause).
                TypingDots()
            } else if !msg.content.isEmpty || msg.streaming {
                bubble(for: msg)
            }
            if let intent = msg.intent, !msg.streaming {
                AgentIntentCard(intent: intent)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: msg.role == .user ? .trailing : .leading)
    }

    /// User turns are a compact right-aligned accent pill (brand "your turn").
    /// Assistant turns render as clean, full-width left-aligned PROSE — no
    /// bubble plate — the ChatGPT-style read.
    @ViewBuilder
    private func bubble(for msg: ChatMessage) -> some View {
        if msg.role == .user {
            HStack {
                Spacer(minLength: 40)
                Text(msg.content)
                    .font(TaliseFont.body(15, weight: .regular))
                    .foregroundStyle(Color.black)
                    .multilineTextAlignment(.leading)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 14)
                    .background(TaliseColor.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        } else {
            Text(msg.content + (msg.streaming ? " ▍" : ""))
                .font(TaliseFont.body(15.5, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .lineSpacing(3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    /// Three staggered pulsing dots — the assistant "thinking" indicator.
    private struct TypingDots: View {
        @State private var animating = false
        var body: some View {
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(TaliseColor.fgMuted)
                        .frame(width: 6, height: 6)
                        .scaleEffect(animating ? 1 : 0.55)
                        .opacity(animating ? 1 : 0.4)
                        .animation(
                            .easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.2),
                            value: animating
                        )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
            .onAppear { animating = true }
        }
    }

    // MARK: - Suggested prompts

    private var suggestedPrompts: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.suggested, id: \.self) { prompt in
                    LiquidGlassPill(title: prompt) {
                        vm.fillPrompt(prompt)
                        inputFocused = true
                    }
                }
            }
            .padding(.horizontal, 6)
        }
    }

    private static let suggested: [String] = [
        "Am I undercharging on fees?",
        "Where's most of my money going?",
        "Should I move more to earnings?",
    ]

    // MARK: - Input pill

    private var inputPill: some View {
        HStack(spacing: 10) {
            TextField(
                "Ask anything",
                text: Binding(
                    get: { vm.input },
                    set: { vm.input = $0 }
                ),
                axis: .horizontal
            )
            .focused($inputFocused)
            .submitLabel(.send)
            .onSubmit { vm.send() }
            .font(TaliseFont.body(15, weight: .regular))
            .foregroundStyle(TaliseColor.fg)
            .tint(TaliseColor.accent)
            .disabled(vm.streaming)

            Button {
                vm.send()
            } label: {
                Image(systemName: vm.streaming ? "ellipsis" : "arrow.up")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.black)
                    .frame(width: 32, height: 32)
                    .background(
                        Circle().fill(
                            vm.input.isEmpty || vm.streaming
                                ? TaliseColor.fgDim
                                : TaliseColor.accent
                        )
                    )
            }
            .buttonStyle(.plain)
            .disabled(vm.input.isEmpty || vm.streaming)
        }
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(Capsule().fill(TaliseColor.surface2))
        .clipShape(Capsule())
    }
}
