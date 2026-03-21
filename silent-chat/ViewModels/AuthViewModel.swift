import SwiftUI
import Security
import SwiftData

@MainActor
@Observable
final class AuthViewModel {
    var alias: String = ""
    var token: String?
    var privateKey: SecKey?
    var publicKeyPem: String?
    var statusMessage: String?
    var isLoggedIn: Bool = false
    var isLoading: Bool = false
    var error: String?

    private let authService = AuthService()
    private let cryptoService = CryptoService()
    private let keychainService = KeychainService()
    private var modelContext: ModelContext?

    init() {
        loadPersistedAuth()
    }

    func setModelContext(_ context: ModelContext) {
        self.modelContext = context
    }

    func register(alias: String) async throws {
        isLoading = true
        error = nil
        statusMessage = "Requesting challenge..."

        do {
            let nonce = try await authService.registerChallenge(alias: alias)

            // Delete any existing keys before generating new ones (re-registration safety)
            try? cryptoService.deleteExistingKeys()

            statusMessage = "Generating keys..."
            let keyPairs = try await cryptoService.generateKeyPair()

            statusMessage = "Signing challenge..."
            let signedNonce = try cryptoService.signData(nonce, with: keyPairs.signingKeyPair.privateKey)
            statusMessage = "Exporting public key..."
            let publicKeyPem = try cryptoService.exportSigningPublicKeyPEM(from: keyPairs.signingKeyPair)

            statusMessage = "Completing registration..."
            try await authService.registerComplete(
                alias: alias,
                publicKey: publicKeyPem,
                signedNonce: signedNonce
            )

            // Keys are already stored in keychain by SecKeyCreateRandomKey (isPermanent: true)
            self.publicKeyPem = publicKeyPem
            self.privateKey = keyPairs.signingKeyPair.privateKey
            try keychainService.saveString(alias, for: KeychainKeys.alias)
            self.alias = alias

            statusMessage = "Completing login..."
            let loginNonce = try await authService.loginChallenge(alias: alias)
            let signedLogin = try cryptoService.signData(loginNonce, with: keyPairs.signingKeyPair.privateKey)
            let token = try await authService.loginComplete(alias: alias, signedChallenge: signedLogin)
            try keychainService.saveString(token, for: KeychainKeys.jwtToken)
            self.token = token
            try? keychainService.delete(key: KeychainKeys.sessionKeys)

            isLoggedIn = true
            isLoading = false
            statusMessage = "Registered and logged in."
        } catch {
            isLoading = false
            self.error = (error as? LocalizedError)?.errorDescription ?? "Registration failed."
            statusMessage = nil
            throw error
        }
    }

    func login(alias: String) async throws -> String {
        isLoading = true
        error = nil
        statusMessage = "Requesting challenge..."

        do {
            let nonce = try await authService.loginChallenge(alias: alias)

            statusMessage = "Loading private key..."
            guard let signingPrivateKey = try cryptoService.loadSigningPrivateKey() else {
                throw AuthViewModelError.missingSigningKey
            }

            statusMessage = "Signing challenge..."
            let signedChallenge = try cryptoService.signData(nonce, with: signingPrivateKey)

            statusMessage = "Completing login..."
            let token = try await authService.loginComplete(alias: alias, signedChallenge: signedChallenge)
            try keychainService.saveString(token, for: KeychainKeys.jwtToken)

            self.privateKey = signingPrivateKey
            self.token = token
            // Derive public key PEM from private key
            if let publicKey = SecKeyCopyPublicKey(signingPrivateKey) {
                self.publicKeyPem = try? cryptoService.exportPublicKeyPEM(publicKey)
            } else {
                self.publicKeyPem = nil
            }
            try keychainService.saveString(alias, for: KeychainKeys.alias)
            try? keychainService.delete(key: KeychainKeys.sessionKeys)
            self.alias = alias
            isLoggedIn = true
            isLoading = false
            statusMessage = "Logged in successfully."
            return token
        } catch {
            isLoading = false
            self.error = (error as? LocalizedError)?.errorDescription ?? "Login failed."
            statusMessage = nil
            throw error
        }
    }

