import Foundation

struct RegisterChallengeRequest: Codable {
    let alias: String
}

struct RegisterChallengeResponse: Codable {
    let nonce: String
}

struct RegisterCompleteRequest: Codable {
    let alias: String
    let nonce: String
    let publicKey: String
    let signedNonce: String
}

struct LoginChallengeRequest: Codable {
    let alias: String
}

struct LoginChallengeResponse: Codable {
    let nonce: String
}

struct LoginCompleteRequest: Codable {
    let alias: String
    let nonce: String
    let signedChallenge: String
}

struct LoginCompleteResponse: Codable {
    let token: String
}

enum AuthServiceError: Error {
    case invalidURL
    case encodingFailed
    case decodingFailed
    case invalidResponse
    case serverError(statusCode: Int)
    case aliasAlreadyTaken
    case userNotFound
    case invalidSignature
    case challengeTimedOut
    case aliasMismatch
}

extension AuthServiceError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL."
        case .encodingFailed:
            return "Failed to encode request."
        case .decodingFailed:
            return "Failed to decode response."
        case .invalidResponse:
            return "Invalid server response."
        case .aliasAlreadyTaken:
            return "Alias already taken."
        case .userNotFound:
            return "User not found or challenge expired."
        case .invalidSignature:
            return "Invalid signature."
        case .challengeTimedOut:
            return "Challenge timed out."
        case .aliasMismatch:
            return "Alias does not match the challenge."
        case .serverError(let statusCode):
            return "Server error (\(statusCode))."
        }
    }
}

final class AuthService {
    private let baseURL: URL

    init(baseURL: URL = URL(string: "https://silentchat-api.firatkizilboga.com")!) {
        self.baseURL = baseURL
    }

    func registerChallenge(alias: String) async throws -> String {
        let requestBody = RegisterChallengeRequest(alias: alias)
        let response: RegisterChallengeResponse = try await sendRequest(
            path: "/auth/register-challenge",
            body: requestBody
        )
        return response.nonce
    }

    func registerComplete(alias: String, nonce: String, publicKey: String, signedNonce: String) async throws {
        let requestBody = RegisterCompleteRequest(alias: alias, nonce: nonce, publicKey: publicKey, signedNonce: signedNonce)
        let _: EmptyResponse = try await sendRequest(
            path: "/auth/register-complete",
            body: requestBody
        )
    }

    func loginChallenge(alias: String) async throws -> String {
        let requestBody = LoginChallengeRequest(alias: alias)
        let response: LoginChallengeResponse = try await sendRequest(
            path: "/auth/login-challenge",
            body: requestBody
        )
        return response.nonce
    }

    func loginComplete(alias: String, nonce: String, signedChallenge: String) async throws -> String {
        let requestBody = LoginCompleteRequest(alias: alias, nonce: nonce, signedChallenge: signedChallenge)
        let response: LoginCompleteResponse = try await sendRequest(
            path: "/auth/login-complete",
            body: requestBody
        )
        return response.token
    }

    private func sendRequest<Body: Codable, Response: Codable>(path: String, body: Body) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw AuthServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        guard let encodedBody = try? encoder.encode(body) else {
            throw AuthServiceError.encodingFailed
        }
        request.httpBody = encodedBody

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthServiceError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw mapError(statusCode: httpResponse.statusCode)
        }

        if Response.self == EmptyResponse.self, let result = EmptyResponse() as? Response {
            return result
        }

        let decoder = JSONDecoder()
        guard let decoded = try? decoder.decode(Response.self, from: data) else {
            throw AuthServiceError.decodingFailed
        }

        return decoded
    }

    private func mapError(statusCode: Int) -> AuthServiceError {
        switch statusCode {
        case 400:
            return .aliasMismatch
        case 409:
            return .aliasAlreadyTaken
        case 404:
            return .userNotFound
        case 401:
            return .invalidSignature
        case 408:
            return .challengeTimedOut
        default:
            return .serverError(statusCode: statusCode)
        }
    }
}

private struct EmptyResponse: Codable {
}
