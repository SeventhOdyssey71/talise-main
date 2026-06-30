import Foundation
import SwiftUI

/// Plan 12 — view model for the streaming chat tab.
///
/// Owns the transcript, the in-flight `URLSession.bytes(for:)` task,
/// and the incremental decoder. The view binds to `messages`, `input`,
/// and `streaming`. All mutations happen on the main actor so SwiftUI
/// observes them cleanly during a token stream.
@MainActor
@Observable
final class ChatViewModel {
    /// Transcript shown in the UI. Newest at the end. Persisted to
    /// Keychain on every assistant-stream completion.
    var messages: [ChatMessage] = []
    /// Bound to the input pill at the bottom of the chat tab.
    var input: String = ""
    /// True while we are reading from the SSE stream (or waiting for the
    /// first byte). The view disables the send button and hides the
    /// suggested-prompts strip while this is true.
    var streaming: Bool = false
    /// Surface-level error banner. Cleared on the next submit.
    var lastError: String?

    private var streamTask: Task<Void, Never>?

    /// Bytes received on the last stream — used to distinguish a transport
    /// failure (0 bytes) from a parse failure (>0 bytes) when a turn comes back empty.
    private var lastStreamBytes = 0

    /// Un-stripped accumulator per in-flight assistant message. We keep the
    /// FULL raw stream (including the `---INTENT---…---END---` fence) here and
    /// derive the displayed `content` from it each delta — both so a fence
    /// split across SSE chunks never flashes half-rendered JSON, and so we can
    /// parse the intent once the stream completes. Cleared on finalize.
    private var streamRaw: [UUID: String] = [:]

    /// Saved past chats, newest-first — shown in the compact history sheet.
    var conversations: [ChatConversation] = []
    /// The chat currently on screen. A fresh chat gets a new id, only saved
    /// once it has a real message.
    private(set) var currentId = UUID()

    // The agent always OPENS on a fresh chat (no auto-reload of the last
    // transcript, so nothing piles up), but completed chats are saved to the
    // history list so they're one tap away.
    init() {
        conversations = ChatConversationStore.shared.loadAll()
    }

    /// Start a fresh chat (the previous one is already in `conversations`).
    func newChat() {
        streamTask?.cancel(); streamTask = nil
        streaming = false
        currentId = UUID()
        messages = []
        streamRaw = [:]
        lastError = nil
    }

    /// Open a saved chat from the history sheet.
    func open(_ id: UUID) {
        streamTask?.cancel(); streamTask = nil
        streaming = false
        streamRaw = [:]
        lastError = nil
        if let c = conversations.first(where: { $0.id == id }) {
            currentId = c.id
            messages = c.messages
        }
    }

    /// Delete a saved chat.
    func deleteConversation(_ id: UUID) {
        conversations.removeAll { $0.id == id }
        ChatConversationStore.shared.saveAll(conversations)
        if id == currentId { newChat() }
    }

    /// Upsert the current transcript into history. No-op for a blank chat.
    private func persistCurrent() {
        let real = messages.filter { !($0.role == .assistant && $0.streaming) }
        guard let firstUser = real.first(where: { $0.role == .user }) else { return }
        let raw = firstUser.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = raw.isEmpty ? "New chat" : String(raw.prefix(48))
        let convo = ChatConversation(id: currentId, title: title, messages: real, updatedAt: Date())
        conversations.removeAll { $0.id == currentId }
        conversations.insert(convo, at: 0)
        ChatConversationStore.shared.saveAll(conversations)
    }

    /// User tapped a suggested-prompt chip. Drop the prompt into the
    /// input field rather than auto-submitting — gives the user a chance
    /// to edit the wording before sending.
    func fillPrompt(_ text: String) {
        input = text
    }

    /// Submit the current input. No-op if empty or already streaming.
    func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !streaming else { return }

        lastError = nil
        let userMessage = ChatMessage(role: .user, content: text)
        messages.append(userMessage)
        input = ""

        // Insert a placeholder assistant message that we'll mutate as
        // SSE deltas arrive. SwiftUI re-renders the same row in place.
        let assistantId = UUID()
        messages.append(
            ChatMessage(id: assistantId, role: .assistant, content: "", streaming: true)
        )

