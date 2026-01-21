/**
 * SilentChat Web Client - Storage
 * IndexedDB service and state persistence
 */

import { state } from './config.js';
import { arrayBufferToBase64, base64ToArrayBuffer } from './utils.js';
import { exportPublicKeyPem } from './crypto.js';

// ========================================
// IndexedDB Configuration
// ========================================
const DB_NAME = 'SilentChatDB';
const DB_VERSION = 1;

// ========================================
// Storage Service Class
// ========================================
class StorageService {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = e => reject(e.target.error);

            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('config')) {
                    db.createObjectStore('config', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('peer', 'peer', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };

            request.onsuccess = e => {
                this.db = e.target.result;
                resolve();
            };
        });
    }

    async setConfig(key, value) {
        return this.runTransaction('config', 'readwrite', store => store.put({ key, value }));
    }

    async getConfig(key) {
        const result = await this.runTransaction('config', 'readonly', store => store.get(key));
        return result ? result.value : null;
    }

    async addMessage(msg) {
        return this.runTransaction('messages', 'readwrite', store => store.add(msg));
    }

    async getAllMessages() {
        return this.runTransaction('messages', 'readonly', store => store.getAll());
    }

    async clearSession() {
        console.log('[Storage] Clearing session...');

        // 1. Clear messages (simple operation)
        await this.runTransaction('messages', 'readwrite', store => store.clear());
        console.log('[Storage] Messages cleared');

        // 2. Selectively clear config - preserve all per-alias keys (keys_*)
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('config', 'readwrite');
            const store = tx.objectStore('config');
            const request = store.openCursor();

            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    const key = cursor.key;
                    // Preserve all per-alias keys (keys_*) and session keys
                    if (!key.startsWith('keys_') && key !== 'sessionKeys') {
                        console.log('[Storage] Deleting config:', key);
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };

            tx.oncomplete = () => {
                console.log('[Storage] Session cleared successfully');
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    runTransaction(storeName, mode, op) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = op(store);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// Singleton instance
export const db = new StorageService();

// ========================================
// State Persistence Functions
// ========================================
export async function saveState() {
    // Only save config that changes often or is small
    if (state.alias) await db.setConfig('alias', state.alias);
    if (state.token) await db.setConfig('token', state.token);
    await db.setConfig('seenSignatures', Array.from(state.seenSignatures));
    await db.setConfig('lastServerTimestamp', state.lastServerTimestamp);
    if (state.currentPeer) await db.setConfig('currentPeer', state.currentPeer);

    // Save pending messages so we don't lose them on reload
    if (Object.keys(state.pendingMessages).length > 0) {
        await db.setConfig('pendingMessages', state.pendingMessages);
    }

    // Also save session keys for message recovery
    await saveSessionKeys();
}

// Save AES session keys for each peer (enables decrypting old messages after cache wipe)
export async function saveSessionKeys() {
    if (Object.keys(state.activeSessions).length === 0) return;

    // Convert Uint8Array keys to base64 for storage
    const sessionsToStore = {};
    for (const [peer, keyBytes] of Object.entries(state.activeSessions)) {
        sessionsToStore[peer] = arrayBufferToBase64(keyBytes.buffer || keyBytes);
    }

    await db.setConfig('sessionKeys', sessionsToStore);
    console.log('[Storage] Saved session keys for', Object.keys(sessionsToStore).length, 'peers');
}

// Load AES session keys from storage
export async function loadSessionKeys() {
    const storedSessions = await db.getConfig('sessionKeys');
    if (!storedSessions) return false;

    try {
        // Convert base64 back to Uint8Array
        for (const [peer, keyB64] of Object.entries(storedSessions)) {
            state.activeSessions[peer] = new Uint8Array(base64ToArrayBuffer(keyB64));
        }
        console.log('[Storage] Loaded session keys for', Object.keys(storedSessions).length, 'peers');
        return true;
    } catch (e) {
        console.error('[Storage] Failed to load session keys:', e);
        return false;
    }
}

export async function saveKeys() {
    if (!state.keyPair || !state.alias) return;
    const keys = {
        alias: state.alias,
        privateKey: arrayBufferToBase64(state.keyPair.privateKeyPkcs8),
        publicKey: arrayBufferToBase64(state.keyPair.publicKeySpki)
    };
    // Store per-alias to support multiple users on same browser
    await db.setConfig(`keys_${state.alias}`, keys);
    console.log('[Storage] Saved keys for:', state.alias);
}

export async function loadKeys() {
    // Try per-alias storage first, then fallback to old format for migration
    let keys = await db.getConfig(`keys_${state.alias}`);

    // Migration: try old 'keys' format if per-alias not found
    if (!keys) {
        const oldKeys = await db.getConfig('keys');
        if (oldKeys && oldKeys.alias === state.alias) {
            keys = oldKeys;
            // Migrate to new format
            await db.setConfig(`keys_${state.alias}`, keys);
            console.log('[Storage] Migrated keys to per-alias format');
        }
    }

    if (!keys) return false;

    try {

        const privateKeyPkcs8 = base64ToArrayBuffer(keys.privateKey);
        const publicKeySpki = base64ToArrayBuffer(keys.publicKey);

        // Import for encryption (RSA-OAEP)
        const encryptPrivateKey = await crypto.subtle.importKey(
            "pkcs8",
            privateKeyPkcs8,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
        const encryptPublicKey = await crypto.subtle.importKey(
            "spki",
            publicKeySpki,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );

        // Import for signing (RSASSA-PKCS1-v1_5)
        const signPrivateKey = await crypto.subtle.importKey(
            "pkcs8",
            privateKeyPkcs8,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            true,
            ["sign"]
        );
        const signPublicKey = await crypto.subtle.importKey(
            "spki",
            publicKeySpki,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            true,
            ["verify"]
        );

        state.keyPair = {
            encryptPrivateKey,
            encryptPublicKey,
            signPrivateKey,
            signPublicKey,
            privateKeyPkcs8,
            publicKeySpki
        };
        state.publicKeyPem = await exportPublicKeyPem(publicKeySpki);

        console.log(`[Keys] Loaded existing keys for '${state.alias}'`);
        return true;
    } catch (e) {
        console.error("Failed to load keys:", e);
        return false;
    }
}

export async function loadState() {
    await db.init();

    state.alias = await db.getConfig('alias');
    state.token = await db.getConfig('token');
    state.lastServerTimestamp = await db.getConfig('lastServerTimestamp');
    state.currentPeer = await db.getConfig('currentPeer');

    // Migration: Fix corrupted timestamps (numbers like 2026 or non-ISO strings)
    if (typeof state.lastServerTimestamp === 'number' ||
        (typeof state.lastServerTimestamp === 'string' && !state.lastServerTimestamp.includes('-'))) {
        console.log('[Migration] Resetting invalid timestamp:', state.lastServerTimestamp);
        state.lastServerTimestamp = null;
        await db.setConfig('lastServerTimestamp', null);
    }

    state.lastServerTimestamp = state.lastServerTimestamp || null;
    const seenSigs = await db.getConfig('seenSignatures');
    state.seenSignatures = new Set(seenSigs || []);

    const pending = await db.getConfig('pendingMessages');
    state.pendingMessages = pending || {};

    if (!state.alias) return false;

    // Load messages from IDB into memory
    const allMessages = await db.getAllMessages();
    state.messages = {};
    for (const msg of allMessages) {
        if (!state.messages[msg.peer]) state.messages[msg.peer] = [];
        state.messages[msg.peer].push(msg);
    }

    // Sort by serverTimestamp if available, otherwise fallback to local timestamp (lexicographically for ISO strings)
    for (const peer in state.messages) {
        state.messages[peer].sort((a, b) => {
            const timeA = a.serverTimestamp || new Date(a.timestamp).toISOString();
            const timeB = b.serverTimestamp || new Date(b.timestamp).toISOString();
            return timeA.localeCompare(timeB);
        });
    }

    // Load session keys for message decryption
    await loadSessionKeys();

    return true;
}
