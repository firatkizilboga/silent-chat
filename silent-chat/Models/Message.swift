import Foundation

struct Message: Identifiable, Hashable, Codable {
    let id: Int
    let senderAlias: String
    let ciphertext: String
    let timestamp: Date
    let type: String?
    let fileId: String?
    let isOutgoing: Bool
}
