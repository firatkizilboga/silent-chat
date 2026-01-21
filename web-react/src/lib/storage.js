/**
 * SilentChat - IndexedDB Storage Service
 */

import { arrayBufferToBase64, base64ToArrayBuffer } from './utils.js';
import { exportPublicKeyPem } from './crypto.js';

const DB_NAME = 'SilentChatDB';
const DB_VERSION = 1;

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
        // Check for duplicate by msgId to prevent double saves
        if (msg.msgId) {
            const existing = await this.getAllMessages();
            if (existing.some(m => m.msgId === msg.msgId)) {
                console.log('[Storage] Skipping duplicate msgId:', msg.msgId);
                return;
            }
        }
        return this.runTransaction('messages', 'readwrite', store => store.add(msg));
    }

    async getAllMessages() {
        return this.runTransaction('messages', 'readonly', store => store.getAll());
    }

    async clearSession() {
        console.log('[Storage] Clearing session...');
        await this.runTransaction('messages', 'readwrite', store => store.clear());
        console.log('[Storage] Messages cleared');

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('config', 'readwrite');
            const store = tx.objectStore('config');
            const request = store.openCursor();

            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    const key = cursor.key;
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

export const db = new StorageService();

// ========================================
// State Persistence Functions
// ========================================

export async function saveSessionKeys(activeSessions) {
    if (Object.keys(activeSessions).length === 0) return;

    const sessionsToStore = {};
    for (const [peer, keyBytes] of Object.entries(activeSessions)) {
        sessionsToStore[peer] = arrayBufferToBase64(keyBytes.buffer || keyBytes);
    }

    await db.setConfig('sessionKeys', sessionsToStore);
    console.log('[Storage] Saved session keys for', Object.keys(sessionsToStore).length, 'peers');
}

export async function loadSessionKeys() {
    const storedSessions = await db.getConfig('sessionKeys');
    if (!storedSessions) return {};

    try {
        const sessions = {};
        for (const [peer, keyB64] of Object.entries(storedSessions)) {
            sessions[peer] = new Uint8Array(base64ToArrayBuffer(keyB64));
        }
        console.log('[Storage] Loaded session keys for', Object.keys(storedSessions).length, 'peers');
        return sessions;
    } catch (e) {
        console.error('[Storage] Failed to load session keys:', e);
        return {};
    }
}

export async function saveKeys(alias, keyPair) {
    if (!keyPair || !alias) return;
    const keys = {
        alias,
        privateKey: arrayBufferToBase64(keyPair.privateKeyPkcs8),
        publicKey: arrayBufferToBase64(keyPair.publicKeySpki)
    };
    await db.setConfig(`keys_${alias}`, keys);
    console.log('[Storage] Saved keys for:', alias);
}

export async function loadKeys(alias) {
    let keys = await db.getConfig(`keys_${alias}`);

    // Migration from old format
    if (!keys) {
        const oldKeys = await db.getConfig('keys');
        if (oldKeys && oldKeys.alias === alias) {
            keys = oldKeys;
            await db.setConfig(`keys_${alias}`, keys);
            console.log('[Storage] Migrated keys to per-alias format');
        }
    }

    if (!keys) return null;

    try {
        const privateKeyPkcs8 = base64ToArrayBuffer(keys.privateKey);
        const publicKeySpki = base64ToArrayBuffer(keys.publicKey);

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

        const keyPair = {
            encryptPrivateKey,
            encryptPublicKey,
            signPrivateKey,
            signPublicKey,
            privateKeyPkcs8,
            publicKeySpki
        };

        const publicKeyPem = await exportPublicKeyPem(publicKeySpki);

        console.log(`[Keys] Loaded existing keys for '${alias}'`);
        return { keyPair, publicKeyPem };
    } catch (e) {
        console.error("Failed to load keys:", e);
        return null;
    }
}

export async function loadState() {
    await db.init();

    const alias = await db.getConfig('alias');
    const token = await db.getConfig('token');
    const lastMessageId = await db.getConfig('lastMessageId') || 0;
    const currentPeer = await db.getConfig('currentPeer');

    const seenSigs = await db.getConfig('seenSignatures');
    const seenSignatures = new Set(seenSigs || []);

    const pending = await db.getConfig('pendingMessages');
    const pendingMessages = pending || {};

    if (!alias) return null;

    // Load messages from IDB
    const allMessages = await db.getAllMessages();
    const messages = {};
    for (const msg of allMessages) {
        if (!messages[msg.peer]) messages[msg.peer] = [];
        messages[msg.peer].push(msg);
    }

    // Sort by msgId or timestamp
    for (const peer in messages) {
        messages[peer].sort((a, b) => {
            return (a.msgId || a.timestamp || 0) - (b.msgId || b.timestamp || 0);
        });
    }

    const activeSessions = await loadSessionKeys();

    return {
        alias,
        token,
        lastMessageId,
        currentPeer,
        seenSignatures,
        pendingMessages,
        messages,
        activeSessions
    };
}

export async function saveState(state) {
    if (state.alias) await db.setConfig('alias', state.alias);
    if (state.token) await db.setConfig('token', state.token);
    await db.setConfig('seenSignatures', Array.from(state.seenSignatures));
    await db.setConfig('lastMessageId', state.lastMessageId || 0);
    if (state.currentPeer) await db.setConfig('currentPeer', state.currentPeer);

    if (Object.keys(state.pendingMessages).length > 0) {
        await db.setConfig('pendingMessages', state.pendingMessages);
    }

    await saveSessionKeys(state.activeSessions);
}
