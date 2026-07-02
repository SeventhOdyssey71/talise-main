import SwiftUI

/// A little history — recent chats in a compact medium-detent sheet (not a
/// full-screen sidebar). Tap a row to reopen it; "New" starts fresh; swipe-free
/// delete on each row.
struct ChatHistorySheet: View {
    let vm: ChatViewModel
    var onPick: () -> Void

    @State private var query = ""

    private var filtered: [ChatConversation] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return vm.conversations }
        return vm.conversations.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Chats")
                    .font(TaliseFont.heading(20, weight: .semibold))
                    .foregroundStyle(TaliseColor.fg)
                Spacer()
                Button { vm.newChat(); onPick() } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.pencil").font(.system(size: 13, weight: .medium))
                        Text("New").font(TaliseFont.body(14, weight: .medium))
                    }
                    .foregroundStyle(TaliseColor.bg)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Capsule().fill(TaliseColor.greenMint))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            // Search — filter past chats by title.
            if !vm.conversations.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13))
                        .foregroundStyle(TaliseColor.fgDim)
                    TextField("Search chats", text: $query)
                        .font(TaliseFont.body(14))
                        .foregroundStyle(TaliseColor.fg)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if !query.isEmpty {
                        Button { query = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(TaliseColor.fgDim)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(TaliseColor.surface))
                .padding(.horizontal, 20).padding(.bottom, 10)
            }

            if vm.conversations.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "clock")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                    Text("No past chats yet.")
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
                Spacer()
                Spacer()
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 2) {
                        ForEach(filtered) { c in row(c) }
                        if filtered.isEmpty {
                            Text("No chats match that search.")
                                .font(TaliseFont.body(13, weight: .light))
                                .foregroundStyle(TaliseColor.fgMuted)
                                .padding(.top, 24)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                    // Trust note: deleting a chat clears the local transcript only.
                    // The durable memory lives on Walrus (append-only) and stays.
                    Text("Deleting a chat only clears it from here. What Talise has learned stays saved on Walrus.")
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28).padding(.top, 10).padding(.bottom, 16)
                }
            }
        }
        .background(TaliseColor.bg)
    }

    private func row(_ c: ChatConversation) -> some View {
        HStack(spacing: 10) {
            Button { vm.open(c.id); onPick() } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.title.isEmpty ? "New chat" : c.title)
                        .font(TaliseFont.body(15, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                    Text(relativeTime(c.updatedAt))
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button { vm.deleteConversation(c.id) } label: {
                Image(systemName: "trash")
                    .font(.system(size: 12))
                    .foregroundStyle(TaliseColor.fgDim)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete chat")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface))
    }

    private func relativeTime(_ d: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: d, relativeTo: Date())
    }
}
