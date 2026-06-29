import SwiftUI

/// Slide-out history drawer for the agent — New chat + past conversations.
/// Mirrors the ChatGPT sidebar: a left panel over a dimming scrim, each row a
/// saved conversation (title + relative time) with a delete affordance.
struct ChatHistoryDrawer: View {
    let vm: ChatViewModel
    @Binding var isOpen: Bool

    var body: some View {
        ZStack(alignment: .leading) {
            if isOpen {
                Color.black.opacity(0.45)
                    .ignoresSafeArea()
                    .onTapGesture { isOpen = false }
                    .transition(.opacity)
                panel
                    .transition(.move(edge: .leading))
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: isOpen)
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Chats")
                    .font(TaliseFont.heading(20, weight: .semibold))
                    .foregroundStyle(TaliseColor.fg)
                Spacer()
                Button { isOpen = false } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .frame(width: 34, height: 34)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 10)

            Button {
                vm.newChat()
                isOpen = false
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "square.and.pencil").font(.system(size: 15, weight: .medium))
                    Text("New chat").font(TaliseFont.body(15, weight: .medium))
                    Spacer()
                }
                .foregroundStyle(TaliseColor.fg)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)

            if vm.conversations.isEmpty {
                Text("No past chats yet.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .padding(20)
                Spacer()
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 2) {
                        ForEach(vm.conversations) { c in row(c) }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                }
            }
        }
        .frame(maxWidth: 300, maxHeight: .infinity, alignment: .topLeading)
        .background(TaliseColor.bg.ignoresSafeArea())
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.white.opacity(0.06)).frame(width: 0.5).ignoresSafeArea()
        }
    }

    private func row(_ c: ChatConversation) -> some View {
        let isCurrent = c.id == vm.currentId
        return HStack(spacing: 8) {
            Button {
                vm.open(c.id)
                isOpen = false
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.title.isEmpty ? "New chat" : c.title)
                        .font(TaliseFont.body(14, weight: isCurrent ? .semibold : .regular))
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
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete chat")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isCurrent ? TaliseColor.surface : Color.clear)
        )
    }

    private func relativeTime(_ d: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: d, relativeTo: Date())
    }
}
