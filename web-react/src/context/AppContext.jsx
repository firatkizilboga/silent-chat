/**
 * SilentChat - App Context
 * Global state management with React Context + useReducer
 */

import { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import { loadState, saveState as persistState, db, loadKeys, saveKeys } from '../lib/storage.js';
import { registerAndLogin, pollMessages } from '../lib/api.js';

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

        case 'CLEAR_PENDING':
            const { [action.peer]: _, ...rest } = state.pendingMessages;
            return { ...state, pendingMessages: rest };

        default:
            return state;
    }
}

export function AppProvider({ children }) {
    const [state, dispatch] = useReducer(appReducer, initialState);
    const abortControllerRef = useRef(null);
    const pollingIntervalRef = useRef(null);
    const stateRef = useRef(state);
    const isPollingRef = useRef(false);

    // Keep stateRef in sync
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    // Persist state on changes
    useEffect(() => {
        if (state.isLoggedIn && state.alias) {
            persistState(state);
        }
    }, [state.messages, state.seenSignatures, state.lastMessageId, state.activeSessions, state.pendingMessages]);

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

    // Polling effect - handles StrictMode properly
    useEffect(() => {
        // Only poll when logged in with keys
        if (!state.isLoggedIn || !state.keyPair) {
            return;
        }

        let isMounted = true;
        let intervalId = null;
        let currentAbort = null;

        const poll = async () => {
            if (!isMounted) return;

            // Skip if already polling
            if (isPollingRef.current) {
                return;
            }

            isPollingRef.current = true;
            currentAbort = new AbortController();

            try {
                console.log('[Poll] Starting poll...');
                await pollMessages(stateRef.current, dispatch, currentAbort.signal);
            } catch (e) {
                if (e.name !== 'AbortError' && isMounted) {
                    console.error('Poll error:', e);
                }
            } finally {
                isPollingRef.current = false;
            }
        };

        // Start polling
        console.log('[Poll] Starting polling interval');
        poll(); // Initial poll
        intervalId = setInterval(poll, 2000);

        // Cleanup on unmount or dependency change
        return () => {
            isMounted = false;
            if (intervalId) {
                clearInterval(intervalId);
            }
            if (currentAbort) {
                currentAbort.abort();
            }
            isPollingRef.current = false;
            console.log('[Poll] Cleanup');
        };
    }, [state.isLoggedIn, state.keyPair]);

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
