#pragma once

#include <string>
#include <filesystem>

namespace silentchat {

// Server configuration
constexpr const char* SERVER_URL = "https://silentchat-api.firatkizilboga.com";

// Application info
constexpr const char* APP_NAME = "SilentChat";
constexpr const char* APP_VERSION = "2.1";

// Get config directory path
inline std::filesystem::path getConfigDir() {
    const char* home = std::getenv("HOME");
    if (!home) home = "/tmp";
    return std::filesystem::path(home) / ".config" / "chatters";
}

// Get user directory path
inline std::filesystem::path getUserDir(const std::string& alias) {
    return getConfigDir() / alias;
}

} // namespace silentchat
