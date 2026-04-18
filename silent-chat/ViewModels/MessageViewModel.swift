import Foundation
import Security
import SwiftData

@MainActor
@Observable
final class MessageViewModel {
    // Crypto session state
    var peerPublicKeys: [String: SecKey] = [:]
    var sessionKeys: [String: Data] = [:]
    private var pendingMessages: [String: [PendingInboundMessage]] = [:]

    // Messaging
    var currentPeer: String?
    var messages: [String: [Message]] = [:]
    var seenSignatures: Set<String> = []
    var lastMessageId: Int = 0
    var unreadPeers: Set<String> = []

    // UI
    var isWsConnected: Bool = false
    var error: String?
    var statusMessage: String?
    var isInitiatingSession: Bool = false
    var authRequiresRelogin: Bool = false
    var toast: ToastMessage?
    var toastNavigationTarget: String?

    func latestMessagePreview(for alias: String) -> String? {
        guard let peerMessages = messages[alias], let latest = peerMessages.last else { return nil }
        if latest.type == "FILE" {
            return "File"
        }
        return latest.ciphertext
    }

    func latestMessageTimestamp(for alias: String) -> Date? {
        messages[alias]?.last?.timestamp
    }

    var peers: [String] {
        let messagePeers = Set(messages.keys)
        let pendingPeers = Set(pendingMessages.keys.filter { key in
            if let queued = pendingMessages[key] {
                return !queued.isEmpty
            }
            return false
        })
        let activePeers = Array(messagePeers.union(pendingPeers))

        return activePeers.sorted { lhs, rhs in
            let leftDate = latestMessageTimestamp(for: lhs) ?? .distantPast
            let rightDate = latestMessageTimestamp(for: rhs) ?? .distantPast
            if leftDate == rightDate {
                return lhs.localizedCaseInsensitiveCompare(rhs) == .orderedAscending
            }
            return leftDate > rightDate
        }
    }

    func canStartChat(with alias: String) -> Bool {
        !alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !peers.contains(alias)
    }

    /// Checks whether the given alias exists on the server by fetching their public key.
    func checkAliasExists(alias: String, token: String) async throws {
        _ = try await apiClient.getUserKey(alias: alias, token: token)
    }

