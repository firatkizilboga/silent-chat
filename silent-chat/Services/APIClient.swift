import Foundation

struct UserKeyResponse: Codable {
    let alias: String
    let publicKey: String
}

struct FileResponse: Codable {
    let fileId: String
    let encryptedContent: String
}

struct MessageResponse: Codable {
    let id: Int
    let senderAlias: String
    let recipientAlias: String
    let type: String
    let encryptedMessage: String
    let signature: String
    let serverTimestamp: String
}

enum APIClientError: Error {
    case invalidURL
    case encodingFailed
    case decodingFailed
    case invalidResponse
    case serverError(statusCode: Int)
}

final class APIClient {
    private let baseURL: URL
    private let tokenRefreshService = TokenRefreshService()

    init(baseURL: URL = URL(string: "https://silentchat-api.firatkizilboga.com")!) {
        self.baseURL = baseURL
    }

    func getUserKey(alias: String, token: String) async throws -> UserKeyResponse {
        return try await sendRequest(path: "/keys/\(alias)", token: token)
    }

    func sendMessage<Payload: Codable>(_ payload: Payload, token: String) async throws {
        let _: EmptyResponse = try await sendRequest(
            path: "/messages",
            token: token,
            method: "POST",
            body: payload
        )
    }

    func getFile(fileId: String, token: String) async throws -> FileResponse {
        return try await sendRequest(path: "/files/\(fileId)", token: token)
    }

    func fetchMissedMessages(token: String, since: Int) async throws -> [MessageResponse] {
        return try await sendRequest(
            path: "/messages",
            token: token,
            queryItems: [
                URLQueryItem(name: "since", value: String(since)),
                URLQueryItem(name: "timeout_seconds", value: "0")
            ]
        )
    }

    private func sendRequest<Response: Codable>(path: String, token: String) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIClientError.invalidURL
        }
        return try await sendRequest(url: url, token: token)
    }

    private func sendRequest<Response: Codable>(path: String, token: String, queryItems: [URLQueryItem]) async throws -> Response {
        guard let base = URL(string: path, relativeTo: baseURL),
              var components = URLComponents(url: base, resolvingAgainstBaseURL: true) else {
            throw APIClientError.invalidURL
        }
        components.queryItems = queryItems
        guard let url = components.url else {
            throw APIClientError.invalidURL
        }
        return try await sendRequest(url: url, token: token)
    }

    private func sendRequest<Body: Codable, Response: Codable>(path: String, token: String, method: String, body: Body) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIClientError.invalidURL
        }
        return try await sendRequest(url: url, token: token, method: method, body: body)
    }

    private func sendRequest<Response: Codable>(url: URL, token: String) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        applyAuthHeaders(to: &request, token: token)

        return try await perform(request)
    }

    private func sendRequest<Body: Codable, Response: Codable>(url: URL, token: String, method: String, body: Body) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        applyAuthHeaders(to: &request, token: token)

        let encoder = JSONEncoder()
        guard let encodedBody = try? encoder.encode(body) else {
            throw APIClientError.encodingFailed
        }
        request.httpBody = encodedBody

        return try await perform(request)
    }

    private func applyAuthHeaders(to request: inout URLRequest, token: String) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    private func perform<Response: Codable>(_ request: URLRequest, retryOnUnauthorized: Bool = true) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if httpResponse.statusCode == 401, retryOnUnauthorized {
            do {
                let refreshedToken = try await tokenRefreshService.refreshToken()
                var refreshedRequest = request
                applyAuthHeaders(to: &refreshedRequest, token: refreshedToken)
                return try await perform(refreshedRequest, retryOnUnauthorized: false)
            } catch {
                throw APIClientError.serverError(statusCode: httpResponse.statusCode)
            }
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIClientError.serverError(statusCode: httpResponse.statusCode)
        }

        if Response.self == EmptyResponse.self, let result = EmptyResponse() as? Response {
            return result
        }

        let decoder = JSONDecoder()
        guard let decoded = try? decoder.decode(Response.self, from: data) else {
            throw APIClientError.decodingFailed
        }

        return decoded
    }
}

private struct EmptyResponse: Codable {
}
