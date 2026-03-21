import Foundation

@MainActor
final class WebSocketService {
    private var webSocketTask: URLSessionWebSocketTask?
    private var webSocketReceiveTask: Task<Void, Never>?
    private var webSocketPingTask: Task<Void, Never>?
    private var currentURL: URL?

    var isConnected: Bool {
        webSocketTask != nil
    }

    func connect(
        url: URL,
        onMessage: @escaping (URLSessionWebSocketTask.Message) async -> Void,
        onFailure: @escaping (Error) async -> Void
    ) {
        if currentURL == url, webSocketTask != nil {
            return
        }

        disconnect()
        currentURL = url

        let task = URLSession.shared.webSocketTask(with: url)
        webSocketTask = task
        task.resume()

        startReceiveLoop(task: task, onMessage: onMessage, onFailure: onFailure)
        startPingLoop(task: task)
    }

    func disconnect() {
        webSocketPingTask?.cancel()
        webSocketPingTask = nil

        webSocketReceiveTask?.cancel()
        webSocketReceiveTask = nil

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        currentURL = nil
    }

    private func startReceiveLoop(
        task: URLSessionWebSocketTask,
        onMessage: @escaping (URLSessionWebSocketTask.Message) async -> Void,
        onFailure: @escaping (Error) async -> Void
    ) {
        webSocketReceiveTask = Task {
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    await onMessage(message)
                } catch {
                    await onFailure(error)
                    return
                }
            }
        }
    }

    private func startPingLoop(task: URLSessionWebSocketTask) {
        webSocketPingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard task.state == .running else { continue }
                try? await task.send(.string("ping"))
            }
        }
    }
}