    private let apiClient = APIClient()
    private let cryptoService = CryptoService()
    private let keychainService = KeychainService()
    private let webSocketService = WebSocketService()
    private let fileService = FileService.shared
    private let modelContext: ModelContext
    private var localMessageCounter: Int = -1
    private var webSocketReconnectTask: Task<Void, Never>?
    private var currentToken: String?
    private var currentPrivateKey: SecKey?
    private var inFlightAttachmentFetches: Set<Int> = []

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
        loadPersistedSeenSignatures()
        loadPersistedSessionKeys()
        loadStoredMessages()
    }

    func resetState() {
        disconnectWebSocket()
        peerPublicKeys = [:]
        sessionKeys = [:]
        pendingMessages = [:]
        currentPeer = nil
        messages = [:]
        seenSignatures = []
        persistSeenSignatures()
        lastMessageId = 0
        localMessageCounter = -1
        unreadPeers = []
        isWsConnected = false
        error = nil
        statusMessage = nil
        isInitiatingSession = false
        clearPersistedSessionKeys()
    }

    func connectWebSocket(token: String, myPrivateKey: SecKey) {
        if currentToken == token, webSocketService.isConnected {
            return
        }

        disconnectWebSocket()
        currentToken = token
        currentPrivateKey = myPrivateKey

        guard let url = makeWebSocketURL(token: token) else {
            error = "Invalid WebSocket URL."
            return
        }

        webSocketService.connect(
            url: url,
            onMessage: { [weak self] message in
                await self?.handleWebSocketMessage(message)
            },
            onFailure: { [weak self] error in
                await self?.handleWebSocketFailure(error)
            }
        )
        isWsConnected = true

        Task { await fetchMissedMessagesIfNeeded() }
    }

    func disconnectWebSocket() {
        webSocketReconnectTask?.cancel()
        webSocketReconnectTask = nil

        webSocketService.disconnect()

        currentToken = nil
        currentPrivateKey = nil
        isWsConnected = false
    }

    func selectPeer(_ alias: String) {
        currentPeer = alias
        unreadPeers.remove(alias)
    }

    func ensureSession(with peerAlias: String, token: String, myPrivateKey: SecKey) async {
        if sessionKeys[peerAlias] != nil {
            return
        }

        isInitiatingSession = true
        do {
            let aesKey = try await initiateSession(peerAlias: peerAlias, token: token, myPrivateKey: myPrivateKey)
            sessionKeys[peerAlias] = aesKey
            persistSessionKeys()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to initiate session."
        }
        isInitiatingSession = false
    }

    func downloadFile(fileId: String, token: String) async -> URL? {
        statusMessage = "Downloading file..."
        do {
            let response = try await apiClient.getFile(fileId: fileId, token: token)
            let fileURL = try saveDownloadedFile(fileId: response.fileId, encryptedContent: response.encryptedContent)
            statusMessage = "File downloaded."
            return fileURL
        } catch {
            statusMessage = nil
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to download file."
            return nil
        }
    }

    /// Fetches, decrypts, and parses a file attachment for inline display.
    /// Updates the corresponding message in `messages` with the parsed `Attachment`.
    func loadAttachment(for message: Message, peerAlias: String) async {
        guard let fileId = message.fileId,
              let token = currentToken,
              let aesKey = sessionKeys[peerAlias] else { return }

        // Skip if already loaded or a fetch is already in flight
        if message.attachment != nil { return }
        if inFlightAttachmentFetches.contains(message.id) { return }
        inFlightAttachmentFetches.insert(message.id)
        defer { inFlightAttachmentFetches.remove(message.id) }

        do {
            let response = try await apiClient.getFile(fileId: fileId, token: token)

            let decryptedJSON = try cryptoService.decryptMessage(
                aesKey: aesKey,
                encryptedBase64: response.encryptedContent
            )

            guard let attachment = fileService.parseAttachment(from: decryptedJSON) else { return }

            // Update the message in-place
            if var peerMessages = messages[peerAlias],
               let index = peerMessages.firstIndex(where: { $0.id == message.id }) {
                peerMessages[index].attachment = attachment
                messages[peerAlias] = peerMessages
            }
        } catch {
            // Silently fail — the download button remains as fallback
        }
    }

    private func processInboundMessage(_ message: InboundMessage, myPrivateKey: SecKey, source: InboundSource) async {
        if seenSignatures.contains(message.signature) {
            if messageAlreadyStored(message) {
                return
            }
        }
        seenSignatures.insert(message.signature)
        persistSeenSignatures()

        switch message.type {
        case "KEY_EXCHANGE":
            await handleKeyExchange(message, myPrivateKey: myPrivateKey)
        case "TEXT":
            await handleTextMessage(message, source: source)
        case "FILE":
            handleFileMessage(message, source: source)
        default:
            break
        }

        if message.id > lastMessageId {
            lastMessageId = message.id
        }
    }

    func sendTextMessage(peerAlias: String, plaintext: String, token: String, myPrivateKey: SecKey, senderAlias: String) async {
        let trimmed = plaintext.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        do {
            if sessionKeys[peerAlias] == nil {
                await ensureSession(with: peerAlias, token: token, myPrivateKey: myPrivateKey)
            }

            guard let aesKey = sessionKeys[peerAlias] else {
                throw MessageViewModelError.missingSessionKey
            }

            addLocalMessage(
                peerAlias: peerAlias,
                senderAlias: senderAlias,
                content: trimmed,
                type: "TEXT",
                fileId: nil,
                messageId: nil,
                isServerId: false,
                isOutgoing: true
            )
            saveSentMessage(peerAlias: peerAlias, type: "TEXT", content: trimmed, timestamp: .now)

            let encryptedMessage = try cryptoService.encryptMessage(aesKey: aesKey, plaintext: trimmed)
            let signature = try cryptoService.signData(encryptedMessage, with: myPrivateKey)

            let payload = OutgoingMessagePayload(
                recipientAlias: peerAlias,
                type: "TEXT",
                encryptedMessage: encryptedMessage,
                signature: signature
            )

            try await apiClient.sendMessage(payload, token: token)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to send message."
        }
    }

    /// Sends a file message using the Attachment model.
    /// Serializes the attachment to JSON, encrypts and signs it, then POSTs as a FILE message.
    func sendFileMessage(peerAlias: String, attachment: Attachment, token: String, myPrivateKey: SecKey, senderAlias: String) async {
        do {
            if sessionKeys[peerAlias] == nil {
                await ensureSession(with: peerAlias, token: token, myPrivateKey: myPrivateKey)
            }

            guard let aesKey = sessionKeys[peerAlias] else {
                throw MessageViewModelError.missingSessionKey
            }

            guard let jsonString = fileService.serializeAttachment(attachment) else {
                self.error = "Failed to serialize file."
                return
            }

            addLocalMessage(
                peerAlias: peerAlias,
                senderAlias: senderAlias,
                content: attachment.name,
                type: "FILE",
                fileId: nil,
                messageId: nil,
                isServerId: false,
                isOutgoing: true,
                attachment: attachment
            )
            saveSentMessage(peerAlias: peerAlias, type: "FILE", content: attachment.name, timestamp: .now)

            let encryptedMessage = try cryptoService.encryptMessage(aesKey: aesKey, plaintext: jsonString)
            let signature = try cryptoService.signData(encryptedMessage, with: myPrivateKey)

            let payload = OutgoingMessagePayload(
                recipientAlias: peerAlias,
                type: "FILE",
                encryptedMessage: encryptedMessage,
                signature: signature
            )

            try await apiClient.sendMessage(payload, token: token)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to send file."
        }
    }

    private func initiateSession(peerAlias: String, token: String, myPrivateKey: SecKey) async throws -> Data {
        let peerKeyResponse = try await apiClient.getUserKey(alias: peerAlias, token: token)
        let peerPublicKey = try cryptoService.importPublicKeyFromPEM(peerKeyResponse.publicKey)
        peerPublicKeys[peerAlias] = peerPublicKey

        let aesKey = try cryptoService.generateAesKey()
        let encryptedMessage = try cryptoService.encryptAesKey(aesKey, with: peerPublicKey)
        let signature = try cryptoService.signData(encryptedMessage, with: myPrivateKey)

        let payload = KeyExchangePayload(
            recipientAlias: peerAlias,
            type: "KEY_EXCHANGE",
            encryptedMessage: encryptedMessage,
            signature: signature
        )

        try await apiClient.sendMessage(payload, token: token)
        return aesKey
    }

    private func handleWebSocketMessage(_ message: URLSessionWebSocketTask.Message) async {
        switch message {
        case .string(let text):
            if text == "pong" { return }
            await decodeAndProcessInbound(text.data(using: .utf8))
        case .data(let data):
            await decodeAndProcessInbound(data)
        @unknown default:
            break
        }
    }

    private func decodeAndProcessInbound(_ data: Data?) async {
        guard let data else { return }
        guard let privateKey = currentPrivateKey else { return }

        if let inbound = try? JSONDecoder.inbound.decode(InboundMessage.self, from: data) {
            await processInboundMessage(inbound, myPrivateKey: privateKey, source: .webSocket)
        }
    }

    private func handleWebSocketFailure(_ error: Error) async {
        isWsConnected = false
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard let token = currentToken, let privateKey = currentPrivateKey else { return }
        webSocketReconnectTask?.cancel()
        webSocketReconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            await MainActor.run {
                self?.connectWebSocket(token: token, myPrivateKey: privateKey)
            }
        }
    }

    private func makeWebSocketURL(token: String) -> URL? {
        var components = URLComponents()
        components.scheme = "wss"
        components.host = "silentchat-api.firatkizilboga.com"
        components.path = "/ws"
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        return components.url
    }

    private func fetchMissedMessagesIfNeeded() async {
        guard let token = currentToken, let privateKey = currentPrivateKey else { return }
        let since = lastMessageId
        do {
            let missed = try await apiClient.fetchMissedMessages(token: token, since: since)
            for item in missed {
                if let inbound = mapInbound(item) {
                    await processInboundMessage(inbound, myPrivateKey: privateKey, source: .history)
                }
            }
        } catch {
            if let apiError = error as? APIClientError {
                switch apiError {
                case .serverError(let statusCode):
                    if statusCode == 401 {
                        authRequiresRelogin = true
                    }
                default:
                    break
                }
            }
        }
    }

    private func mapInbound(_ message: MessageResponse) -> InboundMessage? {
        let timestamp = parseServerTimestamp(message.serverTimestamp)
        return InboundMessage(
            id: message.id,
            senderAlias: message.senderAlias,
            recipientAlias: message.recipientAlias,
            type: message.type,
            encryptedMessage: message.encryptedMessage,
            signature: message.signature,
            serverTimestamp: timestamp
        )
    }

    private func parseServerTimestamp(_ value: String) -> Date? {
        let isoFormatter = ISO8601DateFormatter()
        if let date = isoFormatter.date(from: value) {
            return date
        }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value)
    }

    private func handleKeyExchange(_ message: InboundMessage, myPrivateKey: SecKey) async {
        do {
            let aesKey = try cryptoService.decryptAesKey(message.encryptedMessage, with: myPrivateKey)
            sessionKeys[message.senderAlias] = aesKey
            persistSessionKeys()
            await flushPendingMessages(for: message.senderAlias)
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to decrypt session key."
        }
    }

    private func handleTextMessage(_ message: InboundMessage, source: InboundSource) async {
        guard let aesKey = sessionKeys[message.senderAlias] else {
            var queue = pendingMessages[message.senderAlias] ?? []
            queue.append(PendingInboundMessage(message: message, source: source))
            pendingMessages[message.senderAlias] = queue
            if let token = currentToken, let privateKey = currentPrivateKey {
                await ensureSession(with: message.senderAlias, token: token, myPrivateKey: privateKey)
            }
            return
        }

        do {
            let plaintext = try cryptoService.decryptMessage(aesKey: aesKey, encryptedBase64: message.encryptedMessage)
            addLocalMessage(
                peerAlias: message.senderAlias,
                senderAlias: message.senderAlias,
                content: plaintext,
                type: "TEXT",
                fileId: nil,
                timestamp: message.serverTimestamp ?? .now,
                messageId: message.id,
                isServerId: true,
                isOutgoing: false
            )
            if currentPeer != message.senderAlias {
                unreadPeers.insert(message.senderAlias)
                if source == .webSocket {
                    showToast(text: plaintext, senderAlias: message.senderAlias)
                }
            }
        } catch {
            // Decryption failed — message will be silently dropped
        }
    }

    private func handleFileMessage(_ message: InboundMessage, source: InboundSource) {
        let fileId = fileService.extractFileId(from: message.encryptedMessage)

        addLocalMessage(
            peerAlias: message.senderAlias,
            senderAlias: message.senderAlias,
            content: "File received",
            type: "FILE",
            fileId: fileId,
            timestamp: message.serverTimestamp ?? .now,
            messageId: message.id,
            isServerId: true,
            isOutgoing: false
        )
        if currentPeer != message.senderAlias {
            unreadPeers.insert(message.senderAlias)
            if source == .webSocket {
                showToast(text: "📎 File received", senderAlias: message.senderAlias)
            }
        }
    }

    private func flushPendingMessages(for senderAlias: String) async {
        guard let queued = pendingMessages[senderAlias] else { return }
        pendingMessages[senderAlias] = []
        for item in queued {
            await handleTextMessage(item.message, source: item.source)
        }
    }

    private func addLocalMessage(
        peerAlias: String,
        senderAlias: String,
        content: String,
        type: String,
        fileId: String?,
        timestamp: Date = .now,
        messageId: Int?,
        isServerId: Bool,
        isOutgoing: Bool,
        attachment: Attachment? = nil
    ) {
        let localId: Int
        if let messageId {
            localId = messageId
            if isServerId, messageId > lastMessageId {
                lastMessageId = messageId
            }
        } else {
            localId = nextLocalMessageId()
        }

        var message = Message(
            id: localId,
            senderAlias: senderAlias,
            ciphertext: content,
            timestamp: timestamp,
            type: type,
            fileId: fileId,
            isOutgoing: isOutgoing
        )
        message.attachment = attachment

        var peerMessages = messages[peerAlias] ?? []
        peerMessages.removeAll { $0.id == localId }
        peerMessages.append(message)
        peerMessages.sort { $0.timestamp < $1.timestamp }
        messages[peerAlias] = peerMessages

        saveStoredMessage(
            localId: localId,
            serverId: isServerId ? messageId : nil,
            peerAlias: peerAlias,
            senderAlias: senderAlias,
            content: content,
            type: type,
            timestamp: timestamp,
            fileId: fileId,
            isServerId: isServerId,
            isOutgoing: isOutgoing
        )
    }

    private func saveSentMessage(peerAlias: String, type: String, content: String, timestamp: Date) {
        let record = SentMessage(peerAlias: peerAlias, type: type, content: content, timestamp: timestamp)
        modelContext.insert(record)
        do {
            try modelContext.save()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to save message."
        }
    }

    private func saveStoredMessage(
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
        if isServerId, let serverId {
            let predicate = #Predicate<StoredMessage> { $0.serverId == serverId }
            let descriptor = FetchDescriptor<StoredMessage>(predicate: predicate)
            if let existing = try? modelContext.fetch(descriptor), !existing.isEmpty {
                return
            }
        }
        let record = StoredMessage(
            localId: localId,
            serverId: serverId,
            peerAlias: peerAlias,
            senderAlias: senderAlias,
            content: content,
            type: type,
            timestamp: timestamp,
            fileId: fileId,
            isServerId: isServerId,
            isOutgoing: isOutgoing
        )
        modelContext.insert(record)
        do {
            try modelContext.save()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Failed to save message."
        }
    }

    private func loadStoredMessages() {
        let descriptor = FetchDescriptor<StoredMessage>()
        guard let stored = try? modelContext.fetch(descriptor) else { return }

        var rebuilt: [String: [Message]] = [:]
        var maxServerId = 0
        var minLocalId = -1

        for item in stored {
            let message = Message(
                id: item.localId,
                senderAlias: item.senderAlias,
                ciphertext: item.content,
                timestamp: item.timestamp,
                type: item.type,
                fileId: item.fileId,
                isOutgoing: item.isOutgoing
            )
            rebuilt[item.peerAlias, default: []].append(message)

            if item.isServerId, let serverId = item.serverId, serverId > maxServerId {
                maxServerId = serverId
            }
            if item.localId < minLocalId {
                minLocalId = item.localId
            }
        }

        for key in rebuilt.keys {
            rebuilt[key]?.sort(by: { $0.timestamp < $1.timestamp })
        }

        messages = rebuilt
        lastMessageId = maxServerId
        localMessageCounter = minLocalId - 1
    }

    private func nextLocalMessageId() -> Int {
        localMessageCounter -= 1
        return localMessageCounter
    }

    private func showToast(text: String, senderAlias: String) {
        let toast = ToastMessage(text: text, senderAlias: senderAlias)
        self.toast = toast

        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self else { return }
            if self.toast?.id == toast.id {
                self.toast = nil
            }
        }
    }

    private func messageAlreadyStored(_ message: InboundMessage) -> Bool {
        let messageId: Int? = message.id
        let predicate = #Predicate<StoredMessage> { $0.serverId == messageId }
        let descriptor = FetchDescriptor<StoredMessage>(predicate: predicate)
        if let existing = try? modelContext.fetch(descriptor), !existing.isEmpty {
            return true
        }

        if let peerMessages = messages[message.senderAlias] {
            return peerMessages.contains { $0.id == message.id }
        }

        return false
    }

    private func hasActiveChat(with alias: String) -> Bool {
        if let peerMessages = messages[alias], !peerMessages.isEmpty {
            return true
        }
        if let queued = pendingMessages[alias], !queued.isEmpty {
            return true
        }
        return false
    }

    private func persistSeenSignatures() {
        guard let data = try? JSONEncoder().encode(Array(seenSignatures)) else { return }
        try? keychainService.saveData(data, for: StorageKeys.seenSignatures)
    }

    private func loadPersistedSeenSignatures() {
        guard let data = try? keychainService.loadData(for: StorageKeys.seenSignatures),
              let list = try? JSONDecoder.inbound.decode([String].self, from: data) else {
            return
        }
        seenSignatures = Set(list)
    }

    private func persistSessionKeys() {
        let encoded = sessionKeys.mapValues { $0.base64EncodedString() }
        guard let data = try? JSONEncoder().encode(encoded) else { return }
        try? keychainService.saveData(data, for: StorageKeys.sessionKeys)
    }

    private func loadPersistedSessionKeys() {
        guard let data = try? keychainService.loadData(for: StorageKeys.sessionKeys),
              let encoded = try? JSONDecoder.inbound.decode([String: String].self, from: data) else {
            return
        }
        var loaded: [String: Data] = [:]
        for (alias, value) in encoded {
            guard let keyData = Data(base64Encoded: value) else { continue }
            loaded[alias] = keyData
        }
        sessionKeys = loaded
    }

    private func clearPersistedSessionKeys() {
        try? keychainService.delete(key: StorageKeys.sessionKeys)
    }

    private func saveDownloadedFile(fileId: String, encryptedContent: String) throws -> URL {
        guard let data = Data(base64Encoded: encryptedContent) else {
            throw MessageViewModelError.invalidFileData
        }

        let fileURL = URL.temporaryDirectory
            .appending(path: fileId)
            .appendingPathExtension("bin")
        try data.write(to: fileURL, options: [.atomic])
        return fileURL
    }
}

extension JSONDecoder {
    static let inbound: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
