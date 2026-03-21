import Foundation
import SwiftData

@Model
final class SentMessage {
    @Attribute(.unique) var id: UUID
    var peerAlias: String
    var type: String
    var content: String
    var timestamp: Date

    init(peerAlias: String, type: String, content: String, timestamp: Date) {
        self.id = UUID()
        self.peerAlias = peerAlias
        self.type = type
        self.content = content
        self.timestamp = timestamp
    }
}
