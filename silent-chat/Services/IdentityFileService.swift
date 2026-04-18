import Foundation

enum IdentityFileError: Error, LocalizedError {
    case invalidFormat
    case missingPrivateKey
    case missingAlias

    var errorDescription: String? {
        switch self {
        case .invalidFormat:
            return "Identity file is not a valid SilentChat PEM export."
        case .missingPrivateKey:
            return "Identity file is missing a PRIVATE KEY block."
        case .missingAlias:
            return "Identity file is missing the alias header."
        }
    }
}

struct ParsedIdentityFile {
    let alias: String
    let privateKeyPEM: String
    let publicKeyPEM: String?
}

enum IdentityFileService {
    private static let aliasPrefix = "# SilentChat identity:"

    static func format(alias: String, privateKeyPEM: String, publicKeyPEM: String) -> String {
        "\(aliasPrefix) \(alias)\n\(privateKeyPEM)\n\(publicKeyPEM)\n"
    }

    static func parse(_ contents: String) throws -> ParsedIdentityFile {
        let aliasLine = contents
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { $0.hasPrefix(aliasPrefix) }

        guard let aliasLine else { throw IdentityFileError.missingAlias }
        let alias = aliasLine
            .dropFirst(aliasPrefix.count)
            .trimmingCharacters(in: .whitespaces)
        guard !alias.isEmpty else { throw IdentityFileError.missingAlias }

        guard let privateKeyPEM = extractBlock(from: contents, begin: "-----BEGIN PRIVATE KEY-----", end: "-----END PRIVATE KEY-----") else {
            throw IdentityFileError.missingPrivateKey
        }
        let publicKeyPEM = extractBlock(from: contents, begin: "-----BEGIN PUBLIC KEY-----", end: "-----END PUBLIC KEY-----")

        return ParsedIdentityFile(alias: alias, privateKeyPEM: privateKeyPEM, publicKeyPEM: publicKeyPEM)
    }

    private static func extractBlock(from text: String, begin: String, end: String) -> String? {
        guard let beginRange = text.range(of: begin),
              let endRange = text.range(of: end, range: beginRange.upperBound..<text.endIndex) else {
            return nil
        }
        return String(text[beginRange.lowerBound..<endRange.upperBound])
    }
}
