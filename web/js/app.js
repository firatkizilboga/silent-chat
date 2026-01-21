/**
 * SilentChat Web Client - Main Entry Point
 * Application initialization
 */

import { state } from './config.js';
import { requestNotificationPermission } from './utils.js';
import { loadState, loadKeys } from './storage.js';
import { pollMessages } from './api.js';
import {
    elements,
    initElements,
    showScreen,
    createSidebarOverlay,
    refreshChatList,
    selectChat,
    startPolling
} from './ui.js';
import { setupEventListeners } from './events.js';

// ========================================
// Initialization
// ========================================
async function init() {
    initElements();
    createSidebarOverlay();
    setupEventListeners();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('./sw.js');
            console.log('[SW] Service Worker registered');
        } catch (e) {
            console.error('[SW] Registration failed:', e);
        }
    }

    // Try to restore session
    if (await loadState() && state.token && await loadKeys()) {
        elements.currentUserAlias.textContent = state.alias;
        showScreen(elements.chatScreen);
        refreshChatList();

        // Restore active chat if one was open
        if (state.currentPeer && state.messages[state.currentPeer]) {
            selectChat(state.currentPeer);
        }

        startPolling(pollMessages);

        requestNotificationPermission();

        return true;
    }
}

// Start app
document.addEventListener('DOMContentLoaded', init);
