import Foundation

struct OutgoingMessagePayload: Codable {
    let recipientAlias: String
    let type: String
    let encryptedMessage: String
    let signature: String
}
