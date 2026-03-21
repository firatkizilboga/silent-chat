import Foundation

struct InboundMessage: Identifiable, Hashable, Codable {
    let id: Int
    let senderAlias: String
    let recipientAlias: String
    let type: String
    let encryptedMessage: String
    let signature: String
    let serverTimestamp: Date?
}
