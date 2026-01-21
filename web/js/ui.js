/**
 * SilentChat Web Client - UI Functions
 * DOM manipulation and rendering
 */

import { state } from './config.js';
import { escapeHtml, formatFileSize, getFileIcon } from './utils.js';
import { db, saveState } from './storage.js';

// ========================================
// DOM Elements Cache
// ========================================
export const elements = {};

export function initElements() {
    elements.loginScreen = document.getElementById('loginScreen');
    elements.chatScreen = document.getElementById('chatScreen');
    elements.loginForm = document.getElementById('loginForm');
    elements.aliasInput = document.getElementById('aliasInput');
    elements.loginBtn = document.getElementById('loginBtn');
    elements.loginStatus = document.getElementById('loginStatus');
    elements.sidebar = document.getElementById('sidebar');
    elements.chatList = document.getElementById('chatList');
    elements.newChatInput = document.getElementById('newChatInput');
    elements.currentUserAlias = document.getElementById('currentUserAlias');
    elements.menuBtn = document.getElementById('menuBtn');
    elements.closeSidebarBtn = document.getElementById('closeSidebarBtn');
    elements.chatPeerName = document.getElementById('chatPeerName');
    elements.chatStatus = document.getElementById('chatStatus');
    elements.messagesContainer = document.getElementById('messagesContainer');
    elements.emptyState = document.getElementById('emptyState');
    elements.messageForm = document.getElementById('messageForm');
    elements.messageInput = document.getElementById('messageInput');
    elements.sendBtn = document.getElementById('sendBtn');
    elements.fileInput = document.getElementById('fileInput');
    elements.attachBtn = document.getElementById('attachBtn');
    elements.cameraInput = document.getElementById('cameraInput');
    elements.cameraBtn = document.getElementById('cameraBtn');
    elements.logoutBtn = document.getElementById('logoutBtn');
    elements.connectionIndicator = document.getElementById('connectionIndicator');

    // Webcam modal elements
    elements.webcamModal = document.getElementById('webcamModal');
    elements.webcamVideo = document.getElementById('webcamVideo');
    elements.webcamCanvas = document.getElementById('webcamCanvas');
    elements.captureBtn = document.getElementById('captureBtn');
    elements.switchCameraBtn = document.getElementById('switchCameraBtn');
    elements.closeWebcamBtn = document.getElementById('closeWebcamBtn');
}

// ========================================
// Status & Screen Management
// ========================================
export function updateLoginStatus(msg, isError = false) {
    elements.loginStatus.textContent = msg;
    elements.loginStatus.className = `status-message ${isError ? 'error' : ''}`;
}

export function showScreen(screen) {
    elements.loginScreen.classList.remove('active');
    elements.chatScreen.classList.remove('active');
    screen.classList.add('active');
}

// ========================================
// Sidebar Management
// ========================================
export function createSidebarOverlay() {
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.addEventListener('click', closeSidebar);
        document.getElementById('chatScreen').appendChild(overlay);
    }
    return overlay;
}

export function openSidebar() {
    elements.sidebar.classList.add('open');
    createSidebarOverlay().classList.add('visible');
}

export function closeSidebar() {
    elements.sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('visible');
}

// ========================================
// Chat List Management
// ========================================
export function refreshChatList() {
    const peers = Object.keys(state.messages);
    elements.chatList.innerHTML = '';

    for (const peer of peers) {
        const msgs = state.messages[peer];
        const lastMsg = msgs[msgs.length - 1];

        const item = document.createElement('div');
        item.className = `chat-item ${peer === state.currentPeer ? 'active' : ''}`;
        item.innerHTML = `
            <div class="chat-item-avatar">${peer[0].toUpperCase()}</div>
            <div class="chat-item-info">
                <div class="chat-item-name">${peer}</div>
                <div class="chat-item-preview">${lastMsg?.text || ''}</div>
            </div>
        `;
        item.addEventListener('click', () => selectChat(peer));
        elements.chatList.appendChild(item);
    }
}

export function selectChat(peer) {
    state.currentPeer = peer;

    // Update UI
    elements.chatPeerName.textContent = `@${peer}`;
    elements.chatStatus.textContent = 'End-to-End Encrypted';
    elements.messageInput.disabled = false;
    elements.sendBtn.disabled = false;
    elements.attachBtn.disabled = false;
    elements.cameraBtn.disabled = false;
    elements.emptyState.classList.add('hidden');

    // refreshChatList will update active states
    refreshChatList();
    renderMessages();
    closeSidebar();
}

