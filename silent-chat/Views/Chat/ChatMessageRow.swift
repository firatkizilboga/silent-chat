import SwiftUI

struct ChatMessageRow: View {
    let message: Message
    let peerAlias: String
    let showTimestamp: Bool
    let messageViewModel: MessageViewModel
    let onDownloadFile: (String) -> Void

    var body: some View {
        let isOwn = message.isOutgoing

        HStack {
            if isOwn { Spacer() }

            VStack(alignment: isOwn ? .trailing : .leading, spacing: 6) {
                Group {
                    if message.type == "FILE" {
                        fileContent
                    } else {
                        Text(message.ciphertext)
                            .font(.body)
                            .padding(10)
                            .capsuleGlassEffect()
                            .contextMenu {
                                Button("Copy", systemImage: "doc.on.doc") {
                                    UIPasteboard.general.string = message.ciphertext
                                }
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
        .task {
            // Auto-load attachment for FILE messages that have a fileId but no attachment yet
            if message.type == "FILE", message.fileId != nil, message.attachment == nil {
                await messageViewModel.loadAttachment(for: message, peerAlias: peerAlias)
            }
        }
    }

    @ViewBuilder
    private var fileContent: some View {
        if let attachment = message.attachment {
            AttachmentView(attachment: attachment)
        } else if let fileId = message.fileId {
            Button {
                onDownloadFile(fileId)
            } label: {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading file...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
        } else {
            // Outgoing file that hasn't been confirmed by server yet
            HStack(spacing: 8) {
                if let attachment = message.attachment {
                    AttachmentView(attachment: attachment)
                } else {
                    Text(message.ciphertext)
                        .font(.body)
                        .padding(10)
                        .capsuleGlassEffect()
                }
            }
        }
    }
}
