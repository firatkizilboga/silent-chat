/**
 * SilentChat - API Functions
 * Server communication with AbortController support
 * Updated for ID-based polling and FILE message type
 */

import { SERVER_URL } from './config.js';
import { showNotification, pemToArrayBuffer, arrayBufferToBase64 } from './utils.js';
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
import { db, saveKeys, loadKeys, getPinnedPeerKeyFingerprint, pinPeerKeyFingerprint } from './storage.js';
const SELF_SYNC_TYPE = 'SELF_SYNC';

// ========================================
// Base API Request with AbortController and Auto-Refresh
// ========================================
export async function apiRequest(endpoint, options = {}, token = null, signal = null, refreshContext = null) {
    const url = `${SERVER_URL}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    if (token && !options.noAuth) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const fetchOptions = { ...options, headers };
    if (signal) {
        fetchOptions.signal = signal;
    }

    let response = await fetch(url, fetchOptions);

    // Auto-refresh logic
    if (response.status === 401 && refreshContext && !options.noAuth && !options._isRetry) {
        console.log(`[API] 401 on ${endpoint}, attempting refresh...`);
        try {
            const { alias, keyPair, dispatch } = refreshContext;
            const newToken = await refreshToken(alias, keyPair);
            
            // Update global state
            dispatch({ type: 'SET_TOKEN', token: newToken });

            // Retry original request
            const retryHeaders = { ...headers, 'Authorization': `Bearer ${newToken}` };
            response = await fetch(url, { ...fetchOptions, headers: retryHeaders, _isRetry: true });
        } catch (e) {
            console.error('[API] Refresh and retry failed:', e);
            // If refresh fails, let the original 401 stand or throw
        }
    }

    return response;
}

function buildRefreshContext(state, dispatch) {
    if (!state || !dispatch || !state.alias || !state.keyPair) return null;
    return { alias: state.alias, keyPair: state.keyPair, dispatch };
}

async function apiRequestWithState(endpoint, options = {}, state = null, dispatch = null, signal = null) {
    const token = state?.token || null;
    const refreshContext = buildRefreshContext(state, dispatch);
    return apiRequest(endpoint, options, token, signal, refreshContext);
}

async function getPublicKeyFingerprint(pem) {
    const spki = pemToArrayBuffer(pem);
    const digest = await crypto.subtle.digest('SHA-256', spki);
    return arrayBufferToBase64(digest);
}

async function validateAndPinPeerKey(alias, pem, atRestKey = null) {
    const fingerprint = await getPublicKeyFingerprint(pem);
    const pinnedFingerprint = await getPinnedPeerKeyFingerprint(alias, atRestKey);

    if (!pinnedFingerprint) {
        await pinPeerKeyFingerprint(alias, fingerprint, atRestKey);
        console.log(`[KeyPin] Pinned public key for @${alias}`);
        return;
    }

    if (pinnedFingerprint !== fingerprint) {
        const error = new Error(`Security warning: @${alias}'s public key changed. Messages were blocked.`);
        error.code = 'KEY_PIN_MISMATCH';
        error.peer = alias;
        error.expected = pinnedFingerprint;
        error.received = fingerprint;
        throw error;
    }
}

