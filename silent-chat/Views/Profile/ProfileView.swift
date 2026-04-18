import SwiftUI

struct ProfileView: View {
    @Environment(AuthViewModel.self) private var authViewModel
    @State private var exportURL: URL?
    @State private var exportError: String?

    var body: some View {
        Form {
            Section("User Information") {
                Text(authViewModel.alias)
            }

            Section {
                if let exportURL {
                    ShareLink(item: exportURL) {
                        Label("Export Identity", systemImage: "square.and.arrow.up")
                    }
                } else {
                    Button {
                        prepareExport()
                    } label: {
                        Label("Export Identity", systemImage: "square.and.arrow.up")
                    }
                }
                if let exportError {
                    Text(exportError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            } header: {
                Text("Identity")
            } footer: {
                Text("Export your keypair as a PEM file to restore this identity on another device.")
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

    private func prepareExport() {
        exportError = nil
        do {
            exportURL = try authViewModel.exportIdentityFile()
        } catch {
            exportError = (error as? LocalizedError)?.errorDescription ?? "Failed to export identity."
        }
    }
}
