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
    onCreateChat
}) {
    const [newChatInput, setNewChatInput] = useState('');
    const peers = Object.keys(messages);

    const handleNewChat = (e) => {
        if (e.key === 'Enter' && newChatInput.trim()) {
            onCreateChat(newChatInput.trim());
            setNewChatInput('');
        }
    };

    // Sort peers by last message time
    const sortedPeers = [...peers].sort((a, b) => {
        const aLast = messages[a]?.[messages[a].length - 1]?.timestamp || 0;
        const bLast = messages[b]?.[messages[b].length - 1]?.timestamp || 0;
        return bLast - aLast;
    });

    return (
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
            <div className="sidebar-header">
                <h2>Silent Chat</h2>
                <button className="close-sidebar-btn" onClick={() => onSelectPeer(currentPeer)}>
                    ×
                </button>
            </div>

            <div className="new-chat-section">
                <input
                    type="text"
                    id="newChatInput"
                    placeholder="New chat..."
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
                    <div className="empty-chats">No conversations yet</div>
                ) : (
                    sortedPeers.map((peer) => {
                        const msgs = messages[peer] || [];
                        const lastMsg = msgs[msgs.length - 1];
                        const preview = lastMsg?.attachment
                            ? 'Sent an attachment'
                            : lastMsg?.text || 'No messages';

                        return (
                            <div
                                key={peer}
                                className={`chat-item ${peer === currentPeer ? 'active' : ''}`}
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
            </div>
        </aside>
    );
}