function generateClientMsgId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ========================================
// Authentication
// ========================================
export async function registerAndLogin(alias, setStatus) {
    const loadedKeys = await loadKeys(alias);
    let keyPair, publicKeyPem;

    if (!loadedKeys) {
        setStatus?.("Generating encryption keys...");
        keyPair = await generateKeyPair();
        publicKeyPem = await exportPublicKeyPem(keyPair.publicKeySpki);

        await saveKeys(alias, keyPair);

        setStatus?.("Registering identity...");
        const chalRes = await apiRequest('/auth/register-challenge', {
            method: 'POST',
            body: JSON.stringify({ alias }),
            noAuth: true
        });

        if (!chalRes.ok) throw new Error("Failed to get registration challenge");
        const { nonce } = await chalRes.json();

        const signedNonce = await signData(keyPair.signPrivateKey, nonce);

        const regRes = await apiRequest('/auth/register-complete', {
            method: 'POST',
            body: JSON.stringify({
                alias,
                nonce,
                publicKey: publicKeyPem,
                signedNonce
            }),
            noAuth: true
        });

        if (!regRes.ok && regRes.status !== 409) {
            throw new Error("Registration failed");
        }
    } else {
        keyPair = loadedKeys.keyPair;
        publicKeyPem = loadedKeys.publicKeyPem;
        setStatus?.("Using existing identity...");
    }

    setStatus?.("Logging in...");
    let loginChalRes = await apiRequest('/auth/login-challenge', {
        method: 'POST',
        body: JSON.stringify({ alias }),
        noAuth: true
    });

    if (loginChalRes.status === 404) {
        console.log("User not found on server, re-registering with existing keys...");
        setStatus?.("User not found, re-registering...");

        if (!publicKeyPem && keyPair) {
            publicKeyPem = await exportPublicKeyPem(keyPair.publicKeySpki);
        }

        const chalRes = await apiRequest('/auth/register-challenge', {
            method: 'POST',
            body: JSON.stringify({ alias }),
            noAuth: true
        });

        if (!chalRes.ok) throw new Error("Failed to get registration challenge");
        const { nonce } = await chalRes.json();

        const signedNonce = await signData(keyPair.signPrivateKey, nonce);

        const regRes = await apiRequest('/auth/register-complete', {
            method: 'POST',
            body: JSON.stringify({
                alias,
                nonce,
                publicKey: publicKeyPem,
                signedNonce
            }),
            noAuth: true
        });

        if (!regRes.ok && regRes.status !== 409) {
            throw new Error("Re-registration failed");
        }

        setStatus?.("Logging in again...");
        loginChalRes = await apiRequest('/auth/login-challenge', {
            method: 'POST',
            body: JSON.stringify({ alias }),
            noAuth: true
        });
    }

    if (!loginChalRes.ok) throw new Error("Failed to get login challenge");
    const loginData = await loginChalRes.json();
    const challenge = loginData.challenge || loginData.nonce;

    const signedChallenge = await signData(keyPair.signPrivateKey, challenge);

    const loginRes = await apiRequest('/auth/login-complete', {
        method: 'POST',
        body: JSON.stringify({ alias, nonce: challenge, signedChallenge }),
        noAuth: true
    });

    if (!loginRes.ok) throw new Error("Login failed");
    const { token } = await loginRes.json();

    return { keyPair, publicKeyPem, token };
}

// ========================================
// Token Refresh (uses in-memory keypair — no IDB needed)
// ========================================
export async function refreshToken(alias, keyPair) {
    const chalRes = await apiRequest('/auth/login-challenge', {
        method: 'POST',
        body: JSON.stringify({ alias }),
        noAuth: true
    });
    if (!chalRes.ok) throw new Error(`Failed to get login challenge: ${chalRes.status}`);
    
    const { nonce } = await chalRes.json();
    const signedChallenge = await signData(keyPair.signPrivateKey, nonce);
    const loginRes = await apiRequest('/auth/login-complete', {
        method: 'POST',
        body: JSON.stringify({ alias, nonce, signedChallenge }),
        noAuth: true
    });
    
    if (!loginRes.ok) throw new Error(`Token refresh failed: ${loginRes.status}`);
    const { token } = await loginRes.json();
    return token;
}

// ========================================
// Key Exchange
// ========================================
export async function fetchPeerKey(targetAlias, state, dispatch = null) {
    const peerPublicKeys = state?.peerPublicKeys || {};
    if (peerPublicKeys[targetAlias]) return peerPublicKeys[targetAlias];

    try {
        const res = await apiRequestWithState(`/keys/${targetAlias}`, {}, state, dispatch);
        if (!res.ok) return null;

        const { publicKey: pem } = await res.json();
        await validateAndPinPeerKey(targetAlias, pem, state?.atRestKey);

        return {
            encrypt: await importPeerPublicKey(pem, true),
            verify: await importPeerPublicKey(pem, false)
        };
    } catch (e) {
        if (e?.code === 'KEY_PIN_MISMATCH') {
            console.error('[KeyPin] Key mismatch detected:', e);
            throw e;
        }
        console.error("Failed to fetch peer key:", e);
        return null;
    }
}

