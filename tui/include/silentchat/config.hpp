#pragma once

#include <string>
#include <filesystem>

namespace silentchat {

constexpr const char* SERVER_URL = "https://silentchat-api.firatkizilboga.com";

constexpr const char* APP_NAME = "SilentChat";
constexpr const char* APP_VERSION = "2.1";

inline std::filesystem::path getConfigDir() {
    const char* xdg = std::getenv("XDG_STATE_HOME");
    if (xdg != nullptr && xdg[0] != '\0')
        return std::filesystem::path(xdg) / "schatui";
    const char* home = std::getenv("HOME");
    if (!home) home = "/tmp";
    return std::filesystem::path(home) / ".local" / "state" / "schatui";
}

inline std::filesystem::path getServerStateDir() {
    const char* xdg = std::getenv("XDG_STATE_HOME");
    if (xdg != nullptr && xdg[0] != '\0')
        return std::filesystem::path(xdg) / "schatui-ssh-server";
    const char* home = std::getenv("HOME");
    if (!home) home = "/tmp";
    return std::filesystem::path(home) / ".local" / "state" / "schatui-ssh-server";
}

inline std::filesystem::path getUserDir(const std::string& alias) {
    return getConfigDir() / alias;
}

} // namespace silentchat
