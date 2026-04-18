import Foundation

struct Message: Identifiable, Equatable, Codable {
    let id: Int
    let senderAlias: String
    let ciphertext: String
    let timestamp: Date
    let type: String?
    let fileId: String?
    let isOutgoing: Bool

    /// Populated at runtime after fetching + decrypting file content.
    /// Not persisted — transient display-only data.
    var attachment: Attachment?

    enum CodingKeys: String, CodingKey {
        case id, senderAlias, ciphertext, timestamp, type, fileId, isOutgoing
    }
}
