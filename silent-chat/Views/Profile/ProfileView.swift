import SwiftUI

struct ProfileView: View {
    @Environment(AuthViewModel.self) private var authViewModel

    var body: some View {
        Form {
            Section("User Information") {
                Text(authViewModel.alias)
            }

            Section {
                Button(role: .destructive) {
                    authViewModel.logout()
                } label: {
                    Text("Log Out")
                }
            } header: {
                Text("Account")
            } footer: {
                Text("All your previous chats will be lost when you log out.")
            }
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
    }
}
