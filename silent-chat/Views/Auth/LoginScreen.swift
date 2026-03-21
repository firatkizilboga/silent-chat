import SwiftUI

struct LoginScreen: View {
    @Environment(AuthViewModel.self) private var authViewModel
    @State private var isRegisterMode = true

    var body: some View {
        @Bindable var authViewModel = authViewModel

        VStack(spacing: 16) {
            VStack(spacing: 10) {
                Text("Silent Chat")
                    .font(.title)
                    .bold()
                Text("Secure, end-to-end encrypted messaging.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Image("box")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 160, height: 160)
            }
            .frame(maxWidth: .infinity, alignment: .center)

            Picker("Mode", selection: $isRegisterMode) {
                Text("Register").tag(true)
                Text("Login").tag(false)
            }
            .pickerStyle(.segmented)

            VStack(alignment: .leading, spacing: 6) {
                TextField("Alias", text: $authViewModel.alias)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .textFieldStyle(.roundedBorder)
                Text("Your unique alias used for login and encryption.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Button {
                submit()
            } label: {
                if authViewModel.isLoading {
                    ProgressView()
                } else {
                    Text(isRegisterMode ? "Register" : "Login")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(authViewModel.isLoading || authViewModel.alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let statusMessage = authViewModel.statusMessage, !statusMessage.isEmpty {
                Text(statusMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let errorMessage = authViewModel.error, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .padding()
    }

    private func submit() {
        let trimmedAlias = authViewModel.alias.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedAlias.isEmpty else { return }

        Task {
            if isRegisterMode {
                _ = try? await authViewModel.register(alias: trimmedAlias)
            } else {
                _ = try? await authViewModel.login(alias: trimmedAlias)
            }
        }
    }
}

#Preview {
    LoginScreen()
        .environment(AuthViewModel())
}
