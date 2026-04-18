/**
 * SilentChat - Chat Screen Component
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import Sidebar from './Sidebar';
import MessageList from './MessageList';
import MessageInput from './MessageInput';

export default function ChatScreen() {
    const { state, dispatch, logout, exportIdentity } = useApp();
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const selectPeer = (peer) => {
        dispatch({ type: 'SELECT_PEER', peer });
        setSidebarOpen(false);
    };

    const createChat = (peer) => {
        if (peer && peer !== state.alias) {
            dispatch({ type: 'INIT_PEER', peer });
            dispatch({ type: 'SELECT_PEER', peer });
            setSidebarOpen(false);
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
                        <h2 id="chatPeerName">
                            {state.currentPeer ? `@${state.currentPeer}` : 'Select a chat'}
                        </h2>
                        <span id="chatStatus">
                            {state.currentPeer ? 'End-to-End Encrypted' : ''}
                        </span>
                    </div>
                    <div className="connection-indicator" id="connectionIndicator" title="Connected">
                        <span className="indicator-dot"></span>
                    </div>
                </header>

                <MessageList
                    messages={state.currentPeer ? state.messages[state.currentPeer] || [] : []}
                    currentPeer={state.currentPeer}
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