    private func loadPersistedAuth() {
        migrateKeysIfNeeded()

        if let token = try? keychainService.loadString(for: KeychainKeys.jwtToken), !token.isEmpty {
            self.token = token
            self.isLoggedIn = true
        }

        if let signingKey = try? cryptoService.loadSigningPrivateKey() {
            self.privateKey = signingKey
        }

        if let storedAlias = try? keychainService.loadString(for: KeychainKeys.alias) {
            self.alias = storedAlias
        }
    }

    func logout() {
        do {
            try keychainService.delete(key: KeychainKeys.jwtToken)
            try? keychainService.delete(key: KeychainKeys.sessionKeys)
            try clearSentMessages()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to log out."
        }

        token = nil
        alias = ""
        privateKey = nil
        publicKeyPem = nil
        error = nil
        isLoggedIn = false
        isLoading = false
        statusMessage = nil
    }

    func reloginWithStoredAlias() async {
        let storedAlias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !storedAlias.isEmpty else { return }

        if privateKey == nil,
           let loadedKey = try? cryptoService.loadSigningPrivateKey() {
            privateKey = loadedKey
        }

        guard let signingPrivateKey = privateKey else { return }

        isLoading = true
        error = nil
        statusMessage = "Re-authenticating..."

        do {
            let nonce = try await authService.loginChallenge(alias: storedAlias)
            let signedChallenge = try cryptoService.signData(nonce, with: signingPrivateKey)
            let token = try await authService.loginComplete(alias: storedAlias, signedChallenge: signedChallenge)
            try keychainService.saveString(token, for: KeychainKeys.jwtToken)
            self.token = token
            try? keychainService.delete(key: KeychainKeys.sessionKeys)
            isLoggedIn = true
            isLoading = false
            statusMessage = "Logged in successfully."
        } catch {
            isLoading = false
            self.error = (error as? LocalizedError)?.errorDescription ?? "Login failed."
            statusMessage = nil
        }
    }

    // MARK: - Migration

    /// Migrates legacy PEM-encoded keys from `kSecClassGenericPassword` to proper `kSecClassKey` keychain items.
    private func migrateKeysIfNeeded() {
        if let flag = try? keychainService.loadString(for: KeychainKeys.keysMigrated),
           flag == "true" {
            return
        }

        if let signingPem = try? keychainService.loadString(for: LegacyKeychainKeys.signingPrivateKey) {
            _ = try? cryptoService.migratePrivateKeyFromPEM(signingPem, tag: CryptoService.signingTag)
        }

        if let encryptPem = try? keychainService.loadString(for: LegacyKeychainKeys.encryptPrivateKey) {
            _ = try? cryptoService.migratePrivateKeyFromPEM(encryptPem, tag: CryptoService.encryptionTag)
        }

        // Delete legacy PEM entries
        try? keychainService.delete(key: LegacyKeychainKeys.signingPrivateKey)
        try? keychainService.delete(key: LegacyKeychainKeys.signingPublicKey)
        try? keychainService.delete(key: LegacyKeychainKeys.encryptPrivateKey)
        try? keychainService.delete(key: LegacyKeychainKeys.encryptPublicKey)

        try? keychainService.saveString("true", for: KeychainKeys.keysMigrated)
    }

    // MARK: - Private Helpers

    private func clearSentMessages() throws {
        guard let modelContext else { return }
        let sentDescriptor = FetchDescriptor<SentMessage>()
        let sentItems = try modelContext.fetch(sentDescriptor)
        for item in sentItems {
            modelContext.delete(item)
        }

        let storedDescriptor = FetchDescriptor<StoredMessage>()
        let storedItems = try modelContext.fetch(storedDescriptor)
        for item in storedItems {
            modelContext.delete(item)
        }
        try modelContext.save()
    }


}

enum AuthViewModelError: Error {
    case missingSigningKey
}

extension AuthViewModelError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .missingSigningKey:
            return "Signing key not found on device."
        }
    }
}

/// Legacy keychain keys used before migration to `kSecClassKey` storage.
private enum LegacyKeychainKeys {
    static let signingPrivateKey = "signingPrivateKeyPem"
    static let signingPublicKey = "signingPublicKeyPem"
    static let encryptPrivateKey = "encryptPrivateKeyPem"
    static let encryptPublicKey = "encryptPublicKeyPem"
}
