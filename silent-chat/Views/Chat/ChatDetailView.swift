import SwiftUI
import UniformTypeIdentifiers
import QuickLook
import PhotosUI

struct ChatDetailView: View {
    @Environment(AuthViewModel.self) private var authViewModel
    @Environment(MessageViewModel.self) private var messageViewModel
    let peerAlias: String
    @State private var messageText = ""
    @State private var isFileImporterPresented = false
    @State private var isPhotoPickerPresented = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var previewURL: URL?
    @State private var isPreviewPresented = false
    @FocusState private var isMessageFieldFocused: Bool
    @State private var sendTrigger = 0

    var body: some View {
        VStack(spacing: 12) {
            Divider()
                .padding(.horizontal, -16)

            if messageViewModel.isInitiatingSession {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Initiating session...")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            ChatMessageList(
                messages: messagesForPeer,
                messageViewModel: messageViewModel,
                authViewModel: authViewModel,
                peerAlias: peerAlias,
                onPreviewFile: { url in
                    previewURL = url
                    isPreviewPresented = true
                }
            )

            ChatMessageInput(
                messageText: $messageText,
                isMessageFieldFocused: $isMessageFieldFocused,
                isFileImporterPresented: $isFileImporterPresented,
                isPhotoPickerPresented: $isPhotoPickerPresented,
                onSend: sendMessage
            )
            .sensoryFeedback(.impact(flexibility: .soft), trigger: sendTrigger)
        }
        .overlay(alignment: .bottom) {
            VStack(spacing: 4) {
                if let statusMessage = messageViewModel.statusMessage, !statusMessage.isEmpty {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if let errorMessage = messageViewModel.error, !errorMessage.isEmpty {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 80)
            .animation(.default, value: messageViewModel.statusMessage)
            .animation(.default, value: messageViewModel.error)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .contentShape(Rectangle())
        .onTapGesture {
            isMessageFieldFocused = false
        }
        .accessibilityAddTraits(.isButton)
        .navigationTitle(peerAlias)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            messageViewModel.selectPeer(peerAlias)
            await ensureSessionIfNeeded()
        }
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: [.data]
        ) { result in
            handleFileImport(result)
        }
        .photosPicker(
            isPresented: $isPhotoPickerPresented,
            selection: $selectedPhotoItem,
            matching: .images
        )
        .onChange(of: selectedPhotoItem) { _, newItem in
            handlePhotoPick(newItem)
        }
        .sheet(isPresented: $isPreviewPresented) {
            if let previewURL {
                QuickLookPreview(url: previewURL)
            }
        }
    }

    private var messagesForPeer: [Message] {
        messageViewModel.messages[peerAlias] ?? []
    }

    private func ensureSessionIfNeeded() async {
        guard let token = authViewModel.token, let privateKey = authViewModel.privateKey else { return }
        await messageViewModel.ensureSession(with: peerAlias, token: token, myPrivateKey: privateKey)
    }

    private func sendMessage() {
        let trimmed = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let token = authViewModel.token,
              let privateKey = authViewModel.privateKey else { return }

        messageText = ""
        sendTrigger += 1
        Task {
            await messageViewModel.sendTextMessage(
                peerAlias: peerAlias,
                plaintext: trimmed,
                token: token,
                myPrivateKey: privateKey,
                senderAlias: authViewModel.alias
            )
        }
    }

    private func handlePhotoPick(_ item: PhotosPickerItem?) {
        guard let item,
              let token = authViewModel.token,
              let privateKey = authViewModel.privateKey else { return }

        Task {
            if let data = try? await item.loadTransferable(type: Data.self),
               let uiImage = UIImage(data: data) {
                guard let attachment = FileService.shared.makeAttachment(from: uiImage) else {
                    messageViewModel.error = "Failed to process image."
                    return
                }
                await messageViewModel.sendFileMessage(
                    peerAlias: peerAlias,
                    attachment: attachment,
                    token: token,
                    myPrivateKey: privateKey,
                    senderAlias: authViewModel.alias
                )
            }
            selectedPhotoItem = nil
        }
    }

    private func handleFileImport(_ result: Result<URL, Error>) {
        guard let token = authViewModel.token, let privateKey = authViewModel.privateKey else { return }

        switch result {
        case .success(let url):
            Task {
                guard let attachment = FileService.shared.makeAttachment(from: url) else {
                    messageViewModel.error = "Failed to process file."
                    return
                }
                await messageViewModel.sendFileMessage(
                    peerAlias: peerAlias,
                    attachment: attachment,
                    token: token,
                    myPrivateKey: privateKey,
                    senderAlias: authViewModel.alias
                )
            }
        case .failure(let error):
            messageViewModel.error = error.localizedDescription
        }
    }
}

#Preview {
    ChatDetailView(peerAlias: "Example")
        .environment(AuthViewModel())
        // .environment(MessageViewModel())
}
