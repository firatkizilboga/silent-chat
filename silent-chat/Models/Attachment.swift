import CryptoKit
import Foundation
import SwiftUI

// MARK: - Attachment Model
/// Mirrors the JS attachment object: { type, name, size, data }
/// `data` is a base64 data URL (e.g., "data:image/jpeg;base64,/9j/4AAQ...")
struct Attachment: Codable, Identifiable, Equatable {
    /// Content-addressed ID: SHA-256 of the base64 payload, scoped by name+size+type
    /// so distinct files with identical bytes can still coexist.
    var id: String {
        let source = "\(type)|\(name)|\(size)|\(data)"
        let digest = SHA256.hash(data: Data(source.utf8))
        return digest.compactMap { String(format: "%02x", $0) }.joined()
    }

    let type: String        // MIME type, e.g. "image/jpeg"
    let name: String        // Original filename
    let size: Int           // File size in bytes
    let data: String        // Base64 data URL

    // MARK: - Computed Properties

    /// The MIME category (image, video, audio, or file)
    var category: AttachmentCategory {
        if type.hasPrefix("image/") { return .image }
        if type.hasPrefix("video/") { return .video }
        if type.hasPrefix("audio/") { return .audio }
        return .file
    }

    /// File extension derived from MIME type
    var fileExtension: String {
        let components = type.split(separator: "/")
        guard components.count == 2 else { return "bin" }
        let sub = String(components[1])
        // Map common MIME subtypes to extensions
        switch sub {
        case "jpeg": return "jpg"
        case "plain": return "txt"
        case "svg+xml": return "svg"
        case "x-wav": return "wav"
        case "quicktime": return "mov"
        case "octet-stream": return "bin"
        default: return sub
        }
    }

    /// Extracts raw base64 data (without the data URL prefix)
    var rawBase64Data: String? {
        // Format: "data:<mime>;base64,<data>"
        guard let commaIndex = data.firstIndex(of: ",") else { return nil }
        return String(data[data.index(after: commaIndex)...])
    }

    /// Decodes the base64 data URL into raw `Data`
    var decodedData: Data? {
        guard let base64 = rawBase64Data else { return nil }
        return Data(base64Encoded: base64, options: .ignoreUnknownCharacters)
    }

    /// Returns a `UIImage` if this is an image attachment
    var uiImage: UIImage? {
        guard category == .image, let data = decodedData else { return nil }
        return UIImage(data: data)
    }

    /// Human-readable file size
    var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(size))
    }

    /// SF Symbol name for the file type
    var iconName: String {
        switch category {
        case .image: return "photo"
        case .video: return "film"
        case .audio: return "waveform"
        case .file:
            if type.contains("pdf") { return "doc.richtext" }
            if type.contains("word") || type.contains("document") { return "doc.text" }
            if type.contains("text") { return "doc.plaintext" }
            if type.contains("zip") || type.contains("archive") { return "doc.zipper" }
            return "paperclip"
        }
    }
}

// MARK: - Attachment Category
enum AttachmentCategory: String, Codable {
    case image
    case video
    case audio
    case file
}