async function ensureSelfSyncSession(state, dispatch) {
    let session = state.activeSessions[state.alias];
    if (session) return session;

    let selfKey = state.peerPublicKeys[state.alias];
    if (!selfKey) {
        selfKey = await fetchPeerKey(state.alias, state, dispatch);
        if (!selfKey) throw new Error("Could not fetch your public key for self-sync");
        dispatch({ type: 'SET_PEER_KEY', peer: state.alias, key: selfKey });
    }

    const aesKey = await generateAesKey();
    dispatch({ type: 'SET_SESSION', peer: state.alias, key: aesKey });

    const encryptedKey = await encryptAesKey(selfKey.encrypt, aesKey);
    const keySig = await signData(state.keyPair.signPrivateKey, encryptedKey);

    await apiRequestWithState('/messages', {
        method: 'POST',
        body: JSON.stringify({
            recipientAlias: state.alias,
            type: 'KEY_EXCHANGE',
            encryptedMessage: encryptedKey,
            signature: keySig
        })
    }, state, dispatch);

    return aesKey;
}

async function sendSelfSyncCopy(state, dispatch, payload) {
    const session = await ensureSelfSyncSession(state, dispatch);
    const encryptedPayload = await encryptMessage(session, JSON.stringify(payload));
    const signature = await signData(state.keyPair.signPrivateKey, encryptedPayload);

    await apiRequestWithState('/messages', {
        method: 'POST',
        body: JSON.stringify({
            recipientAlias: state.alias,
            type: SELF_SYNC_TYPE,
            encryptedMessage: encryptedPayload,
            signature
        })
    }, state, dispatch);
}

// ========================================
// Message Sending (TEXT)
// ========================================
export async function sendMessage(targetAlias, text, state, dispatch) {
    const clientMsgId = generateClientMsgId();

    let peerKey = state.peerPublicKeys[targetAlias];
    if (!peerKey) {
        peerKey = await fetchPeerKey(targetAlias, state, dispatch);
        if (!peerKey) throw new Error("Could not fetch recipient's public key");
        dispatch({ type: 'SET_PEER_KEY', peer: targetAlias, key: peerKey });
    }

    let session = state.activeSessions[targetAlias];
    if (!session) {
        const aesKey = await generateAesKey();
        session = aesKey;
        dispatch({ type: 'SET_SESSION', peer: targetAlias, key: aesKey });

        const encryptedKey = await encryptAesKey(peerKey.encrypt, aesKey);
        const keySig = await signData(state.keyPair.signPrivateKey, encryptedKey);

        await apiRequestWithState('/messages', {
            method: 'POST',
            body: JSON.stringify({
                recipientAlias: targetAlias,
                type: 'KEY_EXCHANGE',
                encryptedMessage: encryptedKey,
                signature: keySig
            })
        }, state, dispatch);
    }

    const encryptedMessage = await encryptMessage(session, text);
    const signature = await signData(state.keyPair.signPrivateKey, encryptedMessage);

    await apiRequestWithState('/messages', {
        method: 'POST',
        body: JSON.stringify({
            recipientAlias: targetAlias,
            type: 'TEXT',
            encryptedMessage,
            signature
        })
    }, state, dispatch);

    let messageObj = {
        peer: targetAlias,
        sender: 'Me',
        text,
        timestamp: Date.now(),
        clientMsgId
    };

    dispatch({ type: 'ADD_MESSAGE', peer: targetAlias, message: messageObj });
    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature });

    await db.addMessage(messageObj, state?.atRestKey);

    try {
        await sendSelfSyncCopy(state, dispatch, {
            kind: 'TEXT',
            targetAlias,
            text,
            timestamp: messageObj.timestamp,
            clientMsgId
        });
    } catch (e) {
        console.error('[Sync] Failed to send self-copy:', e);
    }

    return true;
}

