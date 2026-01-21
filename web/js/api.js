/**
 * SilentChat Web Client - API Functions
 * Server communication and message handling
 */

import { SERVER_URL, state } from './config.js';
import { showNotification } from './utils.js';
import {
    generateKeyPair,
    exportPublicKeyPem,
    signData,
    verifySignature,
    importPeerPublicKey,
    encryptAesKey,
    decryptAesKey,
    generateAesKey,
    encryptMessage,
    decryptMessage
} from './crypto.js';
import { db, saveState, saveKeys, loadKeys } from './storage.js';
import { updateLoginStatus } from './ui.js';

// ========================================
// Base API Request
// ========================================
export async function apiRequest(endpoint, options = {}) {
    const url = `${SERVER_URL}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    if (state.token && !options.noAuth) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }

    const response = await fetch(url, { ...options, headers });
    return response;
}

// ========================================
// Authentication
// ========================================
export async function registerAndLogin(alias) {
    // Set alias FIRST so loadKeys and saveKeys can work properly
    state.alias = alias;

    // Try to load existing keys
    const hasKeys = await loadKeys();

    if (!hasKeys) {
        // Generate new keys ONLY if we don't have any
        updateLoginStatus("Generating encryption keys...");
        state.keyPair = await generateKeyPair();
        state.publicKeyPem = await exportPublicKeyPem(state.keyPair.publicKeySpki);

        // Save keys immediately after generation
        await saveKeys();

        // Register
        updateLoginStatus("Registering identity...");
        const chalRes = await apiRequest('/auth/register-challenge', {
            method: 'POST',
            body: JSON.stringify({ alias }),
            noAuth: true
        });

        if (!chalRes.ok) throw new Error("Failed to get registration challenge");
        const { nonce } = await chalRes.json();

        const signedNonce = await signData(state.keyPair.signPrivateKey, nonce);

        const regRes = await apiRequest('/auth/register-complete', {
            method: 'POST',
            body: JSON.stringify({
                alias,
                publicKey: state.publicKeyPem,
                signedNonce
            }),
            noAuth: true
        });

        if (!regRes.ok && regRes.status !== 409) {
            throw new Error("Registration failed");
        }
    } else {
        // Keys loaded successfully from localStorage
        updateLoginStatus("Using existing identity...");
    }

    // Login with either new or existing keys
    updateLoginStatus("Logging in...");
    let loginChalRes = await apiRequest('/auth/login-challenge', {
        method: 'POST',
        body: JSON.stringify({ alias }),
        noAuth: true
    });

    // If user not found (server restart/wipe), try to re-register with SAME keys
    if (loginChalRes.status === 404) {
        console.log("User not found on server, re-registering with existing keys...");
        updateLoginStatus("User not found, re-registering...");

        // Ensure public key is ready
        if (!state.publicKeyPem && state.keyPair) {
            state.publicKeyPem = await exportPublicKeyPem(state.keyPair.publicKeySpki);
        }

        const chalRes = await apiRequest('/auth/register-challenge', {
            method: 'POST',
            body: JSON.stringify({ alias }),
            noAuth: true
        });

        if (!chalRes.ok) throw new Error("Failed to get registration challenge");
        const { nonce } = await chalRes.json();

        const signedNonce = await signData(state.keyPair.signPrivateKey, nonce);

        const regRes = await apiRequest('/auth/register-complete', {
            method: 'POST',
            body: JSON.stringify({
                alias,
                publicKey: state.publicKeyPem,
                signedNonce
            }),
            noAuth: true
        });

        if (!regRes.ok && regRes.status !== 409) {
            throw new Error("Re-registration failed");
        }

        // Retry login
        updateLoginStatus("Logging in again...");
        loginChalRes = await apiRequest('/auth/login-challenge', {
            method: 'POST',
            body: JSON.stringify({ alias }),
            noAuth: true
        });
    }

    if (!loginChalRes.ok) throw new Error("Failed to get login challenge");
    const loginData = await loginChalRes.json();
    const challenge = loginData.challenge || loginData.nonce;

    const signedChallenge = await signData(state.keyPair.signPrivateKey, challenge);

    const loginRes = await apiRequest('/auth/login-complete', {
        method: 'POST',
        body: JSON.stringify({ alias, signedChallenge }),
        noAuth: true
    });

    if (!loginRes.ok) throw new Error("Login failed");
    const { token } = await loginRes.json();

    state.token = token;
    saveState();

    return true;
}

// ========================================
// Key Exchange
// ========================================
export async function fetchPeerKey(targetAlias) {
    if (state.peerPublicKeys[targetAlias]) return true;

    try {
        const res = await apiRequest(`/keys/${targetAlias}`);
        if (!res.ok) return false;

        const { publicKey: pem } = await res.json();

        // Import for both encryption and verification
        state.peerPublicKeys[targetAlias] = {
            encrypt: await importPeerPublicKey(pem, true),
            verify: await importPeerPublicKey(pem, false)
        };

        return true;
    } catch (e) {
        console.error("Failed to fetch peer key:", e);
        return false;
    }
}

// ========================================
// Message Sending
// ========================================
export async function sendMessage(targetAlias, text) {
    // Ensure we have peer's public key
    if (!await fetchPeerKey(targetAlias)) {
        throw new Error("Could not fetch recipient's public key");
    }

    // Establish session if needed
    if (!state.activeSessions[targetAlias]) {
        const aesKey = await generateAesKey();
        state.activeSessions[targetAlias] = aesKey;

        // Send key exchange
        const encryptedKey = await encryptAesKey(
            state.peerPublicKeys[targetAlias].encrypt,
            aesKey
        );
        const keySig = await signData(state.keyPair.signPrivateKey, encryptedKey);

        await apiRequest('/messages', {
            method: 'POST',
            body: JSON.stringify({
                recipientAlias: targetAlias,
                type: 'KEY_EXCHANGE',
                encryptedMessage: encryptedKey,
                signature: keySig
            })
        });
    }

    // Encrypt and send message
    const encryptedMessage = await encryptMessage(state.activeSessions[targetAlias], text);
    const signature = await signData(state.keyPair.signPrivateKey, encryptedMessage);

    await apiRequest('/messages', {
        method: 'POST',
        body: JSON.stringify({
            recipientAlias: targetAlias,
            type: 'TEXT',
            encryptedMessage,
            signature
        })
    });

    // Store locally - parse attachment if present
    if (!state.messages[targetAlias]) state.messages[targetAlias] = [];

    let messageObj = {
        peer: targetAlias,
        sender: 'Me',
        text,
        timestamp: Date.now(),
        serverTimestamp: new Date().toISOString() // Use local time for own messages until confirmed by server
    };

    // Check if this is an attachment message
    try {
        const parsed = JSON.parse(text);
        if (parsed.attachment) {
            messageObj.attachment = parsed.attachment;
            messageObj.text = ''; // Clear raw JSON text
        }
    } catch {
        // Not JSON, regular text message
    }

    state.messages[targetAlias].push(messageObj);
    state.seenSignatures.add(signature);

    await db.addMessage(messageObj);
    saveState();

    return true;
}

// ========================================
// Message Polling
// ========================================
// ========================================
// Pending Message Processing
// ========================================
export async function processPendingMessages(peerAlias) {
    const pending = state.pendingMessages[peerAlias];
    if (!pending || pending.length === 0) return false;

    if (!state.activeSessions[peerAlias]) return false;

    console.log(`[Pending] Retrying ${pending.length} messages for ${peerAlias}`);
    const remaining = [];
    let processedCount = 0;

    for (const msg of pending) {
        try {
            const text = await decryptMessage(
                state.activeSessions[peerAlias],
                msg.encryptedMessage
            );
            console.log('[Pending] Decrypted message from:', peerAlias);

            if (!state.messages[peerAlias]) state.messages[peerAlias] = [];

            let messageObj = {
                peer: peerAlias,
                sender: peerAlias,
                text,
                timestamp: msg.timestamp || Date.now(),
                serverTimestamp: msg.serverTimestamp
            };

            try {
                const parsed = JSON.parse(text);
                if (parsed.attachment) {
                    messageObj.attachment = parsed.attachment;
                    messageObj.text = '';
                }
            } catch { }

            state.messages[peerAlias].push(messageObj);
            await db.addMessage(messageObj);
            // Note: Signature was already marked as seen when it was queued
            processedCount++;
        } catch (e) {
            console.error("[Pending] Decryption failed during retry:", e);
            remaining.push(msg); // Keep it until we might get a working key
        }
    }

    state.pendingMessages[peerAlias] = remaining;

    if (processedCount > 0) {
        // Sort messages again since we inserted late
        state.messages[peerAlias].sort((a, b) => {
            const timeA = a.serverTimestamp || new Date(a.timestamp).toISOString();
            const timeB = b.serverTimestamp || new Date(b.timestamp).toISOString();
            return timeA.localeCompare(timeB);
        });

        await saveState();
        return true;
    }

    return false;
}

export async function pollMessages() {
    try {
        // If we have no timestamp but have local messages, derive from latest local message
        // This prevents re-fetching entire history after cache clear when messages are in IDB
        let since = state.lastServerTimestamp || "";
        if (!since && Object.keys(state.messages).length > 0) {
            let latestTs = "";
            for (const peer in state.messages) {
                const msgs = state.messages[peer];
                for (const m of msgs) {
                    const ts = m.serverTimestamp || "";
                    if (ts > latestTs) latestTs = ts;
                }
            }
            if (latestTs) {
                // Increment by 1ms to avoid re-fetching the same message
                const d = new Date(latestTs.replace(/\+00:00$/, 'Z'));
                if (!isNaN(d.getTime())) {
                    d.setTime(d.getTime() + 1);
                    since = d.toISOString();
                    state.lastServerTimestamp = since;
                    console.log('[Poll] Recovered timestamp from local messages:', since);
                }
            }
        }

        console.log('[Poll] Requesting messages since:', since);
        const res = await apiRequest(`/messages?since=${since}`);
        if (!res.ok) {
            console.log('[Poll] API request failed:', res.status);
            return [];
        }

        const messages = await res.json();
        const updatedPeers = new Set();

        let maxTimestamp = state.lastServerTimestamp || "";

        for (const msg of messages) {
            // Helper to update high watermark - use >= so we capture this message even if seen before
            const markProcessed = () => {
                const ts = msg.serverTimestamp;
                if (ts && ts >= maxTimestamp) {
                    maxTimestamp = ts;
                }
            };

            const sig = msg.signature;
            if (state.seenSignatures.has(sig)) {
                markProcessed();
                continue;
            }

            const sender = msg.senderAlias || 'Unknown';
            if (sender === state.alias) {
                // Mark own messages as seen
                state.seenSignatures.add(sig);
                markProcessed();
                continue;
            }

            console.log('[Poll] Processing new message from:', sender, 'type:', msg.type);

            // Show notification for new message
            if (document.hidden && msg.type === 'TEXT') {
                showNotification(`New message from ${sender}`, "You have a new encrypted message");
            }

            // Fetch sender's key if needed
            if (!await fetchPeerKey(sender)) {
                console.log('[Poll] Could not fetch key for:', sender, '- aborting batch to retry later');
                break; // Transient error: stop processing and retry this message next time
            }

            // Verify signature
            const verified = await verifySignature(
                state.peerPublicKeys[sender].verify,
                msg.encryptedMessage,
                sig
            );
            if (!verified) {
                console.log('[Poll] Signature verification failed for:', sender);
                markProcessed();
                continue;
            }

            if (msg.type === 'KEY_EXCHANGE') {
                try {
                    console.log('[Poll] Processing key exchange from:', sender);
                    const aesKey = await decryptAesKey(
                        state.keyPair.encryptPrivateKey,
                        msg.encryptedMessage
                    );
                    state.activeSessions[sender] = aesKey;
                    state.seenSignatures.add(sig);

                    // Create initial chat entry so peer appears in sidebar
                    if (!state.messages[sender]) {
                        state.messages[sender] = [];
                        updatedPeers.add(sender);
                    }

                    console.log('[Poll] Key exchange successful with:', sender);
                } catch (e) {
                    console.error("Key exchange failed:", e);
                }

                // Retry pending messages now that we might have a session
                if (await processPendingMessages(sender)) {
                    updatedPeers.add(sender);
                }

                markProcessed();
            } else if (msg.type === 'TEXT') {
                if (!state.activeSessions[sender]) {
                    console.log('[Poll] No active session for:', sender, 'queueing message');

                    if (!state.pendingMessages[sender]) state.pendingMessages[sender] = [];
                    state.pendingMessages[sender].push(msg);

                    // CRITICAL: Mark as processed so we don't get stuck in an infinite fetch loop
                    // The message is saved in pendingMessages and will be processed when key arrives
                    state.seenSignatures.add(sig);
                    markProcessed();
                    continue;
                }

                try {
                    const text = await decryptMessage(
                        state.activeSessions[sender],
                        msg.encryptedMessage
                    );
                    console.log('[Poll] Decrypted message from:', sender);

                    if (!state.messages[sender]) state.messages[sender] = [];

                    // Check if the message is an attachment (JSON with attachment property)
                    let messageObj = {
                        peer: sender,
                        sender,
                        text,
                        timestamp: msg.timestamp || Date.now(),
                        serverTimestamp: msg.serverTimestamp // Store server timestamp for sorting
                    };
                    try {
                        const parsed = JSON.parse(text);
                        if (parsed.attachment) {
                            messageObj.attachment = parsed.attachment;
                            messageObj.text = ''; // Clear text since it's just the attachment JSON
                        }
                    } catch {
                        // Not JSON, just regular text - that's fine
                    }

                    state.messages[sender].push(messageObj);
                    await db.addMessage(messageObj);
                    state.seenSignatures.add(sig);
                    updatedPeers.add(sender);
                } catch (e) {
                    console.error("Decryption failed:", e);
                }
                markProcessed();
            }
        }

        // Update high watermark - ALWAYS increment past the last message to avoid re-fetching
        if (maxTimestamp && maxTimestamp >= (state.lastServerTimestamp || "")) {
            // Increment by 1 millisecond using proper Date arithmetic
            // Normalize timezone format for Date parsing (some browsers don't like +00:00)
            const normalizedTs = maxTimestamp.replace(/\+00:00$/, 'Z');
            const ts = new Date(normalizedTs);
            if (!isNaN(ts.getTime())) {
                ts.setTime(ts.getTime() + 1);
                state.lastServerTimestamp = ts.toISOString();
                await db.setConfig('lastServerTimestamp', state.lastServerTimestamp);
                console.log('[Poll] Updated watermark to:', state.lastServerTimestamp);
            } else {
                console.error('[Poll] Failed to parse timestamp:', maxTimestamp);
            }
        }

        if (updatedPeers.size > 0) {
            console.log('[Poll] Saving state, updated peers:', Array.from(updatedPeers));
        }

        // Always save seenSignatures to ensure deduplication works
        await db.setConfig('seenSignatures', Array.from(state.seenSignatures));

        return Array.from(updatedPeers);
    } catch (e) {
        console.error("Poll error:", e);
        return [];
    }
}
