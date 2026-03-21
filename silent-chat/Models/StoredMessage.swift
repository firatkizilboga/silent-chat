import Foundation
import SwiftData

@Model
final class StoredMessage {
    @Attribute(.unique) var localId: Int
    var serverId: Int?
    var peerAlias: String
    var senderAlias: String
    var content: String
    var type: String
    var timestamp: Date
    var fileId: String?
    var isServerId: Bool
    var isOutgoing: Bool

    init(
        localId: Int,
        serverId: Int?,
        peerAlias: String,
        senderAlias: String,
        content: String,
        type: String,
        timestamp: Date,
        fileId: String?,
        isServerId: Bool,
        isOutgoing: Bool
    ) {
        self.localId = localId
        self.serverId = serverId
        self.peerAlias = peerAlias
        self.senderAlias = senderAlias
        self.content = content
        self.type = type
        self.timestamp = timestamp
        self.fileId = fileId
        self.isServerId = isServerId
        self.isOutgoing = isOutgoing
    }
}
