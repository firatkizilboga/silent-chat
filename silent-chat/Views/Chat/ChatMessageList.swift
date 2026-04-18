import SwiftUI

struct ChatMessageList: View {
    let messages: [Message]
    let messageViewModel: MessageViewModel
    let authViewModel: AuthViewModel
    let peerAlias: String
    let onPreviewFile: (URL) -> Void
    @State private var scrollPosition = ScrollPosition(idType: String.self)

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(messages.enumerated(), id: \.element.id) { index, message in
                    ChatMessageRow(
                        message: message,
                        peerAlias: peerAlias,
                        showTimestamp: shouldShowTimestamp(at: index),
                        messageViewModel: messageViewModel
                    ) {
                        downloadFile(fileId: $0)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                Color.clear
                    .frame(height: 1)
                    .id("bottom")
            }
            .animation(.easeOut(duration: 0.2), value: messages.count)
        }
        .scrollIndicators(.hidden)
        .defaultScrollAnchor(.bottom)
        .scrollPosition($scrollPosition)
        .onChange(of: messages.count) {
            withAnimation(.easeOut(duration: 0.2)) {
                scrollPosition.scrollTo(id: "bottom", anchor: .bottom)
            }
        }
    }

    private func shouldShowTimestamp(at index: Int) -> Bool {
        guard index < messages.count else { return false }
        let current = messages[index]
        let isLast = index == messages.count - 1
        if isLast { return true }

        let next = messages[index + 1]
        if next.senderAlias != current.senderAlias { return true }

        let gap = next.timestamp.timeIntervalSince(current.timestamp)
        return gap > 60
    }

    private func downloadFile(fileId: String) {
        guard let token = authViewModel.token else { return }
        Task {
            let url = await messageViewModel.downloadFile(fileId: fileId, token: token)
            if let url {
                onPreviewFile(url)
            }
        }
    }
}
