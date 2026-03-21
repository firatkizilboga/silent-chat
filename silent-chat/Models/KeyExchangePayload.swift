import Foundation

struct KeyExchangePayload: Codable {
    let recipientAlias: String
    let type: String
    let encryptedMessage: String
    let signature: String
}