// ========================================
// File Sending (FILE type)
// ========================================
export async function sendFile(targetAlias, file, state, dispatch) {
    const clientMsgId = generateClientMsgId();

    let peerKey = state.peerPublicKeys[targetAlias];
    if (!peerKey) {
        peerKey = await fetchPeerKey(targetAlias, state, dispatch);
        if (!peerKey) throw new Error("Could not fetch recipient's public key");
        dispatch({ type: 'SET_PEER_KEY', peer: targetAlias, key: peerKey });
    }

    let session = state.activeSessions[targetAlias];
    if (!session) {
        const aesKey = await generateAesKey();
        session = aesKey;
        dispatch({ type: 'SET_SESSION', peer: targetAlias, key: aesKey });

        const encryptedKey = await encryptAesKey(peerKey.encrypt, aesKey);
        const keySig = await signData(state.keyPair.signPrivateKey, encryptedKey);

        await apiRequestWithState('/messages', {
            method: 'POST',
            body: JSON.stringify({
                recipientAlias: targetAlias,
                type: 'KEY_EXCHANGE',
                encryptedMessage: encryptedKey,
                signature: keySig
            })
        }, state, dispatch);
    }

    // Read file as base64
    const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    // Create attachment object and encrypt
    const attachment = {
        type: file.type || 'application/octet-stream',
        name: file.name,
        size: file.size,
        data: fileData
    };
    const encryptedContent = await encryptMessage(session, JSON.stringify(attachment));
    const signature = await signData(state.keyPair.signPrivateKey, encryptedContent);

    // Send as FILE type - server will store separately
    await apiRequestWithState('/messages', {
        method: 'POST',
        body: JSON.stringify({
            recipientAlias: targetAlias,
            type: 'FILE',
            encryptedMessage: encryptedContent,
            signature
        })
    }, state, dispatch);

    let messageObj = {
        peer: targetAlias,
        sender: 'Me',
        text: '',
        attachment,
        timestamp: Date.now(),
        clientMsgId
    };

    dispatch({ type: 'ADD_MESSAGE', peer: targetAlias, message: messageObj });
    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature });

    await db.addMessage(messageObj, state?.atRestKey);

    try {
        await sendSelfSyncCopy(state, dispatch, {
            kind: 'FILE',
            targetAlias,
            attachment,
            timestamp: messageObj.timestamp,
            clientMsgId
        });
    } catch (e) {
        console.error('[Sync] Failed to send file self-copy:', e);
    }

    return true;
}

