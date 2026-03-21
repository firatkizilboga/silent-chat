# Silent Chat

A secure, end-to-end encrypted messaging app for iOS built with SwiftUI. All messages are encrypted using hybrid cryptography (RSA-2048 + AES-256-GCM) and delivered in real time over WebSocket.

## Features

- **End-to-End Encryption** — Messages encrypted with AES-256-GCM; session keys exchanged via RSA-2048 (OAEP-SHA256)
- **Passwordless Authentication** — Cryptographic challenge-response login using RSA signatures
- **Real-Time Messaging** — WebSocket connection with automatic reconnection and missed-message recovery
- **Encrypted File Sharing** — Upload and download files, encrypted with the same per-conversation session key
- **Local Persistence** — Message history stored with SwiftData; keys and tokens secured in the iOS Keychain
- **Toast Notifications** — In-app notification overlay for incoming messages from other conversations

## Requirements

- iOS 26.0+
- Xcode 26.0+
- Swift 6.2+

## Architecture

```
silent-chat/
├── Models/                # Data types and SwiftData models
├── Services/
│   ├── APIClient          # REST client with automatic token refresh
│   ├── AuthService        # Register / login endpoints
│   ├── CryptoService      # RSA + AES cryptographic operations
│   ├── KeychainService    # Secure storage wrapper
│   ├── TokenRefreshService # Actor-based token refresh
│   └── WebSocketService   # Real-time messaging
├── ViewModels/
│   ├── AuthViewModel      # Authentication state
│   └── MessageViewModel   # Messaging, encryption, persistence
└── Views/
    ├── Auth/              # Login & registration
    ├── Chat/              # Conversation list, detail, input
    ├── Components/        # Toast, file preview
    └── Profile/           # User profile & logout
```

### Tech Stack

| Layer | Technology |
|---|---|
| UI | SwiftUI, `@Observable` |
| Persistence | SwiftData, Keychain |
| Crypto | CryptoKit (AES-GCM), Security framework (RSA) |
| Networking | URLSession, URLSessionWebSocketTask |
| Concurrency | Swift structured concurrency (async/await, actors) |

## How It Works

### Authentication

Silent Chat uses passwordless, cryptographic authentication:

1. **Register** — The client generates an RSA-2048 signing key pair, signs a server-issued nonce, and sends the public key + signature to complete registration.
2. **Login** — The server issues a challenge nonce; the client signs it with the stored private key to receive a JWT.
3. **Token Refresh** — On 401 responses, the app automatically re-authenticates in the background.

### Encryption

Each conversation uses a dedicated AES-256 session key:

1. **Key Exchange** — Sender generates a random AES-256 key, encrypts it with the recipient's RSA public key, signs the payload, and sends a `KEY_EXCHANGE` message.
2. **Message Encryption** — Text and files are encrypted with AES-256-GCM (12-byte nonce + ciphertext + 16-byte tag), then base64-encoded.
3. **Signatures** — Every outgoing message is signed with the sender's RSA private key for authenticity.

Messages that arrive before a session is established are queued and automatically decrypted once the key exchange completes.

## API

The app communicates with a backend at `silentchat-api.firatkizilboga.com`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register-challenge` | Request registration nonce |
| POST | `/auth/register-complete` | Complete registration |
| POST | `/auth/login-challenge` | Request login nonce |
| POST | `/auth/login-complete` | Complete login, receive JWT |
| GET | `/keys/{alias}` | Fetch a user's public key |
| POST | `/messages` | Send an encrypted message |
| GET | `/messages?since={id}` | Fetch missed messages |
| GET | `/files/{fileId}` | Download an encrypted file |
| WSS | `/ws?token={token}` | Real-time message stream |

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/silent-chat.git
   ```
2. Open `silent-chat.xcodeproj` in Xcode.
3. Build and run on a device or simulator running iOS 26.0+.
4. Register with a unique alias — your cryptographic keys are generated automatically.

## License

This project is provided as-is for educational and personal use.
