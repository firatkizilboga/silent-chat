import SwiftUI

struct NewChatSheet: View {
    let messageViewModel: MessageViewModel
    @Environment(AuthViewModel.self) private var authViewModel
    @Binding var isPresented: Bool
    @Binding var navigationPath: NavigationPath
    @State private var searchText = ""
    @State private var isChecking = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 6) {
                    TextField("Alias", text: $searchText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.plain)
                        .submitLabel(.go)
                        .onSubmit {
                            Task { await startChatIfPossible() }
                        }
                        .padding(.horizontal, 4)

                    if isChecking {
                        ProgressView()
                            .frame(width: 28, height: 28)
                    } else if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            Task { await startChatIfPossible() }
                        } label: {
                            Image(systemName: "paperplane.fill")
                                .font(.footnote.bold())
                                .foregroundStyle(.white)
                                .frame(width: 28, height: 28)
                                .background(Circle().fill(.tint))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Start Chat")
                        .disabled(!messageViewModel.canStartChat(with: searchText))
                    }
                }
                .padding(.horizontal, 10)
                .frame(height: 44)
                .capsuleGlassEffect()

                Text("Enter the alias of the person you want to chat with.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                Spacer()

                ShareLink(
                    item: URL(string: "https://testflight.apple.com/join/V6caSHjR")!,
                    subject: Text("Silent Chat"),
                    message: Text("Join me on Silent Chat for private, encrypted messaging.")
                ) {
                    Label("Invite a Friend", systemImage: "person.badge.plus")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .capsuleGlassEffect()
                }
                .buttonStyle(.plain)
            }
            .padding()
            .navigationTitle("New Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        isPresented = false
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
    }

    private func startChatIfPossible() async {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard messageViewModel.canStartChat(with: trimmed) else { return }
        guard let token = authViewModel.token else {
            errorMessage = "Not authenticated."
            return
        }

        guard trimmed.lowercased() != authViewModel.alias.lowercased() else {
            errorMessage = "You can't chat with yourself."
            return
        }

        errorMessage = nil
        isChecking = true
        do {
            try await messageViewModel.checkAliasExists(alias: trimmed, token: token)
            isPresented = false
            navigationPath.append(trimmed)
        } catch {
            errorMessage = "User not found."
        }
        isChecking = false
    }
}