// ========================================
// Message Polling (ID-based)
// ========================================
export async function pollMessages(state, dispatch, signal) {
    try {
        // Use lastMessageId (integer) instead of timestamp
        let since = state.lastMessageId || 0;

        // If we have a watermark but NO local messages, reset it
        // This handles corrupt state where watermark was kept but messages lost
        const hasLocalMessages = Object.values(state.messages).some(arr => arr.length > 0);
        if (since > 0 && !hasLocalMessages) {
            console.log('[Poll] Resetting watermark - no local messages but id:', since);
            since = 0;
            dispatch({ type: 'SET_LAST_MESSAGE_ID', id: 0 });
            await db.setConfig('lastMessageId', 0);
        }

        console.log('[Poll] Requesting messages since id:', since);
        const res = await apiRequestWithState(`/messages?since=${since}`, {}, state, dispatch, signal);
        if (res.status === 401) {
            console.log('[Poll] Token expired (401)');
            throw new Error("AUTH_EXPIRED");
        }
        if (!res.ok) {
            console.log('[Poll] API request failed:', res.status);
            return [];
        }

        const messages = await res.json();
        const updatedPeers = new Set();
        let maxId = state.lastMessageId || 0;

        for (const msg of messages) {
            // Track max ID for watermark
            if (msg.id && msg.id > maxId) {
                maxId = msg.id;
            }

            const sig = msg.signature;
            if (state.seenSignatures.has(sig)) {
                continue;
            }

            const sender = msg.senderAlias || 'Unknown';
            if (sender === state.alias && msg.type !== 'KEY_EXCHANGE' && msg.type !== SELF_SYNC_TYPE) {
                dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
                continue;
            }

            console.log('[Poll] Processing new message from:', sender, 'type:', msg.type, 'id:', msg.id);

            if (document.hidden && (msg.type === 'TEXT' || msg.type === 'FILE')) {
                showNotification(`New message from ${sender}`, "You have a new encrypted message");
            }

            // Fetch sender's key if needed
            let peerKey = state.peerPublicKeys[sender];
            if (!peerKey) {
                peerKey = await fetchPeerKey(sender, state, dispatch);
                if (!peerKey) {
                    console.log('[Poll] Could not fetch key for:', sender, '- aborting batch');
                    break;
                }
                dispatch({ type: 'SET_PEER_KEY', peer: sender, key: peerKey });
            }

            // Verify signature (skip for FILE type - we verify on fetched content)
            if (msg.type !== 'FILE') {
                const verified = await verifySignature(peerKey.verify, msg.encryptedMessage, sig);
                if (!verified) {
                    console.log('[Poll] Signature verification failed for:', sender);
                    continue;
                }
            }

            if (msg.type === 'KEY_EXCHANGE') {
                try {
                    console.log('[Poll] Processing key exchange from:', sender);
                    const aesKey = await decryptAesKey(state.keyPair.encryptPrivateKey, msg.encryptedMessage);
                    dispatch({ type: 'SET_SESSION', peer: sender, key: aesKey });
                    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
                    if (sender !== state.alias) {
                        dispatch({ type: 'INIT_PEER', peer: sender });
                        updatedPeers.add(sender);
                    }
                    console.log('[Poll] Key exchange successful with:', sender);

                    // Process pending messages
                    const pending = state.pendingMessages[sender];
                    if (pending && pending.length > 0) {
                        console.log(`[Pending] Processing ${pending.length} messages for ${sender}`);
                        for (const pendingMsg of pending) {
                            const processedPeer = await processTextOrFileMessage(pendingMsg, sender, aesKey, dispatch, state);
                            if (processedPeer) updatedPeers.add(processedPeer);
                        }
                        dispatch({ type: 'CLEAR_PENDING', peer: sender });
                        if (sender !== state.alias) updatedPeers.add(sender);
                    }
                } catch (e) {
                    console.error("Key exchange failed:", e);
                }
            } else if (msg.type === 'TEXT') {
                const session = state.activeSessions[sender];
                if (!session) {
                    console.log('[Poll] No active session for:', sender, 'queueing message');
                    dispatch({ type: 'ADD_PENDING', peer: sender, message: msg });
                    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
                    continue;
                }

                try {
                    const text = await decryptMessage(session, msg.encryptedMessage);
                    console.log('[Poll] Decrypted message from:', sender);

                    let messageObj = {
                        peer: sender,
                        sender,
                        text,
                        timestamp: msg.timestamp || Date.now(),
                        msgId: msg.id
                    };

                    // Backward compatibility: detect embedded attachments in TEXT messages
                    // (from old vanilla JS version that sent files as TEXT with JSON)
                    try {
                        const parsed = JSON.parse(text);
                        if (parsed.attachment) {
                            messageObj.attachment = parsed.attachment;
                            messageObj.text = '';
                        }
                    } catch {
                        // Not JSON, just regular text - that's fine
                    }

                    dispatch({ type: 'ADD_MESSAGE', peer: sender, message: messageObj });
                    await db.addMessage(messageObj, state?.atRestKey);
                    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
                    updatedPeers.add(sender);
                } catch (e) {
                    console.error("Decryption failed:", e);
                }
            } else if (msg.type === SELF_SYNC_TYPE) {
                const session = state.activeSessions[sender];
                if (!session) {
                    console.log('[Poll] No self session for sync copy, queueing');
                    dispatch({ type: 'ADD_PENDING', peer: sender, message: msg });
                    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
                    continue;
                }

                const processedPeer = await processTextOrFileMessage(msg, sender, session, dispatch, state);
                if (processedPeer) updatedPeers.add(processedPeer);
                dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
            } else if (msg.type === 'FILE') {
                const session = state.activeSessions[sender];
                if (!session) {
                    console.log('[Poll] No active session for FILE from:', sender, 'queueing');
                    dispatch({ type: 'ADD_PENDING', peer: sender, message: msg });
                    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
                    continue;
                }

                try {
                    // The encryptedMessage contains a reference to the file
                    const { fileId } = JSON.parse(msg.encryptedMessage);
                    console.log('[Poll] Fetching file:', fileId);

                    // Fetch the actual encrypted content
                    const fileRes = await apiRequestWithState(`/files/${fileId}`, {}, state, dispatch, signal);
                    if (!fileRes.ok) {
                        console.error('[Poll] Failed to fetch file:', fileId);
                        continue;
                    }

                    const { encryptedContent } = await fileRes.json();

                    // Verify signature on the actual encrypted content
                    const verified = await verifySignature(peerKey.verify, encryptedContent, sig);
                    if (!verified) {
                        console.log('[Poll] FILE signature verification failed for:', sender);
                        continue;
                    }

                    const decrypted = await decryptMessage(session, encryptedContent);
                    const attachment = JSON.parse(decrypted);

                    let messageObj = {
                        peer: sender,
                        sender,
                        text: '',
                        attachment,
                        timestamp: msg.timestamp || Date.now(),
                        msgId: msg.id
                    };

                    dispatch({ type: 'ADD_MESSAGE', peer: sender, message: messageObj });
                    await db.addMessage(messageObj, state?.atRestKey);
                    dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: sig });
                    updatedPeers.add(sender);
                    console.log('[Poll] File received from:', sender);
                } catch (e) {
                    console.error("File decryption failed:", e);
                }
            }
        }

        // Update watermark with max ID
        if (maxId > (state.lastMessageId || 0)) {
            dispatch({ type: 'SET_LAST_MESSAGE_ID', id: maxId });
            await db.setConfig('lastMessageId', maxId);
            console.log('[Poll] Updated watermark to id:', maxId);
        }

        return Array.from(updatedPeers);
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('[Poll] Request aborted');
            return [];
        }
        if (e.message === 'AUTH_EXPIRED') {
            throw e;
        }
        console.error("Poll error:", e);
        return [];
    }
}

