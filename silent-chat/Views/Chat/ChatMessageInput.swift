import SwiftUI

struct ChatMessageInput: View {
    @Binding var messageText: String
    var isMessageFieldFocused: FocusState<Bool>.Binding
    @Binding var isFileImporterPresented: Bool
    let onSend: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button("Attach File", systemImage: "paperclip") {
                isFileImporterPresented = true
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.plain)
            .frame(width: 44, height: 44)
            .glassEffect(in: .circle)

            HStack(spacing: 6) {
                TextField("Message", text: $messageText)
                    .submitLabel(.send)
                    .textFieldStyle(.plain)
                    .focused(isMessageFieldFocused)
                    .onSubmit {
                        onSend()
                    }
                    .padding(.horizontal, 4)

                if !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Send", systemImage: "paperplane.fill", action: onSend)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                        .font(.footnote.bold())
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(.tint))
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 44)
            .glassEffect(in: .capsule)
        }
    }
}
