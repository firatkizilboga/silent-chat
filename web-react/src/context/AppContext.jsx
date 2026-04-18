/**
 * SilentChat - App Context
 * Global state management with React Context + useReducer
 */
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { loadState, saveState as persistState, db, loadKeys, saveKeys, saveSessionKeys } from '../lib/storage.js';
import { registerAndLogin, refreshToken, pollMessages, connectWebSocket, sendWebSocketPing, handleIncomingMessage, processTextOrFileMessage } from '../lib/api.js';
import { generateSalt, deriveAtRestKey, encryptAtRest } from '../lib/crypto.js';
import { arrayBufferToPem, pemToArrayBuffer } from '../lib/utils.js';

const AppContext = createContext(null);

const initialState = {
    // Auth
    alias: null,
    token: null,
    keyPair: null,
    publicKeyPem: null,

    // At-rest encryption
    atRestKey: null,
    needsPassphrase: false,    // returning user: needs to unlock
    needsPassphraseSetup: false, // new user: needs to set passphrase
    savedAlias: null,

    // Session
    peerPublicKeys: {},
    activeSessions: {},
    pendingMessages: {},

    // UI
    currentPeer: null,
    messages: {},
    seenSignatures: new Set(),
    lastMessageId: 0,

    // Status
    isLoggedIn: false,
    isLoading: true,
    isWsConnected: false,
    loginStatus: '',
    loginError: null
};

function appReducer(state, action) {
    switch (action.type) {
        case 'SET_LOADING':
            return { ...state, isLoading: action.loading };

        case 'NEEDS_PASSPHRASE':
            return { ...state, isLoading: false, needsPassphrase: true, savedAlias: action.alias, loginError: null, loginStatus: '' };

        case 'NEEDS_PASSPHRASE_SETUP':
            return { ...state, needsPassphraseSetup: true };

        case 'SET_AT_REST_KEY':
            return { ...state, atRestKey: action.key, needsPassphrase: false, needsPassphraseSetup: false, loginStatus: '', loginError: null };

        case 'RESTORE_STATE':
            return {
                ...state,
                ...action.savedState,
                atRestKey: action.atRestKey,
                isLoggedIn: true,
                isLoading: false,
                needsPassphrase: false,
            };

        case 'SET_TOKEN':
            return { ...state, token: action.token };

        case 'SET_WS_CONNECTED':
            return { ...state, isWsConnected: action.connected };

        case 'LOGIN_SUCCESS':
            return {
                ...state,
                alias: action.alias,
                token: action.token,
                keyPair: action.keyPair,
                publicKeyPem: action.publicKeyPem,
                isLoggedIn: true,
                isLoading: false,
                loginStatus: '',
                loginError: null
            };

        case 'LOGIN_STATUS':
            return { ...state, loginStatus: action.status, loginError: null };

        case 'LOGIN_ERROR':
            return { ...state, loginError: action.error, loginStatus: '', isLoading: false };

        case 'LOGOUT':
            return { ...initialState, isLoading: false };

        case 'SELECT_PEER':
            return { ...state, currentPeer: action.peer };

        case 'INIT_PEER':
            if (state.messages[action.peer]) return state;
            return {
                ...state,
                messages: { ...state.messages, [action.peer]: [] }
            };

        case 'ADD_MESSAGE': {
            const peerMsgs = state.messages[action.peer] || [];
            if (action.message.msgId && peerMsgs.some(m => m.msgId === action.message.msgId)) {
                return state;
            }
            return {
                ...state,
                messages: { ...state.messages, [action.peer]: [...peerMsgs, action.message] }
            };
        }

        case 'SET_PEER_KEY':
            return { ...state, peerPublicKeys: { ...state.peerPublicKeys, [action.peer]: action.key } };

        case 'SET_SESSION':
            return { ...state, activeSessions: { ...state.activeSessions, [action.peer]: action.key } };

        case 'ADD_SEEN_SIGNATURE': {
            const newSigs = new Set(state.seenSignatures);
            newSigs.add(action.signature);
            return { ...state, seenSignatures: newSigs };
        }

        case 'SET_LAST_MESSAGE_ID':
            return { ...state, lastMessageId: action.id };

        case 'ADD_PENDING': {
            const pending = state.pendingMessages[action.peer] || [];
            return { ...state, pendingMessages: { ...state.pendingMessages, [action.peer]: [...pending, action.message] } };
        }

        case 'CLEAR_PENDING': {
            const { [action.peer]: _, ...rest } = state.pendingMessages;
            return { ...state, pendingMessages: rest };
        }

        default:
            return state;
    }
}

