import SwiftUI

struct ChatScreen: View {
    @Environment(MessageViewModel.self) private var messageViewModel
    @State private var navigationPath = NavigationPath()
    @State private var isNewChatPresented = false

    var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                if messageViewModel.peers.isEmpty {
                    ContentUnavailableView {
                        Label("No Chats", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Start a conversation by tapping the button below.")
                    } actions: {
                        Button("New Chat", systemImage: "square.and.pencil") {
                            isNewChatPresented = true
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .glassEffect(in: .capsule)
                    }
                } else {
                    List(messageViewModel.peers, id: \.self) { alias in
                        Button {
                            navigationPath.append(alias)
                        } label: {
                            ChatRowLabel(
                                alias: alias,
                                messageViewModel: messageViewModel
                            )
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.inset)
                }
            }
            .navigationTitle("Chats")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("New Chat", systemImage: "square.and.pencil") {
                        isNewChatPresented = true
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: "profile") {
                        Label("Profile", systemImage: "person.crop.circle")
                    }
                }
            }
            .onAppear {
                messageViewModel.currentPeer = nil
            }
            .navigationDestination(for: String.self) { alias in
                if alias == "profile" {
                    ProfileView()
                } else {
                    ChatDetailView(peerAlias: alias)
                }
            }
                        .onChange(of: messageViewModel.toastNavigationTarget) { _, newValue in
                guard let newValue else { return }
                navigationPath.append(newValue)
                messageViewModel.toastNavigationTarget = nil
            }
            .sheet(isPresented: $isNewChatPresented) {
                NewChatSheet(
                    messageViewModel: messageViewModel,
                    isPresented: $isNewChatPresented,
                    navigationPath: $navigationPath
                )
            }
        }
    }

    
}

#Preview {
    ChatScreen()
        .environment(AuthViewModel())
        // .environment(MessageViewModel())
}
