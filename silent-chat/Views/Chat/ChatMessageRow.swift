import SwiftUI

struct ChatMessageRow: View {
    let message: Message
    let showTimestamp: Bool
    let onDownloadFile: (String) -> Void

    var body: some View {
        let isOwn = message.isOutgoing

        HStack {
            if isOwn { Spacer() }

            VStack(alignment: isOwn ? .trailing : .leading, spacing: 6) {
                Group {
                    if message.type == "FILE", let fileId = message.fileId {
                        Button("Download file", action: { onDownloadFile(fileId) })
                            .buttonStyle(.plain)
                    } else {
                        Text(message.ciphertext)
                            .font(.body)
                    }
                }
                .padding(10)
                .capsuleGlassEffect()
                .contextMenu {
                    if message.type != "FILE" {
                        Button("Copy", systemImage: "doc.on.doc") {
                            UIPasteboard.general.string = message.ciphertext
                        }
                    }
                }

                if showTimestamp {
                    Text(message.timestamp, format: .relative(presentation: .named))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if !isOwn { Spacer() }
        }
        .frame(maxWidth: .infinity)
    }
}
