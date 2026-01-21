/**
 * SilentChat Web Client - Event Handlers
 * Setup all event listeners for the application
 */

import { state } from './config.js';
import { requestNotificationPermission, fileToBase64 } from './utils.js';
import { saveState } from './storage.js';
import { registerAndLogin, sendMessage, pollMessages } from './api.js';
import {
    elements,
    updateLoginStatus,
    showScreen,
    openSidebar,
    closeSidebar,
    refreshChatList,
    selectChat,
    renderMessages,
    startPolling,
    logout
} from './ui.js';

// ========================================
// Event Listeners Setup
// ========================================
export function setupEventListeners() {
    // Login handling
    async function handleLogin() {
        requestNotificationPermission();
        const alias = elements.aliasInput.value.trim();
        if (!alias) return;

        elements.loginBtn.disabled = true;
        elements.loginBtn.querySelector('.btn-text').classList.add('hidden');
        elements.loginBtn.querySelector('.btn-loader').classList.remove('hidden');

        try {
            await registerAndLogin(alias);
            elements.currentUserAlias.textContent = alias;
            showScreen(elements.chatScreen);
            refreshChatList();
            startPolling(pollMessages);
        } catch (e) {
            updateLoginStatus(e.message, true);
        } finally {
            elements.loginBtn.disabled = false;
            elements.loginBtn.querySelector('.btn-text').classList.remove('hidden');
            elements.loginBtn.querySelector('.btn-loader').classList.add('hidden');
        }
    }

    elements.loginBtn.addEventListener('click', handleLogin);

    elements.aliasInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleLogin();
        }
    });

    // Prevent form submission if it happens somehow
    elements.loginForm.addEventListener('submit', (e) => e.preventDefault());

    // New chat input
    elements.newChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const peer = elements.newChatInput.value.trim();
            if (peer && peer !== state.alias) {
                if (!state.messages[peer]) {
                    state.messages[peer] = [];
                    saveState();
                }
                selectChat(peer);
                refreshChatList();
                elements.newChatInput.value = '';
            }
        }
    });

    // Message form
    elements.messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = elements.messageInput.value.trim();
        if (!text || !state.currentPeer) return;

        elements.sendBtn.disabled = true;

        try {
            await sendMessage(state.currentPeer, text);
            elements.messageInput.value = '';
            renderMessages();
            refreshChatList();
        } catch (e) {
            console.error("Send failed:", e);
            alert("Failed to send message: " + e.message);
        } finally {
            elements.sendBtn.disabled = false;
        }
    });

    // Attach button - trigger file input
    elements.attachBtn.addEventListener('click', () => {
        if (!state.currentPeer) return;
        elements.fileInput.click();
    });

    // Camera button - trigger camera input (opens camera on mobile)
    elements.cameraBtn.addEventListener('click', () => {
        if (!state.currentPeer) return;
        elements.cameraInput.click();
    });

    // Camera input handler - reuse same logic as file input
    elements.cameraInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !state.currentPeer) return;

        elements.attachBtn.disabled = true;
        elements.cameraBtn.disabled = true;
        elements.sendBtn.disabled = true;

        try {
            console.log('[Camera] Processing photo:', file.name, file.type);
            const base64Data = await fileToBase64(file);

            const attachment = {
                type: file.type || 'image/jpeg',
                name: file.name || `photo_${Date.now()}.jpg`,
                size: file.size,
                data: base64Data
            };

            const messagePayload = JSON.stringify({ attachment });
            await sendMessage(state.currentPeer, messagePayload);

            renderMessages();
            refreshChatList();
            console.log('[Camera] Photo sent successfully');
        } catch (e) {
            console.error("Camera capture failed:", e);
            alert("Failed to send photo: " + e.message);
        } finally {
            elements.attachBtn.disabled = false;
            elements.cameraBtn.disabled = false;
            elements.sendBtn.disabled = false;
            elements.cameraInput.value = '';
        }
    });

    // File input change handler
    elements.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !state.currentPeer) return;

        elements.attachBtn.disabled = true;
        elements.sendBtn.disabled = true;

        try {
            console.log('[Attach] Converting file to base64:', file.name, file.type);
            const base64Data = await fileToBase64(file);

            // Create attachment object and send as JSON
            const attachment = {
                type: file.type,
                name: file.name,
                size: file.size,
                data: base64Data
            };

            // Send as JSON message with attachment - sendMessage will handle storage
            const messagePayload = JSON.stringify({ attachment });
            await sendMessage(state.currentPeer, messagePayload);

            renderMessages();
            refreshChatList();
            console.log('[Attach] File sent successfully');
        } catch (e) {
            console.error("Attachment failed:", e);
            alert("Failed to send attachment: " + e.message);
        } finally {
            elements.attachBtn.disabled = false;
            elements.sendBtn.disabled = false;
            elements.fileInput.value = '';
        }
    });

    // Mobile sidebar toggle
    elements.menuBtn.addEventListener('click', openSidebar);
    elements.closeSidebarBtn.addEventListener('click', closeSidebar);

    // Logout
    elements.logoutBtn.addEventListener('click', () => logout());
}
