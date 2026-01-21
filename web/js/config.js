/**
 * SilentChat Web Client - Configuration
 * Server URL and global state management
 */

// Default to production, use localhost for dev if needed
export const SERVER_URL = "https://silentchat-api.firatkizilboga.com";
// export const SERVER_URL = "http://localhost:8000"; // Uncomment for local dev

// ========================================
// State Management
// ========================================
export const state = {
    alias: null,
    token: null,
    keyPair: null,           // { privateKey, publicKey } - CryptoKey objects
    publicKeyPem: null,      // PEM string for registration
    peerPublicKeys: {},      // alias -> CryptoKey
    activeSessions: {},      // alias -> AES key (raw bytes)
    currentPeer: null,
    messages: {},            // peer -> [{ sender, text, timestamp }]
    seenSignatures: new Set(),
    pollingInterval: null,
    // Webcam state
    webcamStream: null,
    facingMode: 'user',       // 'user' (front) or 'environment' (back)
    lastServerTimestamp: null,    // For incremental polling
    pendingMessages: {}      // alias -> [{ ...msg }] for out-of-order delivery
};
