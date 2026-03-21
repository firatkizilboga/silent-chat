import Foundation
import Security
import CryptoKit

struct RSAKeyPair {
    let privateKey: SecKey
    let publicKey: SecKey
}

struct CryptoKeyPairs {
    let encryptKeyPair: RSAKeyPair
    let signingKeyPair: RSAKeyPair
}

enum CryptoServiceError: Error {
    case keyGenerationFailed
    case publicKeyExtractionFailed
    case keyExportFailed
    case keyImportFailed
    case signingFailed
    case pemEncodingFailed
}

final class CryptoService {

    // MARK: - Keychain Tags

    private enum KeyTag {
        static let signing = "com.amogus.silent-chat.signing"
        static let encryption = "com.amogus.silent-chat.encryption"
    }

    // MARK: - Key Generation

    func generateKeyPair() async throws -> CryptoKeyPairs {
        let encryptKeyPair = try generateRSAKeyPair(tag: KeyTag.encryption)
        let signingKeyPair = try generateRSAKeyPair(tag: KeyTag.signing)
        return CryptoKeyPairs(encryptKeyPair: encryptKeyPair, signingKeyPair: signingKeyPair)
    }

    // MARK: - Key Loading

    func loadSigningPrivateKey() throws -> SecKey? {
        try loadPrivateKey(tag: KeyTag.signing)
    }

    func loadEncryptionPrivateKey() throws -> SecKey? {
        try loadPrivateKey(tag: KeyTag.encryption)
    }

    // MARK: - Key Deletion

    func deleteExistingKeys() throws {
        try deletePrivateKey(tag: KeyTag.signing)
        try deletePrivateKey(tag: KeyTag.encryption)
    }

    // MARK: - Migration

    /// Imports a legacy PEM-encoded private key and stores it as a proper `kSecClassKey` keychain item.
    func migratePrivateKeyFromPEM(_ pem: String, tag: String) throws -> SecKey {
        guard let tagData = tag.data(using: .utf8) else {
            throw CryptoServiceError.keyImportFailed
        }

        let privateKey = try importPrivateKeyFromPEM(pem)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecAttrKeySizeInBits as String: 2048,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueRef as String: privateKey
        ]

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecDuplicateItem {
            // Already migrated — load and return the existing key
            guard let existingKey = try loadPrivateKey(tag: tag) else {
                throw CryptoServiceError.keyImportFailed
            }
            return existingKey
        }

        guard status == errSecSuccess else {
            throw CryptoServiceError.keyImportFailed
        }

