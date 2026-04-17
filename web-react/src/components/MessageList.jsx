/**
 * SilentChat - Message List Component
 */

import { useEffect, useRef } from 'react';
import { escapeHtml, formatFileSize, getFileIcon } from '../lib/utils';

function Attachment({ attachment, onImageLoad }) {
    const { type, name, data, size } = attachment;
    const sizeStr = formatFileSize(size);

    if (type.startsWith('image/')) {
        return (
            <div className="message-attachment">
                <img src={data} alt={name} loading="lazy" onLoad={onImageLoad} />
                <a href={data} download={name} className="download-link">📥 Download</a>
            </div>
        );
    }

    if (type.startsWith('video/')) {
        return (
            <div className="message-attachment">
                <video src={data} controls />
                <a href={data} download={name} className="download-link">📥 Download</a>
            </div>
        );
    }

    if (type.startsWith('audio/')) {
        return (
            <div className="message-attachment">
                <audio src={data} controls />
                <a href={data} download={name} className="download-link">📥 Download</a>
            </div>
        );
    }

    // Generic file
    const icon = getFileIcon(type);
    return (
        <div className="message-attachment">
            <a href={data} download={name} className="file-download">
                <div className="file-info">
                    <span className="file-icon">{icon}</span>
                    <span className="file-name">{name}</span>
                    <span className="file-size">{sizeStr}</span>
                    <span className="download-icon">📥</span>
                </div>
            </a>
        </div>
    );
}

export default function MessageList({ messages, currentPeer }) {
    const containerRef = useRef(null);

    const scrollToBottom = () => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    };

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
        // Also scroll after a small delay to handle layout shifts
        const timeout = setTimeout(scrollToBottom, 50);
        return () => clearTimeout(timeout);
    }, [messages]);

    // Handle image load to scroll again if needed
    const handleImageLoad = () => {
        scrollToBottom();
    };

    if (!currentPeer) {
        return (
            <div className="messages-container" id="messagesContainer" ref={containerRef}>
                <div className="empty-state" id="emptyState">
                    <div className="empty-icon">💬</div>
                    <p>Select a chat to start messaging</p>
                </div>
            </div>
        );
    }

    if (messages.length === 0) {
        return (
            <div className="messages-container" id="messagesContainer" ref={containerRef}>
                <div className="empty-state" id="emptyState">
                    <div className="empty-icon">🔐</div>
                    <p>Send your first encrypted message!</p>
                </div>
            </div>
        );
    }

    // Sort messages by timestamp to ensure correct order
    const sortedMessages = [...messages].sort((a, b) => {
        return (a.timestamp || 0) - (b.timestamp || 0);
    });

    const getDayLabel = (timestamp) => {
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);
        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    };

    return (
        <div className="messages-container" id="messagesContainer" ref={containerRef}>
            {sortedMessages.map((msg, index) => {
                const isSent = msg.sender === 'Me';
                const prevMsg = sortedMessages[index - 1];
                const showDayLabel = msg.timestamp && (!prevMsg || !prevMsg.timestamp ||
                    new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString());
                return (
                    <div key={index} className={`message-row ${isSent ? 'sent' : 'received'}`}>
                        {showDayLabel && (
                            <div className="day-label">{getDayLabel(msg.timestamp)}</div>
                        )}
                        <div className={`message ${isSent ? 'sent' : 'received'}`}>
                            <div className="message-bubble">
                                {msg.attachment && (
                                    <Attachment attachment={msg.attachment} onImageLoad={handleImageLoad} />
                                )}
                                {msg.text && (
                                    <div dangerouslySetInnerHTML={{ __html: escapeHtml(msg.text) }} />
                                )}
                                {msg.timestamp && (
                                    <span className="message-time">
                                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
