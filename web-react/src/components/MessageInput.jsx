/**
 * SilentChat - Message Input Component
 * Clean minimal buttons
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { sendMessage, sendFile } from '../lib/api';

export default function MessageInput({ currentPeer, disabled }) {
    const { state, dispatch } = useApp();
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const cameraInputRef = useRef(null);

    // Auto-focus input when peer changes or becomes enabled
    useEffect(() => {
        if (!disabled && currentPeer) {
            inputRef.current?.focus();
        }
    }, [disabled, currentPeer]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const messageText = text.trim();
        if (!messageText || !currentPeer || sending) return;

        // Clear input immediately and keep focus
        setText('');
        setSending(true);
        
        try {
            await sendMessage(currentPeer, messageText, state, dispatch);
        } catch (e) {
            console.error("Send failed:", e);
            alert("Failed to send message: " + e.message);
            // Restore text on failure
            setText(messageText);
        } finally {
            setSending(false);
            // Ensure focus is restored
            inputRef.current?.focus();
        }
    };

    const handleFileSelect = async (file) => {
        if (!file || !currentPeer) return;

        setSending(true);
        try {
            console.log('[Attach] Sending file:', file.name, file.type);
            await sendFile(currentPeer, file, state, dispatch);
            console.log('[Attach] File sent successfully');
        } catch (e) {
            console.error("Attachment failed:", e);
            alert("Failed to send attachment: " + e.message);
        } finally {
            setSending(false);
            inputRef.current?.focus();
        }
    };

    return (
        <form className="message-form" id="messageForm" onSubmit={handleSubmit}>
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={(e) => {
                    handleFileSelect(e.target.files[0]);
                    e.target.value = '';
                }}
            />
            <input
                type="file"
                accept="image/*"
                capture="environment"
                ref={cameraInputRef}
                style={{ display: 'none' }}
                onChange={(e) => {
                    handleFileSelect(e.target.files[0]);
                    e.target.value = '';
                }}
            />

            <button
                type="button"
                className="icon-btn attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || sending}
                title="attach file"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
            </button>

            <button
                type="button"
                className="icon-btn camera-btn"
                onClick={() => cameraInputRef.current?.click()}
                disabled={disabled || sending}
                title="take photo"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                </svg>
            </button>

            <input
                type="text"
                id="messageInput"
                ref={inputRef}
                placeholder={disabled ? "select a chat" : "message..."}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={disabled}
                autoComplete="off"
            />

            <button
                type="submit"
                className="icon-btn send-btn"
                disabled={disabled || sending || !text.trim()}
                title="send"
            >
                {sending ? (
                    <div className="spinner-small" />
                ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                )}
            </button>
        </form>
    );
}