        return privateKey
    }

    static var signingTag: String { KeyTag.signing }
    static var encryptionTag: String { KeyTag.encryption }

    // MARK: - Public Key Export

    func exportSigningPublicKeyPEM(from signingKeyPair: RSAKeyPair) throws -> String {
        try exportPublicKeyPEM(signingKeyPair.publicKey)
    }

    func exportPublicKeyPEM(from keyPair: RSAKeyPair) throws -> String {
        try exportPublicKeyPEM(keyPair.publicKey)
    }

    func exportPublicKeyPEM(_ publicKey: SecKey) throws -> String {
        var error: Unmanaged<CFError>?
        guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw error?.takeRetainedValue() ?? CryptoServiceError.keyExportFailed
        }

        let spki = try makeRSAPublicKeySPKI(from: publicKeyData)
        let base64 = spki.base64EncodedString(options: [.lineLength64Characters])
        return "-----BEGIN PUBLIC KEY-----\n\(base64)\n-----END PUBLIC KEY-----"
    }

    // MARK: - Public Key Import

    func importPublicKeyFromPEM(_ pem: String) throws -> SecKey {
        let data = try extractPEMBody(pem, header: "-----BEGIN PUBLIC KEY-----", footer: "-----END PUBLIC KEY-----")

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
            kSecAttrKeySizeInBits as String: 2048
        ]

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(data as CFData, attributes as CFDictionary, &error) else {
            throw error?.takeRetainedValue() ?? CryptoServiceError.keyImportFailed
        }

        return key
    }

    // MARK: - Signing

    func signData(_ data: String, with privateKey: SecKey) throws -> String {
        guard let messageData = data.data(using: .utf8) else {
            throw CryptoServiceError.signingFailed
        }

        let algorithm = SecKeyAlgorithm.rsaSignatureMessagePKCS1v15SHA256
        guard SecKeyIsAlgorithmSupported(privateKey, .sign, algorithm) else {
            throw CryptoServiceError.signingFailed
        }

        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(privateKey, algorithm, messageData as CFData, &error) as Data? else {
            throw error?.takeRetainedValue() ?? CryptoServiceError.signingFailed
        }

        return signature.base64EncodedString()
    }

    // MARK: - AES Key Generation & Exchange

    func generateAesKey() throws -> Data {
        var keyData = Data(count: 32)
        let result = keyData.withUnsafeMutableBytes { bytes in
            SecRandomCopyBytes(kSecRandomDefault, 32, bytes.baseAddress!)
        }
        guard result == errSecSuccess else {
            throw CryptoServiceError.keyGenerationFailed
        }
        return keyData
    }

    func encryptAesKey(_ aesKey: Data, with publicKey: SecKey) throws -> String {
        let algorithm = SecKeyAlgorithm.rsaEncryptionOAEPSHA256
        guard SecKeyIsAlgorithmSupported(publicKey, .encrypt, algorithm) else {
            throw CryptoServiceError.keyExportFailed
        }

        var error: Unmanaged<CFError>?
        guard let encryptedData = SecKeyCreateEncryptedData(publicKey, algorithm, aesKey as CFData, &error) as Data? else {
            throw error?.takeRetainedValue() ?? CryptoServiceError.keyExportFailed
        }

        return encryptedData.base64EncodedString()
    }

    func decryptAesKey(_ encryptedBase64: String, with privateKey: SecKey) throws -> Data {
        let algorithm = SecKeyAlgorithm.rsaEncryptionOAEPSHA256
        guard SecKeyIsAlgorithmSupported(privateKey, .decrypt, algorithm) else {
            throw CryptoServiceError.keyExportFailed
        }

        guard let encryptedData = Data(base64Encoded: encryptedBase64) else {
            throw CryptoServiceError.keyExportFailed
        }

        var error: Unmanaged<CFError>?
        guard let decryptedData = SecKeyCreateDecryptedData(privateKey, algorithm, encryptedData as CFData, &error) as Data? else {
            throw error?.takeRetainedValue() ?? CryptoServiceError.keyExportFailed
        }

        return decryptedData
    }

    // MARK: - AES Message Encryption/Decryption

    func encryptMessage(aesKey: Data, plaintext: String) throws -> String {
        guard let messageData = plaintext.data(using: .utf8) else {
            throw CryptoServiceError.keyExportFailed
        }

        let symmetricKey = SymmetricKey(data: aesKey)
        let nonceData = try randomBytes(count: 12)
        let nonce = try AES.GCM.Nonce(data: nonceData)
        let sealedBox = try AES.GCM.seal(messageData, using: symmetricKey, nonce: nonce)

        let combined = nonceData + sealedBox.ciphertext + sealedBox.tag
        return combined.base64EncodedString()
    }

    func encryptData(aesKey: Data, data: Data) throws -> String {
        let symmetricKey = SymmetricKey(data: aesKey)
        let sealedBox = try AES.GCM.seal(data, using: symmetricKey)
        guard let combined = sealedBox.combined else {
            throw CryptoServiceError.keyExportFailed
        }
        return combined.base64EncodedString()
    }

    func decryptMessage(aesKey: Data, encryptedBase64: String) throws -> String {
        guard let combined = Data(base64Encoded: encryptedBase64) else {
            throw CryptoServiceError.keyExportFailed
        }
        guard combined.count > 12 else {
            throw CryptoServiceError.keyExportFailed
        }

        let nonceData = combined.prefix(12)
        let ciphertextAndTag = combined.dropFirst(12)
        guard ciphertextAndTag.count > 16 else {
            throw CryptoServiceError.keyExportFailed
        }

        let tag = ciphertextAndTag.suffix(16)
        let ciphertext = ciphertextAndTag.dropLast(16)

        let nonce = try AES.GCM.Nonce(data: nonceData)
        let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let symmetricKey = SymmetricKey(data: aesKey)
        let decrypted = try AES.GCM.open(sealedBox, using: symmetricKey)

        guard let plaintext = String(data: decrypted, encoding: .utf8) else {
            throw CryptoServiceError.keyExportFailed
        }
        return plaintext
    }

    // MARK: - Private Helpers

    private func loadPrivateKey(tag: String) throws -> SecKey? {
        guard let tagData = tag.data(using: .utf8) else {
            throw CryptoServiceError.keyImportFailed
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecReturnRef as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw CryptoServiceError.keyImportFailed
        }

        // swiftlint:disable:next force_cast
        return (item as! SecKey)
    }

    private func deletePrivateKey(tag: String) throws {
        guard let tagData = tag.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw CryptoServiceError.keyGenerationFailed
        }
    }

    private func generateRSAKeyPair(tag: String) throws -> RSAKeyPair {
        guard let tagData = tag.data(using: .utf8) else {
            throw CryptoServiceError.keyGenerationFailed
        }

        let parameters: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tagData,
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            ]
        ]

        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(parameters as CFDictionary, &error) else {
            throw error?.takeRetainedValue() ?? CryptoServiceError.keyGenerationFailed
        }

        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw CryptoServiceError.publicKeyExtractionFailed
        }

        return RSAKeyPair(privateKey: privateKey, publicKey: publicKey)
    }

    // MARK: - Migration Helper

    private func importPrivateKeyFromPEM(_ pem: String) throws -> SecKey {
        let data = try extractPEMBody(pem, header: "-----BEGIN PRIVATE KEY-----", footer: "-----END PRIVATE KEY-----")

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecAttrKeySizeInBits as String: 2048
        ]

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(data as CFData, attributes as CFDictionary, &error) else {
            throw error?.takeRetainedValue() ?? CryptoServiceError.keyImportFailed
        }

        return key
    }

    private func randomBytes(count: Int) throws -> Data {
        var data = Data(count: count)
        let result = data.withUnsafeMutableBytes { bytes in
            SecRandomCopyBytes(kSecRandomDefault, count, bytes.baseAddress!)
        }
        guard result == errSecSuccess else {
            throw CryptoServiceError.keyGenerationFailed
        }
        return data
    }

    private func extractPEMBody(_ pem: String, header: String, footer: String) throws -> Data {
        let body = pem
            .replacing(header, with: "")
            .replacing(footer, with: "")

        let rawLines = body.split(whereSeparator: \.isNewline)
        let contentLines = rawLines.filter { line in
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return false }
            return !trimmed.contains(":")
        }

        let joined = contentLines.joined()
        let base64Charset = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
        let filteredScalars = joined.unicodeScalars.filter { base64Charset.contains($0) }
        let filteredBase64 = String(String.UnicodeScalarView(filteredScalars))
        let paddingNeeded = (4 - (filteredBase64.count % 4)) % 4
        let paddedBase64 = filteredBase64 + String(repeating: "=", count: paddingNeeded)

        guard let data = Data(base64Encoded: paddedBase64) else {
            throw CryptoServiceError.pemEncodingFailed
        }

        return data
    }

    private func makeRSAPublicKeySPKI(from rsaPublicKey: Data) throws -> Data {
        // ASN.1 for: SEQUENCE( AlgorithmIdentifier( rsaEncryption OID + NULL ), BIT STRING( RSAPublicKey ) )
        let rsaEncryptionOID: [UInt8] = [
            0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01
        ]
        let algorithmIdentifier: [UInt8] = [
            0x30, 0x0D
        ] + rsaEncryptionOID + [0x05, 0x00]

        let bitStringPrefix: [UInt8] = [0x03]
        let bitStringPayload = [UInt8(0x00)] + [UInt8](rsaPublicKey)
        let bitString = bitStringPrefix + encodeASN1Length(bitStringPayload.count) + bitStringPayload

        let spkiSequence: [UInt8] = [0x30] + encodeASN1Length(algorithmIdentifier.count + bitString.count) + algorithmIdentifier + bitString

        return Data(spkiSequence)
    }

    private func encodeASN1Length(_ length: Int) -> [UInt8] {
        if length < 128 {
            return [UInt8(length)]
        }

        var lengthBytes = [UInt8]()
        var value = length
        while value > 0 {
            lengthBytes.insert(UInt8(value & 0xFF), at: 0)
            value >>= 8
        }

        return [0x80 | UInt8(lengthBytes.count)] + lengthBytes
    }
}
