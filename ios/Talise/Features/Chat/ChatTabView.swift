import SwiftUI
import UIKit
import UniformTypeIdentifiers

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
    @State private var csvImporterOpen = false
    @State private var attachmentNote: String?
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
                AgentIntentCard(
                    intent: intent,
                    executed: msg.executed,
                    onExecuted: { results in vm.recordExecution(messageId: msg.id, results: results) }
                )
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // Quiet copy / regenerate row under a finished assistant reply.
            if msg.role == .assistant, !msg.streaming, !msg.content.isEmpty {
                HStack(spacing: 2) {
                    rowAction("doc.on.doc", "Copy") { UIPasteboard.general.string = msg.content }
                    rowAction("arrow.clockwise", "Regenerate") { vm.regenerate(messageId: msg.id) }
                }
                .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: msg.role == .user ? .trailing : .leading)
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

    /// User turns are a compact right-aligned accent pill (brand "your turn").
    /// Assistant turns render as clean, full-width left-aligned PROSE — no
    /// bubble plate — the ChatGPT-style read.
    @ViewBuilder
    private func bubble(for msg: ChatMessage) -> some View {
        if msg.role == .user {
            HStack {
                Spacer(minLength: 40)
                Text(msg.content)
                    .font(TaliseFont.body(15, weight: .medium))
                    .foregroundStyle(TaliseColor.bg)
                    .multilineTextAlignment(.leading)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 14)
                    .background(TaliseColor.greenMint)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        } else {
            // Render the assistant's markdown so **bold**, links, and arrows
            // show cleanly instead of literal asterisks.
            Text(markdown(msg.content + (msg.streaming ? " ▍" : "")))
                .font(TaliseFont.body(15.5, weight: .light))
                .foregroundStyle(TaliseColor.fg)
                .lineSpacing(3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
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

    private var suggestedPrompts: some View {
        // Short chips that wrap into rows — compact and all visible at once.
        // The chip shows a tight label but fills the input with the full prompt.
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(Self.suggested, id: \.label) { item in
                LiquidGlassPill(title: item.label) {
                    vm.fillPrompt(item.prompt)
                    inputFocused = true
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static let suggested: [(label: String, prompt: String)] = [
        ("Balance", "What's my balance?"),
        ("Best yield", "Where's the best yield right now?"),
        ("Recent activity", "Show my recent activity"),
        ("Save $50", "Move $50 into savings"),
        ("Cash out", "Cash out $20 to my bank account"),
    ]

    // MARK: - Input pill

    /// Two-row composer (ChatGPT-style): the field spans the top; a "+" for
    /// attaching a CSV sits bottom-left, and a mic/send control bottom-right.
    private var inputPill: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let note = attachmentNote {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text").font(.system(size: 11, weight: .medium))
                    Text(note).font(TaliseFont.body(12, weight: .medium)).lineLimit(1)
                    Button { attachmentNote = nil } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 12))
                    }
                    .buttonStyle(.plain)
                }
                .foregroundStyle(TaliseColor.fgMuted)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Capsule().fill(TaliseColor.surface2))
            }

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
            .padding(.top, 2)

            HStack(spacing: 12) {
                // "+" — attach a CSV (e.g. a payout list) to the conversation.
                Button { csvImporterOpen = true } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .frame(width: 32, height: 32)
                        .background(Circle().strokeBorder(.white.opacity(0.14), lineWidth: 1))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(vm.streaming)

                Spacer(minLength: 0)

                if vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !vm.streaming {
                    // Empty field → mic affordance (focuses the field so the
                    // keyboard's dictation can take over).
                    Button { inputFocused = true } label: {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(TaliseColor.fgMuted)
                            .frame(width: 34, height: 34)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                } else {
                    Button { vm.send() } label: {
                        Image(systemName: vm.streaming ? "ellipsis" : "arrow.up")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color.black)
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(vm.streaming ? TaliseColor.fgDim : TaliseColor.accent))
                    }
                    .buttonStyle(.plain)
                    .disabled(vm.streaming)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(TaliseColor.surface2)
                .overlay(
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 0.5)
                )
        )
        .fileImporter(
            isPresented: $csvImporterOpen,
            allowedContentTypes: [.commaSeparatedText, .plainText, UTType("public.comma-separated-values-text") ?? .plainText],
            allowsMultipleSelection: false
        ) { result in
            handleCSVImport(result)
        }
    }

    /// Read a picked CSV and fold it into the prompt so the agent has the rows
    /// to reason over (e.g. "here's a list of payouts"). Caps the inlined text
    /// so a huge file can't blow up the request.
    private func handleCSVImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else { return }
        let needsStop = url.startAccessingSecurityScopedResource()
        defer { if needsStop { url.stopAccessingSecurityScopedResource() } }
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else {
            attachmentNote = "Couldn't read that file."
            return
        }
        let trimmed = String(raw.prefix(4000)).trimmingCharacters(in: .whitespacesAndNewlines)
        let rows = raw.split(whereSeparator: \.isNewline).count
        attachmentNote = "\(url.lastPathComponent) · \(rows) rows"
        let lead = vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Here is a CSV I uploaded"
            : vm.input + "\n\nHere is a CSV I uploaded"
        vm.input = "\(lead) (\(url.lastPathComponent)):\n\(trimmed)"
        inputFocused = true
    }
}

/// A simple wrapping layout — chips flow left-to-right and wrap to a new line
/// when they run out of width. Used for the suggested-prompt chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            sub.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
