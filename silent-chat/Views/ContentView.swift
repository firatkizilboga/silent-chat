import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext: ModelContext

    var body: some View {
        ContentRootView(modelContext: modelContext)
    }
}

private struct ContentRootView: View {
    let modelContext: ModelContext
    @State private var authViewModel = AuthViewModel()
    @State private var messageViewModel: MessageViewModel

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        _messageViewModel = State(initialValue: MessageViewModel(modelContext: modelContext))
    }

    var body: some View {
        ZStack(alignment: .top) {
            Group {
                if authViewModel.isLoggedIn {
                    ChatScreen()
                } else {
                    LoginScreen()
                }
            }

            if let toast = messageViewModel.toast {
                ToastView(
                    sender: toast.senderAlias,
                    text: toast.text,
                    onTap: {
                        messageViewModel.toastNavigationTarget = toast.senderAlias
                        messageViewModel.toast = nil
                    },
                    onDismiss: {
                        messageViewModel.toast = nil
                    }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
                .padding(.top, 12)
                .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.2), value: messageViewModel.toast)
        .environment(authViewModel)
        .environment(messageViewModel)
        .task {
            authViewModel.setModelContext(modelContext)
            updateWebSocketConnection()
        }
        .onChange(of: authViewModel.isLoggedIn) { _, newValue in
            if !newValue {
                messageViewModel.resetState()
            } else {
                updateWebSocketConnection()
            }
        }
        .onChange(of: authViewModel.token) {
            updateWebSocketConnection()
        }
        .onChange(of: authViewModel.privateKey) {
            updateWebSocketConnection()
        }
        .onChange(of: messageViewModel.authRequiresRelogin) { _, needsRelogin in
            guard needsRelogin else { return }
            Task {
                await authViewModel.reloginWithStoredAlias()
                messageViewModel.authRequiresRelogin = false
            }
        }
    }

    private func updateWebSocketConnection() {
        guard authViewModel.isLoggedIn,
              let token = authViewModel.token,
              let privateKey = authViewModel.privateKey else { return }
        messageViewModel.connectWebSocket(token: token, myPrivateKey: privateKey)
    }
}

#Preview {
    ContentView()
}
