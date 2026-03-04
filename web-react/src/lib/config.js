/**
 * SilentChat - Configuration
 */
export const SERVER_URL = "https://silentchat-api.firatkizilboga.com";
// export const SERVER_URL = "http://localhost:8000"; // Uncomment for local dev

// Works for both http:// -> ws:// and https:// -> wss://
export const WS_URL = SERVER_URL.replace(/^http/, 'ws');