// Helper to process TEXT/FILE messages (used for pending queue too)
export async function processTextOrFileMessage(msg, sender, session, dispatch, state) {
    try {
        if (msg.type === SELF_SYNC_TYPE) {
            const decrypted = await decryptMessage(session, msg.encryptedMessage);
            const payload = JSON.parse(decrypted);
            const targetAlias = payload?.targetAlias;

            if (!targetAlias || !payload?.kind) {
                console.error('[Sync] Invalid self-copy payload');
                return null;
            }

            const messageObj = {
                peer: targetAlias,
                sender: 'Me',
                text: payload.kind === 'TEXT' ? (payload.text || '') : '',
                attachment: payload.kind === 'FILE' ? payload.attachment : undefined,
                timestamp: payload.timestamp || msg.timestamp || Date.now(),
                msgId: msg.id,
                clientMsgId: payload.clientMsgId || null
            };

            dispatch({ type: 'INIT_PEER', peer: targetAlias });
            dispatch({ type: 'ADD_MESSAGE', peer: targetAlias, message: messageObj });
            await db.addMessage(messageObj, state?.atRestKey);
            return targetAlias;
        } else if (msg.type === 'FILE') {
            const { fileId } = JSON.parse(msg.encryptedMessage);
            const fileRes = await apiRequestWithState(`/files/${fileId}`, {}, state, dispatch);
            if (!fileRes.ok) return;
            const { encryptedContent } = await fileRes.json();
            const decrypted = await decryptMessage(session, encryptedContent);
            const attachment = JSON.parse(decrypted);

            let messageObj = {
                peer: sender,
                sender,
                text: '',
                attachment,
                timestamp: msg.timestamp || Date.now(),
                msgId: msg.id
            };
            dispatch({ type: 'ADD_MESSAGE', peer: sender, message: messageObj });
            await db.addMessage(messageObj, state?.atRestKey);
            return sender;
        } else {
            const text = await decryptMessage(session, msg.encryptedMessage);
            let messageObj = {
                peer: sender,
                sender,
                text,
                timestamp: msg.timestamp || Date.now(),
                msgId: msg.id
            };
            dispatch({ type: 'ADD_MESSAGE', peer: sender, message: messageObj });
            await db.addMessage(messageObj, state?.atRestKey);
            return sender;
        }
    } catch (e) {
        console.error("[Process] Message failed:", e);
        return null;
    }
}