// ========================================
// Message Rendering
// ========================================
export function renderMessages() {
    if (!state.currentPeer) {
        console.log('[Render] No current peer selected');
        return;
    }

    const msgs = state.messages[state.currentPeer] || [];
    console.log(`[Render] Rendering ${msgs.length} messages for ${state.currentPeer}`);

    // Clear all message elements but keep emptyState
    const messageElements = elements.messagesContainer.querySelectorAll('.message');
    messageElements.forEach(el => el.remove());

    if (msgs.length === 0) {
        elements.emptyState.classList.remove('hidden');
        return;
    }

    elements.emptyState.classList.add('hidden');

    for (const msg of msgs) {
        const isSent = msg.sender === 'Me';
        const div = document.createElement('div');
        div.className = `message ${isSent ? 'sent' : 'received'}`;

        let bubbleContent = '';
        if (msg.attachment) {
            bubbleContent += renderAttachment(msg.attachment);
        }
        if (msg.text) {
            bubbleContent += `<div>${escapeHtml(msg.text)}</div>`;
        }

        div.innerHTML = `
            <div class="message-bubble">${bubbleContent}</div>
            <div class="message-meta">
                <span>${isSent ? 'You' : msg.sender}</span>
            </div>
        `;
        elements.messagesContainer.appendChild(div);
    }

    // Scroll to bottom
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    console.log(`[UI] Rendered ${msgs.length} messages for ${state.currentPeer}`);
}

function renderAttachment(attachment) {
    const { type, name, data, size } = attachment;
    const sizeStr = formatFileSize(size);
    const escapedName = escapeHtml(name);

    if (type.startsWith('image/')) {
        return `<div class="message-attachment">
            <img src="${data}" alt="${escapedName}" loading="lazy">
            <a href="${data}" download="${escapedName}" class="download-link">📥 Download</a>
        </div>`;
    } else if (type.startsWith('video/')) {
        return `<div class="message-attachment">
            <video src="${data}" controls></video>
            <a href="${data}" download="${escapedName}" class="download-link">📥 Download</a>
        </div>`;
    } else if (type.startsWith('audio/')) {
        return `<div class="message-attachment">
            <audio src="${data}" controls></audio>
            <a href="${data}" download="${escapedName}" class="download-link">📥 Download</a>
        </div>`;
    } else {
        // Generic file - make whole thing clickable for download
        const icon = getFileIcon(type);
        return `<div class="message-attachment">
            <a href="${data}" download="${escapedName}" class="file-download">
                <div class="file-info">
                    <span class="file-icon">${icon}</span>
                    <span class="file-name">${escapedName}</span>
                    <span class="file-size">${sizeStr}</span>
                    <span class="download-icon">📥</span>
                </div>
            </a>
        </div>`;
    }
}

// ========================================
// Polling Control
// ========================================
let isPolling = false; // Prevent concurrent polls

export function startPolling(pollMessages) {
    if (state.pollingInterval) clearInterval(state.pollingInterval);

    const poll = async () => {
        // Skip if already polling (prevents overlapping requests for large messages)
        if (isPolling) {
            console.log('[Poll] Skipping - previous poll still in progress');
            return;
        }

        isPolling = true;
        try {
            console.log('[Poll] Checking for new messages...');
            const updatedPeers = await pollMessages();
            console.log('[Poll] Updated peers:', updatedPeers);

            if (updatedPeers.length > 0) {
                console.log('[Poll] Refreshing UI for peers:', updatedPeers);
                // Always refresh the chat list when there are updates
                refreshChatList();

                // If we're viewing one of the updated chats, re-render the messages
                if (state.currentPeer && updatedPeers.includes(state.currentPeer)) {
                    console.log('[Poll] Current peer has updates, rendering messages');
                    renderMessages();
                } else {
                    console.log(`[Poll] Updates for ${updatedPeers} but current peer is ${state.currentPeer} - skipping render`);
                }
            }
        } finally {
            isPolling = false;
        }
    };

    poll(); // Initial poll
    state.pollingInterval = setInterval(poll, 1000);
    console.log('[Poll] Polling started with 1s interval');
}

export function stopPolling() {
    if (state.pollingInterval) {
        clearInterval(state.pollingInterval);
        state.pollingInterval = null;
    }
}

// ========================================
// Logout
// ========================================
export async function logout() {
    console.log('[Logout] Starting logout...');
    stopPolling();

    try {
        // Ensure database is initialized
        await db.init();

        // Clear session data but preserve per-alias keys
        await db.clearSession();
        console.log('[Logout] Session cleared');

        // Clear localStorage/sessionStorage
        localStorage.clear();
        sessionStorage.clear();

        console.log('[Logout] Reloading page...');
        window.location.href = window.location.pathname;
    } catch (e) {
        console.error('[Logout] Error during logout:', e);
        // Force reload anyway
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = window.location.pathname;
    }
}