export function AppProvider({ children }) {
    const [state, dispatch] = useReducer(appReducer, initialState);
    const stateRef = useRef(state);

    useEffect(() => { stateRef.current = state; }, [state]);

    // Persist state on changes
    useEffect(() => {
        if (state.isLoggedIn && state.alias && state.atRestKey) {
            persistState(state, state.atRestKey);
        }
    }, [state.messages, state.seenSignatures, state.lastMessageId, state.activeSessions, state.pendingMessages, state.isLoggedIn, state.alias, state.atRestKey]);

    // Load saved state on mount
    useEffect(() => {
        async function init() {
            try {
                await db.init();
                const alias = await db.getConfig('alias');
                if (alias) {
                    const salt = await db.getSalt();
                    if (salt) {
                        // Encrypted data — wait for passphrase
                        dispatch({ type: 'NEEDS_PASSPHRASE', alias });
                    } else {
                        // Legacy unencrypted user — load plaintext state, then ask to set passphrase
                        const savedState = await loadState(null);
                        const loadedKeys = savedState ? await loadKeys(alias, null) : null;
                        if (savedState && loadedKeys) {
                            dispatch({
                                type: 'RESTORE_STATE',
                                atRestKey: null,
                                savedState: { ...savedState, keyPair: loadedKeys.keyPair, publicKeyPem: loadedKeys.publicKeyPem }
                            });
                            dispatch({ type: 'NEEDS_PASSPHRASE_SETUP' });
                        } else {
                            dispatch({ type: 'SET_LOADING', loading: false });
                        }
                    }
                    return;
                }
            } catch (e) {
                console.error('Failed to init storage:', e);
            }
            dispatch({ type: 'SET_LOADING', loading: false });
        }
        init();
    }, []);

    // Process pending messages when session is available
    useEffect(() => {
        Object.keys(state.activeSessions).forEach(peer => {
            const pending = state.pendingMessages[peer];
            if (pending && pending.length > 0) {
                const session = state.activeSessions[peer];
                pending.forEach(async (msg) => {
                    await processTextOrFileMessage(msg, peer, session, dispatch, state);
                });
                dispatch({ type: 'CLEAR_PENDING', peer });
            }
        });
    }, [state.activeSessions, state.pendingMessages]);

    // Unlock for returning users
    const unlockWithPassphrase = async (passphrase) => {
        dispatch({ type: 'LOGIN_STATUS', status: 'Unlocking...' });
        try {
            const salt = await db.getSalt();
            if (!salt) throw new Error('No encryption salt found — data may be corrupted.');
            const key = await deriveAtRestKey(passphrase, salt);
            const savedState = await loadState(key);
            if (!savedState) throw new Error('No saved state found.');
            const loadedKeys = await loadKeys(savedState.alias, key);
            if (!loadedKeys) throw new Error('Could not load encryption keys.');
            dispatch({
                type: 'RESTORE_STATE',
                atRestKey: key,
                savedState: { ...savedState, keyPair: loadedKeys.keyPair, publicKeyPem: loadedKeys.publicKeyPem }
            });
        } catch (e) {
            if (e.message === 'WRONG_PASSPHRASE') {
                dispatch({ type: 'LOGIN_ERROR', error: 'Wrong passphrase. Try again.' });
            } else {
                dispatch({ type: 'LOGIN_ERROR', error: e.message });
            }
        }
    };

    // Set passphrase for new users (after server login)
    const setupPassphrase = async (passphrase) => {
        dispatch({ type: 'LOGIN_STATUS', status: 'Encrypting your data...' });
        try {
            const salt = generateSalt();
            await db.setSalt(salt);
            const key = await deriveAtRestKey(passphrase, salt);
            // Migrate any existing plaintext data
            await db.migrateToEncrypted(key);
            // Re-save keys and sessions encrypted
            await saveKeys(stateRef.current.alias, stateRef.current.keyPair, key);
            await saveSessionKeys(stateRef.current.activeSessions, key);
            dispatch({ type: 'SET_AT_REST_KEY', key });
        } catch (e) {
            dispatch({ type: 'LOGIN_ERROR', error: 'Failed to set passphrase: ' + e.message });
        }
    };

    const login = async (alias) => {
        dispatch({ type: 'LOGIN_STATUS', status: 'Connecting...' });
        try {
            // If encrypted keys exist locally for this alias, unlock with passphrase
            // instead of re-registering (which would generate mismatched keys)
            const existingKeys = await db.getConfig(`keys_${alias}`);
            const salt = await db.getSalt();
            if (existingKeys?.encrypted && salt) {
                await db.setConfig('alias', alias);
                dispatch({ type: 'NEEDS_PASSPHRASE', alias });
                return;
            }

            const { keyPair, publicKeyPem, token } = await registerAndLogin(
                alias,
                (status) => dispatch({ type: 'LOGIN_STATUS', status })
            );

            // Save keys unencrypted for now (passphrase setup comes next)
            await saveKeys(alias, keyPair, null);

            dispatch({ type: 'LOGIN_SUCCESS', alias, token, keyPair, publicKeyPem });
            dispatch({ type: 'NEEDS_PASSPHRASE_SETUP' });
        } catch (e) {
            if (e.message === 'KEYS_ENCRYPTED') {
                await db.setConfig('alias', alias);
                dispatch({ type: 'NEEDS_PASSPHRASE', alias });
            } else {
                dispatch({ type: 'LOGIN_ERROR', error: e.message });
            }
        }
    };

    const logout = async () => {
        try {
            await db.init();
            await db.clearSession();
        } catch (e) {
            console.error('Logout error:', e);
        }
        localStorage.clear();
        sessionStorage.clear();
        dispatch({ type: 'LOGOUT' });
    };

    // Connection effect - WebSocket + Polling fallback
    useEffect(() => {
        if (!state.isLoggedIn || !state.keyPair || !state.token || !state.atRestKey) return;

        let isMounted = true;
        let ws = null;
        let pingInterval = null;
        let pollInterval = null;
        let currentAbort = null;
        let reconnectTimeout = null;

        const startPolling = () => {
            if (pollInterval) return;
            console.log('[Conn] Falling back to polling');

            const poll = async () => {
                if (!isMounted) return;
                currentAbort = new AbortController();
                try {
                    await pollMessages(stateRef.current, dispatch, currentAbort.signal);
                } catch (e) {
                    if (e.message === 'AUTH_EXPIRED') {
                        console.log('[Conn] Session expired, refreshing token...');
                        stopPolling();
                        try {
                            const { alias, keyPair } = stateRef.current;
                            const token = await refreshToken(alias, keyPair);
                            dispatch({ type: 'SET_TOKEN', token });
                        } catch (loginErr) {
                            console.error('[Conn] Token refresh failed:', loginErr);
                            await logout();
                            dispatch({ type: 'LOGIN_ERROR', error: 'Session expired. Please sign in again.' });
                        }
                    } else if (e.name !== 'AbortError' && isMounted) {
                        console.error('Poll error:', e);
                    }
                }
            };

            poll();
            pollInterval = setInterval(poll, 3000);
        };

        const stopPolling = () => {
            if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
            if (currentAbort) { currentAbort.abort(); currentAbort = null; }
        };

        const startPing = () => {
            stopPing();
            pingInterval = setInterval(() => sendWebSocketPing(ws), 30000);
        };

        const stopPing = () => {
            if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        };

        const connect = () => {
            if (!isMounted) return;
            ws = connectWebSocket(
                state.token,
                (msg) => handleIncomingMessage(msg, stateRef.current, dispatch),
                () => {},
                () => {
                    if (!isMounted) return;
                    dispatch({ type: 'SET_WS_CONNECTED', connected: false });
                    stopPing();
                    startPolling();
                    reconnectTimeout = setTimeout(connect, 5000);
                }
            );

            const originalOpen = ws.onopen;
            ws.onopen = () => {
                if (originalOpen) originalOpen();
                if (!isMounted) return;
                dispatch({ type: 'SET_WS_CONNECTED', connected: true });
                stopPolling();
                const syncAbort = new AbortController();
                pollMessages(stateRef.current, dispatch, syncAbort.signal)
                    .catch(e => console.error('[Sync] Failed:', e));
                startPing();
            };
        };

        connect();

        return () => {
            isMounted = false;
            if (ws) { ws.onclose = null; ws.close(); }
            stopPing();
            stopPolling();
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        };
    }, [state.isLoggedIn, state.keyPair, state.token, state.atRestKey]);

    const exportIdentity = async () => {
        const { alias, keyPair } = stateRef.current;
        if (!alias || !keyPair) return;
        const privatePem = arrayBufferToPem(keyPair.privateKeyPkcs8, 'PRIVATE KEY');
        const publicPem = arrayBufferToPem(keyPair.publicKeySpki, 'PUBLIC KEY');
        const pem = `# SilentChat identity: ${alias}\n${privatePem}\n${publicPem}`;
        const blob = new Blob([pem], { type: 'application/x-pem-file' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${alias}.pem`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const importIdentity = async (fileContent) => {
        dispatch({ type: 'LOGIN_STATUS', status: 'Importing identity...' });
        try {
            const aliasMatch = fileContent.match(/^# SilentChat identity: (.+)$/m);
            if (!aliasMatch) throw new Error('Invalid identity file — missing alias comment.');
            const alias = aliasMatch[1].trim();

            const privatePemMatch = fileContent.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/);
            const publicPemMatch = fileContent.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/);
            if (!privatePemMatch || !publicPemMatch) throw new Error('Invalid identity file — missing key blocks.');

            const privateKeyPkcs8 = pemToArrayBuffer(privatePemMatch[0]);
            const publicKeySpki = pemToArrayBuffer(publicPemMatch[0]);

            await db.setConfig('alias', alias);
            await saveKeys(alias, { privateKeyPkcs8, publicKeySpki }, null);

            // login() will find the restored keys and authenticate
            await login(alias);
        } catch (e) {
            dispatch({ type: 'LOGIN_ERROR', error: e.message });
        }
    };

    const value = { state, dispatch, login, logout, unlockWithPassphrase, setupPassphrase, exportIdentity, importIdentity };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (!context) throw new Error('useApp must be used within AppProvider');
    return context;
}
