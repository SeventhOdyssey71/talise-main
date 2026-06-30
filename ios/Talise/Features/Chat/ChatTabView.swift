import SwiftUI
import UIKit

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
    @State private var historyOpen = false
    /// Set when presented modally (e.g. from the Home mascot) — shows a close
    /// affordance and drops the floating-nav bottom padding. nil = tab usage.
    var onClose: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.top, 8)

            transcript

            inputPill
                .padding(.horizontal, 24)
                // Float above the bottom nav pill (≈ 84pt) when used as a tab;
                // when presented modally there's no nav pill, so sit lower.
                .padding(.bottom, onClose != nil ? 28 : 110)
        }
        .padding(.top, onClose != nil ? 12 : 0)
        .background(TaliseColor.bg.ignoresSafeArea())
        .sheet(isPresented: $historyOpen) {
            ChatHistorySheet(vm: vm, onPick: { historyOpen = false })
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(TaliseColor.bg)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            AgentMascot(size: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(greeting)
                    .font(TaliseFont.heading(19, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text("Let's make sense of your numbers.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 8)
            // A little history (recent chats) + close.
            circleButton("clock", label: "History") { historyOpen = true }
            if let onClose {
                circleButton("xmark", label: "Close", action: onClose)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func circleButton(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: systemName == "xmark" ? 14 : 15, weight: .semibold))
                .foregroundStyle(TaliseColor.fgMuted)
                .frame(width: 34, height: 34)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.12), lineWidth: 0.5))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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
                            .padding(.top, 16)
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
        VStack(spacing: 14) {
            // Hero: just the mascot, no glow.
            AgentMascot(size: 62, animated: true)
            VStack(spacing: 5) {
                Text("Your money, made simple.")
                    .font(TaliseFont.heading(20, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .multilineTextAlignment(.center)
                Text("Ask me anything about your money and I'll help you make sense of it.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 290)
            }
            // A clean, well-spaced 2x2 suggestion grid (4 starters).
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 14) {
                ForEach(Self.gridSuggestions) { s in suggestionCard(s) }
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
    }

    private func suggestionCard(_ s: Suggestion) -> some View {
        Button {
            vm.fillPrompt(s.prompt); inputFocused = true
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                iconTile(s.icon)
                Spacer(minLength: 8)
                Text(s.title)
                    .font(TaliseFont.body(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text(s.subtitle)
                    .font(TaliseFont.body(11, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .lineLimit(1)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
            .background(suggestionBackground)
        }
        .buttonStyle(.plain)
    }

    // Clean green icon tile (unified — no multicolor).
    private func iconTile(_ systemName: String) -> some View {
        RoundedRectangle(cornerRadius: 11, style: .continuous)
            .fill(TaliseColor.greenMint.opacity(0.16))
            .frame(width: 38, height: 38)
            .overlay(
                Image(systemName: systemName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(TaliseColor.greenMint)
            )
    }

    private var suggestionBackground: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(TaliseColor.surface2)
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(.white.opacity(0.06), lineWidth: 0.5)
            )
    }

    /// One transcript row: the prose bubble (when there's text or it's still
    /// streaming) plus, once the stream closes, the Talise Agent action card
    /// for any parsed intent. A pure-intent turn shows just the card.
    @ViewBuilder
    private func row(for msg: ChatMessage) -> some View {
        if msg.role == .user {
            VStack(alignment: .trailing, spacing: 3) {
                HStack {
                    Spacer(minLength: 48)
                    Text(msg.content)
                        .font(TaliseFont.body(15, weight: .medium))
                        .foregroundStyle(TaliseColor.bg)
                        .multilineTextAlignment(.leading)
                        .padding(.vertical, 10).padding(.horizontal, 14)
                        .background(TaliseColor.greenMint)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                messageMeta(date: msg.date, sent: true)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            // Assistant turn: a small mascot avatar beside a dark chat bubble.
            HStack(alignment: .top, spacing: 8) {
                AgentMascot(size: 30, animated: false)
                VStack(alignment: .leading, spacing: 6) {
                    if msg.streaming && msg.content.isEmpty {
                        TypingDots()
                    } else if !msg.content.isEmpty || msg.streaming {
                        assistantBubble(msg)
                        if !msg.streaming { messageMeta(date: msg.date, sent: false) }
                    }
                    if let intent = msg.intent, !msg.streaming {
                        AgentIntentCard(
                            intent: intent,
                            executed: msg.executed,
                            onExecuted: { results in vm.recordExecution(messageId: msg.id, results: results) }
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if !msg.streaming, !msg.content.isEmpty {
                        HStack(spacing: 2) {
                            rowAction("doc.on.doc", "Copy") { UIPasteboard.general.string = msg.content }
                            rowAction("arrow.clockwise", "Regenerate") { vm.regenerate(messageId: msg.id) }
                        }
                    }
                }
                Spacer(minLength: 20)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Small timestamp (+ a read-receipt double-check on sent user turns).
    @ViewBuilder
    private func messageMeta(date: Date?, sent: Bool) -> some View {
        HStack(spacing: 4) {
            if let date {
                Text(timeString(date))
                    .font(TaliseFont.mono(10, weight: .regular))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            if sent {
                HStack(spacing: -3) {
                    Image(systemName: "checkmark").font(.system(size: 8, weight: .bold))
                    Image(systemName: "checkmark").font(.system(size: 8, weight: .bold))
                }
                .foregroundStyle(TaliseColor.greenMint)
            }
        }
        .padding(.horizontal, 4)
    }

    private func timeString(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "h:mm a"; return f.string(from: date)
    }

    private func rowAction(_ systemName: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(TaliseColor.fgDim)
                .frame(width: 30, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    /// Assistant turns render in a dark chat bubble (markdown rendered so
    /// **bold** / links / arrows show cleanly, not literal asterisks).
    private func assistantBubble(_ msg: ChatMessage) -> some View {
        Text(markdown(msg.content + (msg.streaming ? " ▍" : "")))
            .font(TaliseFont.body(15, weight: .light))
            .foregroundStyle(TaliseColor.fg)
            .lineSpacing(3)
            .multilineTextAlignment(.leading)
            .padding(.vertical, 11).padding(.horizontal, 14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(TaliseColor.surface2)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(.white.opacity(0.06), lineWidth: 0.5)
                    )
            )
            .textSelection(.enabled)
    }

    /// Parse the assistant's inline markdown (bold/italic/links) while keeping
    /// line breaks. Falls back to plain text if parsing fails.
    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(s)
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

    /// A starter suggestion: a clean green icon, a title + subtitle, and the
    /// full prompt it drops into the composer on tap.
    struct Suggestion: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let subtitle: String
        let prompt: String
    }

    private static let gridSuggestions: [Suggestion] = [
        Suggestion(icon: "creditcard.fill", title: "Balance", subtitle: "See your total", prompt: "What's my balance?"),
        Suggestion(icon: "clock.arrow.circlepath", title: "Recent activity", subtitle: "Your latest moves", prompt: "Show my recent activity"),
        Suggestion(icon: "banknote.fill", title: "Save money", subtitle: "Into your savings", prompt: "I'd like to save some money"),
        Suggestion(icon: "building.columns.fill", title: "Cash out", subtitle: "To your bank", prompt: "Cash out to my bank account"),
    ]

    // MARK: - Input pill

    /// Clean composer: a text field and a send button. No attachments, no mic.
    private var inputPill: some View {
        HStack(spacing: 10) {
            TextField(
                "Ask anything",
                text: Binding(get: { vm.input }, set: { vm.input = $0 }),
                axis: .vertical
            )
            .lineLimit(1...5)
            .focused($inputFocused)
            .submitLabel(.send)
            .onSubmit { vm.send() }
            .font(TaliseFont.body(16, weight: .regular))
            .foregroundStyle(TaliseColor.fg)
            .tint(TaliseColor.accent)
            .disabled(vm.streaming)

            Button { vm.send() } label: {
                Image(systemName: vm.streaming ? "ellipsis" : "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.black)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(canSend ? TaliseColor.accent : TaliseColor.fgDim))
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(
            Capsule()
                .fill(TaliseColor.surface2)
                .overlay(Capsule().strokeBorder(.white.opacity(0.08), lineWidth: 0.5))
        )
    }

    private var canSend: Bool {
        !vm.streaming && !vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
