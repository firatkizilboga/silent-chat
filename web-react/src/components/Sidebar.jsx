/**
 * SilentChat - Sidebar Component
 * Clean minimal design
 */

import { useState } from 'react';

export default function Sidebar({
    isOpen,
    currentPeer,
    messages,
    alias,
    onSelectPeer,
    onCreateChat,
    onExportIdentity,
    unreadPeers = new Set(),
    peerLastMessage = {},
}) {
    const [newChatInput, setNewChatInput] = useState('');
    const peers = Object.keys(messages);

    const handleNewChat = (e) => {
        if (e.key === 'Enter' && newChatInput.trim()) {
            onCreateChat(newChatInput.trim());
            setNewChatInput('');
        }
    };

    // Sort peers: unread first, then by last message time (newest first), then by name
    const sortedPeers = [...peers].sort((a, b) => {
        const aUnread = unreadPeers.has(a) ? 0 : 1;
        const bUnread = unreadPeers.has(b) ? 0 : 1;
        if (aUnread !== bUnread) return aUnread - bUnread;
        
        const aLast = peerLastMessage[a]?.timestamp || messages[a]?.[messages[a]?.length - 1]?.timestamp || 0;
        const bLast = peerLastMessage[b]?.timestamp || messages[b]?.[messages[b]?.length - 1]?.timestamp || 0;
        return bLast - aLast;
    });

    return (
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <h1>silentchat</h1>
            </div>

            <div className="new-chat-section">
                <input
                    type="text"
                    id="newChatInput"
                    placeholder="new chat..."
                    value={newChatInput}
                    onChange={(e) => setNewChatInput(e.target.value)}
                    onKeyDown={handleNewChat}
                />
                <button
                    className="new-chat-btn"
                    onClick={() => { if (newChatInput.trim()) { onCreateChat(newChatInput.trim()); setNewChatInput(''); } }}
                    disabled={!newChatInput.trim()}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="23" y1="23" x2="16.65" y2="16.65"/>
                    </svg>
                </button>
            </div>

            <div className="chat-list" id="chatList">
                {sortedPeers.length === 0 ? (
                    <div className="empty-chats">no conversations yet</div>
                ) : (
                    sortedPeers.map((peer) => {
                        const msgs = messages[peer] || [];
                        const lastMsg = msgs[msgs.length - 1] || peerLastMessage[peer];
                        const isUnread = unreadPeers.has(peer);
                        const preview = lastMsg?.attachment
                            ? 'Sent an attachment'
                            : lastMsg?.text || 'No messages';

                        return (
                            <div
                                key={peer}
                                className={`chat-item ${peer === currentPeer ? 'active' : ''} ${isUnread ? 'unread' : ''}`}
                                onClick={() => onSelectPeer(peer)}
                            >
                                <div className="chat-item-info">
                                    <div className="chat-item-name">@{peer}</div>
                                    <div className="chat-item-preview">
                                        {preview.length > 40 ? preview.substring(0, 40) + '...' : preview}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="sidebar-footer">
                <span className="footer-user">@{alias}</span>
                <button
                    className="export-identity-btn"
                    title="download identity backup"
                    onClick={() => {
                        const ok = window.confirm(
                            'This file contains your private keys.\n\n' +
                            'Anyone with this file and your passphrase can impersonate you.\n\n' +
                            'Store it somewhere safe. Continue?'
                        );
                        if (ok) onExportIdentity();
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
            </div>
        </aside>
    );
}
