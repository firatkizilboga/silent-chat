/**
 * SilentChat - Chat Screen Component
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import Sidebar from './Sidebar';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import { fetchPeerKey } from '../lib/api.js';

export default function ChatScreen() {
    const { state, dispatch, logout, exportIdentity, loadOlderMessages } = useApp();
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const peerStatus = state.currentPeer ? state.onlineStatus[state.currentPeer] : null;

    const selectPeer = (peer) => {
        dispatch({ type: 'SELECT_PEER', peer });
        setSidebarOpen(false);
    };

    const createChat = async (peer) => {
        if (!peer || peer === state.alias) return;

        // If user already exists in our list, just select it
        if (state.messages[peer]) {
            dispatch({ type: 'SELECT_PEER', peer });
            setSidebarOpen(false);
            return;
        }

        try {
            // Verify if user exists by trying to get their public key
            const key = await fetchPeerKey(peer, state, dispatch);
            if (!key) {
                alert(`User @${peer} not found on the server.`);
                return;
            }

            dispatch({ type: 'SET_PEER_KEY', peer, key });
            dispatch({ type: 'INIT_PEER', peer });
            dispatch({ type: 'SELECT_PEER', peer });
            setSidebarOpen(false);
        } catch (e) {
            console.error('[Chat] Failed to start chat:', e);
            if (e?.code === 'KEY_PIN_MISMATCH') {
                alert(e.message);
            } else {
                alert('Failed to start chat. Please check your connection.');
            }
        }
    };

    return (
        <div className="chat-screen">

            <Sidebar
                isOpen={sidebarOpen}
                currentPeer={state.currentPeer}
                messages={state.messages}
                alias={state.alias}
                onSelectPeer={selectPeer}
                onCreateChat={createChat}
                onLogout={logout}
                onExportIdentity={exportIdentity}
                unreadPeers={state.unreadPeers}
                peerLastMessage={state.peerLastMessage}
                isDecrypting={!!state.loadingMessagesPeer}
            />

            <main className="chat-main">
                <header className="chat-header">
                    <button
                        className="menu-btn"
                        onClick={() => setSidebarOpen(true)}
                    >
                        ☰
                    </button>
                    <div className="chat-header-info">
                        <h2 id="chatPeerName" className={peerStatus?.toLowerCase() || 'unknown'}>
                            {state.currentPeer ? `@${state.currentPeer}` : 'Select a chat'}
                        </h2>
                    </div>
                </header>

                <MessageList
                    messages={state.currentPeer ? state.messages[state.currentPeer] || [] : []}
                    currentPeer={state.currentPeer}
                    isLoading={state.loadingMessagesPeer === state.currentPeer}
                    hasMore={!!state.currentPeer && !!state.peerHistoryMeta[state.currentPeer]?.hasMore}
                    onLoadOlder={() => state.currentPeer && loadOlderMessages(state.currentPeer)}
                />

                <div className="input-area">
                    <MessageInput
                        currentPeer={state.currentPeer}
                        disabled={!state.currentPeer}
                    />
                </div>
            </main>
        </div>
    );
}