// Shared message handler for WebSocket and Polling
export async function handleIncomingMessage(msg, state, dispatch) {
    // Ignore server acknowledgments for commands
    if (msg.cmd) return;

    if (msg.type === 'online_status') {
        dispatch({ type: 'SET_ONLINE_STATUS', peer: msg.user, status: msg.status });
        return;
    }

    if (state.seenSignatures.has(msg.signature)) return;

    const sender = msg.senderAlias || 'Unknown';
    if (sender === state.alias && msg.type !== 'KEY_EXCHANGE' && msg.type !== SELF_SYNC_TYPE) {
        dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
        return;
    }

    // console.log('[MSG] Processing from:', sender, 'id:', msg.id);

    if (document.hidden && (msg.type === 'TEXT' || msg.type === 'FILE')) {
        showNotification(`New message from ${sender}`, "You have a new encrypted message");
    }

    let peerKey = state.peerPublicKeys[sender];
    if (!peerKey) {
        peerKey = await fetchPeerKey(sender, state, dispatch);
        if (!peerKey) {
            console.log('[MSG] Could not fetch key for:', sender);
            return;
        }
        dispatch({ type: 'SET_PEER_KEY', peer: sender, key: peerKey });
    }

    // Verify signature (skip for FILE type - we verify on fetched content)
    if (msg.type !== 'FILE') {
        const verified = await verifySignature(peerKey.verify, msg.encryptedMessage, msg.signature);
        if (!verified) {
            console.log('[MSG] Signature verification failed for:', sender);
            return;
        }
    }

    if (msg.type === 'KEY_EXCHANGE') {
        try {
            const aesKey = await decryptAesKey(state.keyPair.encryptPrivateKey, msg.encryptedMessage);
            dispatch({ type: 'SET_SESSION', peer: sender, key: aesKey });
            dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
            if (sender !== state.alias) {
                dispatch({ type: 'INIT_PEER', peer: sender });
            }
            // Pending messages will be handled by AppContext useEffect
        } catch (e) {
            console.error("Key exchange failed:", e);
        }
    } else if (msg.type === 'TEXT') {
        const session = state.activeSessions[sender];
        if (!session) {
            dispatch({ type: 'ADD_PENDING', peer: sender, message: msg });
            dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
            return;
        }
        await processTextOrFileMessage(msg, sender, session, dispatch, state);
        dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
    } else if (msg.type === SELF_SYNC_TYPE) {
        const session = state.activeSessions[sender];
        if (!session) {
            dispatch({ type: 'ADD_PENDING', peer: sender, message: msg });
            dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
            return;
        }
        await processTextOrFileMessage(msg, sender, session, dispatch, state);
        dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
    } else if (msg.type === 'FILE') {
        const session = state.activeSessions[sender];
        if (!session) {
            dispatch({ type: 'ADD_PENDING', peer: sender, message: msg });
            dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
            return;
        }

        try {
            const { fileId } = JSON.parse(msg.encryptedMessage);
            const fileRes = await apiRequestWithState(`/files/${fileId}`, {}, state, dispatch);
            if (!fileRes.ok) return;

            const { encryptedContent } = await fileRes.json();
            const verified = await verifySignature(peerKey.verify, encryptedContent, msg.signature);
            if (!verified) {
                console.log('[MSG] FILE signature verification failed');
                return;
            }

            const decrypted = await decryptMessage(session, encryptedContent);
            const attachment = JSON.parse(decrypted);

            let messageObj = {
                peer: sender,
                sender,
                text: '',
                attachment,
                timestamp: msg.timestamp || Date.now(),
                msgId: msg.id
            };
            dispatch({ type: 'ADD_MESSAGE', peer: sender, message: messageObj });
            await db.addMessage(messageObj, state?.atRestKey);
            dispatch({ type: 'ADD_SEEN_SIGNATURE', signature: msg.signature });
        } catch (e) {
            console.error("File processing failed:", e);
        }
    }

    if (msg.id > (state.lastMessageId || 0)) {
        dispatch({ type: 'SET_LAST_MESSAGE_ID', id: msg.id });
        await db.setConfig('lastMessageId', msg.id);
    }
}

// ========================================
// WebSocket Connection
// ========================================
import { WS_URL } from './config.js';

export function connectWebSocket(token, onMessage, onError, onClose) {
    const ws = new WebSocket(`${WS_URL}/ws?token=${token}`);

    ws.onopen = () => {
        console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onMessage(data);
        } catch (e) {
            console.error('[WS] Failed to parse message:', e);
        }
    };

    ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        onError?.(error);
    };

    ws.onclose = (event) => {
        console.log('[WS] Closed:', event.code, event.reason);
        onClose?.(event);
    };

    return ws;
}

export function sendWebSocketCommand(ws, cmd, args = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ cmd, arguments: args }));
    }
}

export function sendWebSocketPing(ws) {
    sendWebSocketCommand(ws, 'ping');
}
