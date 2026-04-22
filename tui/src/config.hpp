#pragma once

#include <string>
#include <filesystem>

namespace silentchat {

// Server configuration
constexpr const char* SERVER_URL = "https://silentchat-api.firatkizilboga.com";

// Application info
constexpr const char* APP_NAME = "SilentChat";
constexpr const char* APP_VERSION = "2.1";

// $XDG_STATE_HOME/schatui  (fallback: ~/.local/state/schatui)
inline std::filesystem::path getConfigDir() {
    const char* xdg = std::getenv("XDG_STATE_HOME");
    if (xdg != nullptr && xdg[0] != '\0')
        return std::filesystem::path(xdg) / "schatui";
    const char* home = std::getenv("HOME");
    if (!home) home = "/tmp";
    return std::filesystem::path(home) / ".local" / "state" / "schatui";
}

// $XDG_STATE_HOME/schatui-ssh-server  (for host key and server logs)
inline std::filesystem::path getServerStateDir() {
    const char* xdg = std::getenv("XDG_STATE_HOME");
    if (xdg != nullptr && xdg[0] != '\0')
        return std::filesystem::path(xdg) / "schatui-ssh-server";
    const char* home = std::getenv("HOME");
    if (!home) home = "/tmp";
    return std::filesystem::path(home) / ".local" / "state" / "schatui-ssh-server";
}

// Get user directory path
inline std::filesystem::path getUserDir(const std::string& alias) {
    return getConfigDir() / alias;
}

} // namespace silentchat
