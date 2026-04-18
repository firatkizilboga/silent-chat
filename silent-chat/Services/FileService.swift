import Foundation
import UIKit
import UniformTypeIdentifiers

// MARK: - FileService
/// Handles file/image processing for SilentChat's FILE message type.
///
/// Responsibilities:
/// - Convert UIImage / file URL → Attachment payload (base64 data URL)
/// - Build the encrypted FILE message for the backend
/// - Fetch & decrypt file content from GET /files/{fileId}
/// - Cache decoded images in memory
///
/// ## Backend Protocol
/// **Send**: `POST /messages` with `type: "FILE"`, `encryptedMessage` = AES-encrypted JSON of `{type, name, size, data}`
/// **Receive**: Message has `encryptedMessage` = `{"fileId": "<uuid>"}`. Fetch actual content via `GET /files/{fileId}`.
final class FileService {

    static let shared = FileService()

    // In-memory cache for decoded UIImages (keyed by attachment hash)
    private let imageCache = NSCache<NSString, UIImage>()

    private init() {
        imageCache.countLimit = 100
        imageCache.totalCostLimit = 50 * 1024 * 1024 // ~50 MB
    }

    // MARK: - Building Attachments from Local Files

    /// Create an `Attachment` from a `UIImage` (e.g., from camera or photo picker).
    /// - Parameters:
    ///   - image: The source UIImage
    ///   - filename: Optional filename (defaults to timestamped name)
    ///   - compressionQuality: JPEG compression (0.0–1.0)
    /// - Returns: An `Attachment` ready to be encrypted and sent
    func makeAttachment(
        from image: UIImage,
        filename: String? = nil,
        compressionQuality: CGFloat = 0.8
    ) -> Attachment? {
        guard let jpegData = image.jpegData(compressionQuality: compressionQuality) else {
            return nil
        }

        let name = filename ?? "IMG_\(Self.timestampString()).jpg"
        let base64 = jpegData.base64EncodedString()
        let dataURL = "data:image/jpeg;base64,\(base64)"

        return Attachment(
            type: "image/jpeg",
            name: name,
            size: jpegData.count,
            data: dataURL
        )
    }

    /// Create an `Attachment` from a file URL (e.g., from document picker).
    /// - Parameter url: Local file URL (must be accessible / security-scoped)
    /// - Returns: An `Attachment` ready to be encrypted and sent
    func makeAttachment(from url: URL) -> Attachment? {
        let accessing = url.startAccessingSecurityScopedResource()
        defer {
            if accessing { url.stopAccessingSecurityScopedResource() }
        }

        guard let data = try? Data(contentsOf: url) else { return nil }

        let name = url.lastPathComponent
        let mimeType = Self.mimeType(for: url)
        let base64 = data.base64EncodedString()
        let dataURL = "data:\(mimeType);base64,\(base64)"

        return Attachment(
            type: mimeType,
            name: name,
            size: data.count,
            data: dataURL
        )
    }

    // MARK: - Sending a FILE Message

    /// Builds the JSON payload for a FILE message.
    /// This mirrors the web client's `sendFile()` function.
    ///
    /// The caller is responsible for encrypting and signing the result before
    /// posting to `POST /messages`.
    ///
    /// - Parameter attachment: The attachment to serialize
    /// - Returns: JSON string of the attachment object
    func serializeAttachment(_ attachment: Attachment) -> String? {
        let encoder = JSONEncoder()
        guard let jsonData = try? encoder.encode(attachment) else { return nil }
        return String(data: jsonData, encoding: .utf8)
    }

    // MARK: - Receiving a FILE Message

    /// Parses the `encryptedMessage` field of a FILE message to extract the fileId.
    /// After decryption on the transport level, FILE messages contain `{"fileId": "..."}`.
    ///
    /// - Parameter messageBody: The decrypted message body string
    /// - Returns: The file ID to fetch from `GET /files/{fileId}`
    func extractFileId(from messageBody: String) -> String? {
        guard let data = messageBody.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let fileId = json["fileId"] as? String
        else { return nil }
        return fileId
    }

    /// Fetches encrypted file content from the server.
    ///
    /// - Parameters:
    ///   - fileId: The UUID from the FILE message reference
    ///   - baseURL: Server base URL
    ///   - token: JWT auth token
    /// - Returns: The encrypted content string to be decrypted with the session AES key
    func fetchEncryptedFile(
        fileId: String,
        baseURL: String,
        token: String
    ) async throws -> String {
        guard let url = URL(string: "\(baseURL)/files/\(fileId)") else {
            throw FileServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FileServiceError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200:
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let encryptedContent = json["encryptedContent"] as? String
            else { throw FileServiceError.parseError }
            return encryptedContent
        case 403:
            throw FileServiceError.accessDenied
        case 404:
            throw FileServiceError.fileNotFound
        default:
            throw FileServiceError.serverError(statusCode: httpResponse.statusCode)
        }
    }

    /// Parses decrypted file content into an `Attachment`.
    ///
    /// After fetching via `fetchEncryptedFile()` and decrypting with AES-GCM,
    /// the result is a JSON string matching the Attachment schema.
    ///
    /// - Parameter decryptedJSON: The decrypted JSON string
    /// - Returns: A parsed `Attachment`
    func parseAttachment(from decryptedJSON: String) -> Attachment? {
        guard let data = decryptedJSON.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Attachment.self, from: data)
    }

    // MARK: - Image Caching

    /// Returns a cached `UIImage` for an attachment, decoding from base64 if needed.
    func cachedImage(for attachment: Attachment) -> UIImage? {
        let key = NSString(string: attachment.id)

        if let cached = imageCache.object(forKey: key) {
            return cached
        }

        guard let image = attachment.uiImage else { return nil }

        let cost = attachment.decodedData?.count ?? 0
        imageCache.setObject(image, forKey: key, cost: cost)

        return image
    }

    /// Clears the image cache.
    func clearCache() {
        imageCache.removeAllObjects()
    }

    // MARK: - Helpers

    private static func timestampString() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        return formatter.string(from: Date())
    }

    static func mimeType(for url: URL) -> String {
        if let utType = UTType(filenameExtension: url.pathExtension) {
            return utType.preferredMIMEType ?? "application/octet-stream"
        }
        return "application/octet-stream"
    }
}

// MARK: - Errors
enum FileServiceError: LocalizedError {
    case invalidURL
    case invalidResponse
    case parseError
    case accessDenied
    case fileNotFound
    case serverError(statusCode: Int)
    case encryptionFailed
    case decryptionFailed

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid file URL"
        case .invalidResponse: return "Invalid server response"
        case .parseError: return "Failed to parse file data"
        case .accessDenied: return "Access denied to this file"
        case .fileNotFound: return "File not found on server"
        case .serverError(let code): return "Server error (\(code))"
        case .encryptionFailed: return "Failed to encrypt file"
        case .decryptionFailed: return "Failed to decrypt file"
        }
    }
}
