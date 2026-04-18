/**
 * SilentChat - IndexedDB Storage Service
 * v2: at-rest encryption, compound [peer,timestamp] index
 */

import { arrayBufferToBase64, base64ToArrayBuffer } from './utils.js';
import { exportPublicKeyPem, encryptAtRest, decryptAtRest } from './crypto.js';

const DB_NAME = 'SilentChatDB';
const DB_VERSION = 2;

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
                    store.createIndex('peer_timestamp', ['peer', 'timestamp'], { unique: false });
                    store.createIndex('msgId', 'msgId', { unique: false });
                } else if (e.oldVersion < 2) {
                    const store = e.target.transaction.objectStore('messages');
                    if (!store.indexNames.contains('peer_timestamp')) {
                        store.createIndex('peer_timestamp', ['peer', 'timestamp'], { unique: false });
                    }
                    if (!store.indexNames.contains('msgId')) {
                        store.createIndex('msgId', 'msgId', { unique: false });
                    }
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

    async getSalt() {
        return this.getConfig('atRestSalt');
    }

    async setSalt(salt) {
        return this.setConfig('atRestSalt', salt);
    }

    async addMessage(msg, atRestKey) {
        await this.init();

        const { peer, timestamp, msgId } = msg;

        // Dedup by msgId using index instead of full scan
        if (msgId) {
            const existing = await this.runTransaction('messages', 'readonly', store =>
                store.index('msgId').get(msgId)
            );
            if (existing) {
                console.log('[Storage] Skipping duplicate msgId:', msgId);
                return;
            }
        }

        let stored;
        if (atRestKey) {
            const { peer: _p, timestamp: _t, msgId: _m, id: _id, ...rest } = msg;
            const encrypted = await encryptAtRest(atRestKey, rest);
            stored = { peer, timestamp: timestamp || Date.now(), msgId: msgId || null, encrypted };
        } else {
            stored = msg;
        }

        return this.runTransaction('messages', 'readwrite', store => store.add(stored));
    }

    async getMessagesByPeer(peer, atRestKey, { limit = 100, before = Date.now() + 1e12 } = {}) {
        await this.init();

        // Collect records inside IDB transaction (no async inside cursor)
        const records = await new Promise((resolve, reject) => {
            const tx = this.db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const index = store.index('peer_timestamp');
            const range = IDBKeyRange.bound([peer, 0], [peer, before], false, true);
            const results = [];

            const req = index.openCursor(range, 'prev');
            req.onsuccess = e => {
                const cursor = e.target.result;
                if (!cursor || results.length >= limit) {
                    resolve(results.reverse()); // chronological order for display
                    return;
                }
                results.push(cursor.value);
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        });

        if (!atRestKey) return records;

        // Decrypt outside IDB transaction
        const decrypted = await Promise.all(records.map(async record => {
            if (!record.encrypted) return record; // legacy unencrypted
            try {
                const data = await decryptAtRest(atRestKey, record.encrypted);
                return { ...data, peer: record.peer, timestamp: record.timestamp, msgId: record.msgId, id: record.id };
            } catch {
                console.error('[Storage] Failed to decrypt message id:', record.id);
                return null;
            }
        }));

        return decrypted.filter(Boolean);
    }

    async getAllMessages() {
        return this.runTransaction('messages', 'readonly', store => store.getAll());
    }

    async migrateToEncrypted(atRestKey) {
        await this.init();
        const records = await this.getAllMessages();
        const plaintext = records.filter(r => !r.encrypted);
        if (plaintext.length === 0) return;

        console.log(`[Storage] Migrating ${plaintext.length} messages to encrypted storage`);
        for (const record of plaintext) {
            const { id, peer, timestamp, msgId, ...rest } = record;
            const encrypted = await encryptAtRest(atRestKey, rest);
            await this.runTransaction('messages', 'readwrite', store =>
                store.put({ id, peer, timestamp, msgId: msgId || null, encrypted })
            );
        }
        console.log('[Storage] Migration complete');
    }

    async clearSession() {
        console.log('[Storage] Clearing session...');
        await this.runTransaction('messages', 'readwrite', store => store.clear());

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('config', 'readwrite');
            const store = tx.objectStore('config');
            const request = store.openCursor();

            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    const key = cursor.key;
                    if (!key.startsWith('keys_') && key !== 'sessionKeys' && key !== 'atRestSalt') {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };

            tx.oncomplete = () => resolve();
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

export async function decryptStoredMessages(records, atRestKey) {
    if (!atRestKey) return records;

    const decrypted = await Promise.all(records.map(async record => {
        if (!record.encrypted) return record; // legacy unencrypted
        try {
            const data = await decryptAtRest(atRestKey, record.encrypted);
            return { ...data, peer: record.peer, timestamp: record.timestamp, msgId: record.msgId, id: record.id };
        } catch {
            console.error('[Storage] Failed to decrypt message id:', record.id);
            return null;
        }
    }));

    return decrypted.filter(Boolean);
}

export async function loadPeerMessages(peer, atRestKey, { limit = 100, before = Date.now() + 1e12 } = {}) {
    const records = await db.getMessagesByPeer(peer, null, { limit, before });
    return decryptStoredMessages(records, atRestKey);
}

// ========================================
// Session Keys
// ========================================

export async function saveSessionKeys(activeSessions, atRestKey) {
    if (Object.keys(activeSessions).length === 0) return;

    const sessionsToStore = {};
    for (const [peer, keyBytes] of Object.entries(activeSessions)) {
        sessionsToStore[peer] = arrayBufferToBase64(keyBytes.buffer || keyBytes);
    }

    if (atRestKey) {
        const encrypted = await encryptAtRest(atRestKey, sessionsToStore);
        await db.setConfig('sessionKeys', { encrypted });
    } else {
        await db.setConfig('sessionKeys', sessionsToStore);
    }
}

export async function loadSessionKeys(atRestKey) {
    const stored = await db.getConfig('sessionKeys');
    if (!stored) return {};

    try {
        let raw;
        if (atRestKey && stored.encrypted) {
            raw = await decryptAtRest(atRestKey, stored.encrypted);
        } else if (!stored.encrypted) {
            raw = stored; // legacy unencrypted
        } else {
            return {};
        }

        const sessions = {};
        for (const [peer, keyB64] of Object.entries(raw)) {
            sessions[peer] = new Uint8Array(base64ToArrayBuffer(keyB64));
        }
        return sessions;
    } catch (e) {
        console.error('[Storage] Failed to load session keys:', e);
        return {};
    }
}

// ========================================
// RSA Keys
// ========================================

export async function saveKeys(alias, keyPair, atRestKey) {
    if (!keyPair || !alias) return;
    const keys = {
        alias,
        privateKey: arrayBufferToBase64(keyPair.privateKeyPkcs8),
        publicKey: arrayBufferToBase64(keyPair.publicKeySpki)
    };

    if (atRestKey) {
        const encrypted = await encryptAtRest(atRestKey, keys);
        await db.setConfig(`keys_${alias}`, { encrypted });
    } else {
        await db.setConfig(`keys_${alias}`, keys);
    }
    console.log('[Storage] Saved keys for:', alias);
}

export async function loadKeys(alias, atRestKey) {
    let stored = await db.getConfig(`keys_${alias}`);

    // Migration from old per-alias unkeyed format
    if (!stored) {
        const oldKeys = await db.getConfig('keys');
        if (oldKeys && (oldKeys.alias === alias || oldKeys.encrypted)) {
            stored = oldKeys;
            await db.setConfig(`keys_${alias}`, stored);
            console.log('[Storage] Migrated keys to per-alias format');
        }
    }

    if (!stored) return null;

    try {
        let keys;
        if (atRestKey && stored.encrypted) {
            keys = await decryptAtRest(atRestKey, stored.encrypted);
        } else if (!stored.encrypted) {
            keys = stored; // legacy unencrypted
        } else {
            throw new Error('KEYS_ENCRYPTED');
        }

        const privateKeyPkcs8 = base64ToArrayBuffer(keys.privateKey);
        const publicKeySpki = base64ToArrayBuffer(keys.publicKey);

        const encryptPrivateKey = await crypto.subtle.importKey(
            'pkcs8', privateKeyPkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']
        );
        const encryptPublicKey = await crypto.subtle.importKey(
            'spki', publicKeySpki, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']
        );
        const signPrivateKey = await crypto.subtle.importKey(
            'pkcs8', privateKeyPkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign']
        );
        const signPublicKey = await crypto.subtle.importKey(
            'spki', publicKeySpki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['verify']
        );

        const keyPair = { encryptPrivateKey, encryptPublicKey, signPrivateKey, signPublicKey, privateKeyPkcs8, publicKeySpki };
        const publicKeyPem = await exportPublicKeyPem(publicKeySpki);

        console.log(`[Keys] Loaded existing keys for '${alias}'`);
        return { keyPair, publicKeyPem };
    } catch (e) {
        console.error('Failed to load keys:', e);
        return null;
    }
}

// ========================================
// State Persistence
// ========================================

async function encryptConfig(key, value, atRestKey) {
    if (atRestKey) {
        const encrypted = await encryptAtRest(atRestKey, value);
        await db.setConfig(key, { encrypted });
    } else {
        await db.setConfig(key, value);
    }
}

async function decryptConfig(key, atRestKey, fallback = null) {
    const stored = await db.getConfig(key);
    if (stored === null || stored === undefined) return fallback;
    if (atRestKey && stored?.encrypted) {
        return decryptAtRest(atRestKey, stored.encrypted);
    }
    return stored; // legacy plaintext
}

export async function loadState(atRestKey) {
    await db.init();

    const alias = await db.getConfig('alias');
    if (!alias) return null;

    try {
        const token = await decryptConfig('token', atRestKey, null);
        const lastMessageId = await db.getConfig('lastMessageId') || 0;
        const currentPeer = await decryptConfig('currentPeer', atRestKey, null);
        const seenSigsArr = await decryptConfig('seenSignatures', atRestKey, []);
        const seenSignatures = new Set(seenSigsArr);
        const pendingMessages = await decryptConfig('pendingMessages', atRestKey, {});

        // Load per-peer messages (latest 100 each)
        const allRecords = await db.getAllMessages();
        const peers = [...new Set(allRecords.map(r => r.peer))];
        const messages = {};
        for (const peer of peers) {
            messages[peer] = await db.getMessagesByPeer(peer, null, { limit: 100 });
        }

        const activeSessions = await loadSessionKeys(atRestKey);

        return { alias, token, lastMessageId, currentPeer, seenSignatures, pendingMessages, messages, activeSessions };
    } catch (e) {
        if (e.message?.includes('decryption') || e.name === 'OperationError') {
            throw new Error('WRONG_PASSPHRASE');
        }
        throw e;
    }
}

export async function saveState(state, atRestKey) {
    if (state.alias) await db.setConfig('alias', state.alias);
    if (state.token) await encryptConfig('token', state.token, atRestKey);
    await encryptConfig('seenSignatures', Array.from(state.seenSignatures), atRestKey);
    await db.setConfig('lastMessageId', state.lastMessageId || 0);
    if (state.currentPeer) await encryptConfig('currentPeer', state.currentPeer, atRestKey);
    if (Object.keys(state.pendingMessages).length > 0) {
        await encryptConfig('pendingMessages', state.pendingMessages, atRestKey);
    }
    await saveSessionKeys(state.activeSessions, atRestKey);
}
