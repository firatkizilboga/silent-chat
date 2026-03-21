import Foundation
import Security

enum KeychainServiceError: Error {
    case unexpectedStatus(OSStatus)
}

final class KeychainService {
    private let service: String

    init(service: String = Bundle.main.bundleIdentifier ?? "silent-chat") {
        self.service = service
    }

    func saveString(_ value: String, for key: String) throws {
        guard let data = value.data(using: .utf8) else {
            throw KeychainServiceError.unexpectedStatus(errSecParam)
        }

        try saveData(data, for: key)
    }

    func saveData(_ data: Data, for key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updateQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: key
            ]
            let attributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            ]
            let updateStatus = SecItemUpdate(updateQuery as CFDictionary, attributes as CFDictionary)
            if updateStatus != errSecSuccess {
                throw KeychainServiceError.unexpectedStatus(updateStatus)
            }
            return
        }

        if status != errSecSuccess {
            throw KeychainServiceError.unexpectedStatus(status)
        }
    }

    func loadString(for key: String) throws -> String? {
        guard let data = try loadData(for: key) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    func loadData(for key: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        if status != errSecSuccess {
            throw KeychainServiceError.unexpectedStatus(status)
        }

        return item as? Data
    }

    func delete(key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw KeychainServiceError.unexpectedStatus(status)
        }
    }
}
