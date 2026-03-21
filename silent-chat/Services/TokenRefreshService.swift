import Foundation

actor TokenRefreshService {
    private let authService: AuthService
    private let cryptoService: CryptoService
    private let keychainService: KeychainService
    private var refreshTask: Task<String, Error>?

    init(
        authService: AuthService = AuthService(),
        cryptoService: CryptoService = CryptoService(),
        keychainService: KeychainService = KeychainService()
    ) {
        self.authService = authService
        self.cryptoService = cryptoService
        self.keychainService = keychainService
    }

    func refreshToken() async throws -> String {
        if let refreshTask {
            return try await refreshTask.value
        }

        let task = Task<String, Error> {
            let storedAlias = try keychainService.loadString(for: KeychainKeys.alias) ?? ""
            let trimmedAlias = storedAlias.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedAlias.isEmpty else {
                throw TokenRefreshError.missingAlias
            }

            guard let signingPrivateKey = try cryptoService.loadSigningPrivateKey() else {
                throw TokenRefreshError.missingSigningKey
            }

            let nonce = try await authService.loginChallenge(alias: trimmedAlias)
            let signedChallenge = try cryptoService.signData(nonce, with: signingPrivateKey)
            let token = try await authService.loginComplete(alias: trimmedAlias, signedChallenge: signedChallenge)
            try keychainService.saveString(token, for: KeychainKeys.jwtToken)
            return token
        }

        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }
}

enum TokenRefreshError: Error {
    case missingAlias
    case missingSigningKey
}
