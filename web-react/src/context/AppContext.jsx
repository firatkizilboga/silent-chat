/**
 * SilentChat - App Context
 * Global state management with React Context + useReducer
 */
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { loadState, saveState as persistState, db, loadKeys, saveKeys } from '../lib/storage.js';
import { registerAndLogin, pollMessages, connectWebSocket, sendWebSocketPing, handleIncomingMessage, processTextOrFileMessage } from '../lib/api.js';

const AppContext = createContext(null);

const initialState = {
    // Auth
    alias: null,
    token: null,
    keyPair: null,
    publicKeyPem: null,

    // Session
    peerPublicKeys: {},
    activeSessions: {},
    pendingMessages: {},

    // UI
    currentPeer: null,
    messages: {},
    seenSignatures: new Set(),
    lastMessageId: 0,  // ID-based polling watermark

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

        case 'RESTORE_STATE':
            return {
                ...state,
                ...action.savedState,
                isLoggedIn: true,
                isLoading: false
            };

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
            return { ...state, loginStatus: action.status };

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

            // Deduplicate by msgId to prevent double saves from StrictMode
            if (action.message.msgId && peerMsgs.some(m => m.msgId === action.message.msgId)) {
                console.log('[State] Skipping duplicate msgId:', action.message.msgId);
                return state;
            }

            return {
                ...state,
                messages: {
                    ...state.messages,
                    [action.peer]: [...peerMsgs, action.message]
                }
            };
        }

        case 'SET_PEER_KEY':
            return {
                ...state,
                peerPublicKeys: { ...state.peerPublicKeys, [action.peer]: action.key }
            };

        case 'SET_SESSION':
            return {
                ...state,
                activeSessions: { ...state.activeSessions, [action.peer]: action.key }
            };

        case 'ADD_SEEN_SIGNATURE': {
            const newSigs = new Set(state.seenSignatures);
            newSigs.add(action.signature);
            return { ...state, seenSignatures: newSigs };
        }

        case 'SET_LAST_MESSAGE_ID':
            return { ...state, lastMessageId: action.id };

        case 'ADD_PENDING': {
            const pending = state.pendingMessages[action.peer] || [];
            return {
                ...state,
                pendingMessages: {
                    ...state.pendingMessages,
                    [action.peer]: [...pending, action.message]
                }
            };
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

    // Keep stateRef in sync
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // Persist state on changes
    useEffect(() => {
        if (state.isLoggedIn && state.alias) {
            persistState(state);
        }
    }, [state.messages, state.seenSignatures, state.lastMessageId, state.activeSessions, state.pendingMessages, state.isLoggedIn, state.alias]);

    // Load saved state on mount
    useEffect(() => {
        async function init() {
            try {
                const savedState = await loadState();
                if (savedState && savedState.token) {
                    const loadedKeys = await loadKeys(savedState.alias);
                    if (loadedKeys) {
                        dispatch({
                            type: 'RESTORE_STATE',
                            savedState: {
                                ...savedState,
                                keyPair: loadedKeys.keyPair,
                                publicKeyPem: loadedKeys.publicKeyPem
                            }
                        });
                        return;
                    }
                }
            } catch (e) {
                console.error('Failed to restore state:', e);
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
                console.log(`[Pending] Processing ${pending.length} messages for ${peer}`);
                const session = state.activeSessions[peer];

                // Process each message
                pending.forEach(async (msg) => {
                    await processTextOrFileMessage(msg, peer, session, dispatch, state);
                });

                dispatch({ type: 'CLEAR_PENDING', peer });
            }
        });
    }, [state.activeSessions, state.pendingMessages]);

    const login = async (alias) => {
        dispatch({ type: 'LOGIN_STATUS', status: 'Connecting...' });
        try {
            const { keyPair, publicKeyPem, token } = await registerAndLogin(
                alias,
                (status) => dispatch({ type: 'LOGIN_STATUS', status })
            );

            await saveKeys(alias, keyPair);

            dispatch({
                type: 'LOGIN_SUCCESS',
                alias,
                token,
                keyPair,
                publicKeyPem
            });
        } catch (e) {
            dispatch({ type: 'LOGIN_ERROR', error: e.message });
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
        if (!state.isLoggedIn || !state.keyPair || !state.token) {
            return;
        }

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
                    if (e.message === "AUTH_EXPIRED") {
                        console.log('[Conn] Session expired, re-authenticating...');
                        await login(stateRef.current.alias);
                    } else if (e.name !== 'AbortError' && isMounted) {
                        console.error('Poll error:', e);
                    }
                }
            };

            poll(); // Initial
            pollInterval = setInterval(poll, 3000); // Slower poll for fallback
        };

        const stopPolling = () => {
            if (pollInterval) {
                console.log('[Conn] Stopping polling (WS connected)');
                clearInterval(pollInterval);
                pollInterval = null;
            }
            if (currentAbort) {
                currentAbort.abort();
                currentAbort = null;
            }
        };

        const connect = () => {
            if (!isMounted) return;

            console.log('[Conn] Connecting WebSocket...');
            ws = connectWebSocket(
                state.token,
                (msg) => { // onMessage
                    handleIncomingMessage(msg, stateRef.current, dispatch);
                },
                () => { // onError
                    // Error will trigger close
                },
                () => { // onClose
                    if (!isMounted) return;
                    console.log('[WS] Disconnected');
                    dispatch({ type: 'SET_WS_CONNECTED', connected: false });
                    stopPing();

                    // Fallback to polling immediately
                    startPolling();

                    // Try to reconnect after delay
                    reconnectTimeout = setTimeout(connect, 5000);
                }
            );

            const originalOpen = ws.onopen;
            ws.onopen = () => {
                if (originalOpen) originalOpen();
                if (!isMounted) return;
                console.log('[WS] Connection established');
                dispatch({ type: 'SET_WS_CONNECTED', connected: true });
                stopPolling();

                // Sync missed messages (offline catch-up)
                // Use a temporary controller for this one-off request
                const syncAbort = new AbortController();
                pollMessages(stateRef.current, dispatch, syncAbort.signal)
                    .catch(e => console.error('[Sync] Failed:', e));

                startPing();
            };
        };

        const startPing = () => {
            stopPing();
            pingInterval = setInterval(() => {
                sendWebSocketPing(ws);
            }, 30000);
        };

        const stopPing = () => {
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
        };

        // Initial connect
        connect();

        return () => {
            isMounted = false;
            if (ws) {
                ws.onclose = null; // Prevent reconnect loop
                ws.close();
            }
            stopPing();
            stopPolling();
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        };
    }, [state.isLoggedIn, state.keyPair, state.token]);

    const value = {
        state,
        dispatch,
        login,
        logout
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within AppProvider');
    }
    return context;
}