        streaming = true
        streamTask = Task { [weak self] in
            await self?.runStream(assistantId: assistantId)
        }
    }

    private func runStream(assistantId: UUID) async {
        defer {
            streaming = false
            streamTask = nil
        }

        // Build request -------------------------------------------------
        guard let url = URL(string: AppConfig.shared.apiBaseURL + "/api/chat/stream") else {
            finalizeWithError(assistantId: assistantId, message: "Bad chat URL")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        // Generous timeout: the model can take a few seconds to first token, and
        // SSE holds the connection open. The default 60s was tripping "request
        // timed out" before the fast non-thinking model landed.
        req.timeoutInterval = 120
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let bearer = SecureSessionStore.shared.read() {
            req.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        }
        // Send only the persisted-cap window of prior turns — the route
        // also caps server-side, but trimming here saves bandwidth.
        let payload = ChatRequestBody(
            messages: messages
                .filter { $0.streaming == false || $0.role == .user }
                .map {
                    ChatRequestBody.Message(role: $0.role.rawValue, content: $0.content)
                }
        )
        do {
            req.httpBody = try JSONEncoder().encode(payload)
        } catch {
            finalizeWithError(assistantId: assistantId, message: "Encode failure")
            return
        }

        // Fetch --------------------------------------------------------
        // We read the WHOLE response body at once via `data(for:)` rather than
        // iterating the byte stream. On device the incremental SSE reader was
        // silently dropping every frame (200 OK, zero text). The route finishes
        // fast (non-thinking model, ~1s), and the "thinking" dots cover the wait.
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                let snippet = String(data: data.prefix(240), encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let detail = snippet.isEmpty ? "" : ": \(snippet)"
                finalizeWithError(
                    assistantId: assistantId,
                    message: "server returned \(http.statusCode)\(detail)"
                )
                return
            }
            lastStreamBytes = data.count
            // The body is Server-Sent Events: `data: {json}\n\n` frames. Split on
            // the blank-line boundary and handle each frame (text deltas append;
            // intent is parsed in finalize).
            let body = String(data: data, encoding: .utf8) ?? ""
            for frame in body.components(separatedBy: "\n\n") where !frame.isEmpty {
                await handleSseFrame(Data(frame.utf8), assistantId: assistantId)
            }
        } catch {
            if Task.isCancelled { return }
            finalizeWithError(assistantId: assistantId, message: error.localizedDescription)
            return
        }

        finalize(assistantId: assistantId)
    }

    /// Parse one SSE frame: take its `data:` lines, strip the prefix (+ one
    /// optional space, + a trailing `\r`), concatenate, and JSON-decode.
    private func handleSseFrame(_ frameData: Data, assistantId: UUID) async {
        guard let frame = String(data: frameData, encoding: .utf8) else { return }
        var datas: [String] = []
        for raw in frame.split(separator: "\n", omittingEmptySubsequences: false) {
            var line = String(raw)
            if line.hasSuffix("\r") { line.removeLast() }
            guard line.hasPrefix("data:") else { continue }
            var payload = String(line.dropFirst(5))
            if payload.first == " " { payload.removeFirst() }
            datas.append(payload)
        }
        let payload = datas.joined(separator: "\n")
        guard !payload.isEmpty, payload != "[DONE]" else { return }
        await handleEventJSON(payload, assistantId: assistantId)
    }

    private func handleEventJSON(_ raw: String, assistantId: UUID) async {
        guard
            let data = raw.data(using: .utf8),
            let any = try? JSONSerialization.jsonObject(with: data),
            let obj = any as? [String: Any],
            let event = ChatStreamEvent.decode(obj)
        else {
            return
        }
        switch event {
        case .text(let value):
            appendAssistant(text: value, id: assistantId)
        case .toolUse:
            // Tool-use events are informational. We don't render them
            // inline for now — the assistant's follow-up text already
            // grounds the answer. Future: show a tiny "looked up your
            // balance" chip above the bubble.
            break
        case .done:
            // No-op — `runStream` finalizes after the stream ends.
            break
        }
    }

    private func appendAssistant(text: String, id: UUID) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        // The Talise agent emits structured `---INTENT---{...}---END---`
        // blocks inline. They're the agent's machine-readable payload
        // (Payment Intents the app can execute on confirm), not text for
        // the user. We accumulate the FULL raw stream (fence included) in
        // `streamRaw` and derive the displayed `content` by stripping the
        // fence each delta — so the bubble shows only prose even while the
        // block streams in, and so `finalize` can parse the closed intent.
        let raw = (streamRaw[id] ?? "") + text
        streamRaw[id] = raw
        messages[idx].content = stripIntentBlocks(raw)
    }

    /// Removes any `---INTENT---{json}---END---` fence (and trailing
    /// blank lines it leaves) from a string. Handles partial blocks
    /// mid-stream: an open fence with no closing tag yet is trimmed
    /// to the last newline before the fence, so we don't flash a half-
    /// rendered `---INTENT---{"steps":[…` to the user.
    private func stripIntentBlocks(_ s: String) -> String {
        var out = s
        // Full closed fences — remove all of them (the agent can emit
        // more than one in a single turn).
        while let openRange = out.range(of: "---INTENT---") {
            if let closeRange = out.range(
                of: "---END---", range: openRange.upperBound..<out.endIndex
            ) {
                out.removeSubrange(openRange.lowerBound..<closeRange.upperBound)
            } else {
                // Open fence with no close yet — we're still mid-stream.
                // Hide from the open marker to the end of the buffer so
                // the user never sees `---INTENT---{…` partially.
                out.removeSubrange(openRange.lowerBound..<out.endIndex)
                break
            }
        }
        // Collapse the blank lines fences typically leave behind.
        return out
            .replacingOccurrences(of: "\n\n\n", with: "\n\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func finalize(assistantId: UUID) {
        if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
            messages[idx].streaming = false
            // Parse the agent's intent block (if any) from the full raw
            // stream now that it's closed — the UI renders an
            // `AgentIntentCard` beneath the bubble.
            if let raw = streamRaw[assistantId] {
                messages[idx].intent = AgentIntentParser.parse(raw)
            }
            // An empty turn with no action card means the stream closed with no
            // text + no intent. Show an honest, visible note rather than silently
            // removing it (which reads as a broken "nothing").
            if messages[idx].content.isEmpty && messages[idx].intent == nil {
                messages[idx].content = lastStreamBytes == 0
                    ? "I didn't get a reply. Nothing came back from the server, try again."
                    : "I got a response but couldn't read it. Try again."
            }
        }
        streamRaw[assistantId] = nil
        persistCurrent()
    }


    private func finalizeWithError(assistantId: UUID, message: String) {
        if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
            messages[idx].streaming = false
            if messages[idx].content.isEmpty {
                messages[idx].content = "Couldn't reach the assistant. \(message)"
            }
        }
        lastError = message
        streamRaw[assistantId] = nil
        persistCurrent()
    }
}
