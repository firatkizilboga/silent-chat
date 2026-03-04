/**
 * tui - Silent Chat TUI Client
 * A terminal-based E2EE chat client using FTXUI
 */

#include "UI.hpp"
#include "config.hpp"
#include "logger.hpp"

#include <iostream>

int main() {
    // Debug to stderr first
    std::cerr << "[DEBUG] tui starting..." << std::endl;
    
    // Initialize logger
    std::string logPath = silentchat::getConfigDir().string() + "/tui.log";
    std::cerr << "[DEBUG] Log path: " << logPath << std::endl;
    
    try {
        silentchat::Logger::instance().init(logPath);
        std::cerr << "[DEBUG] Logger initialized" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Logger init failed: " << e.what() << std::endl;
    }
    
    LOG_INFO("Main", "tui starting...");
    LOG_INFO("Main", "Log file: " + logPath);
    LOG_INFO("Main", "Server: " + std::string(silentchat::SERVER_URL));
    
    std::cerr << "[DEBUG] Starting app..." << std::endl;
    
    silentchat::UI ui;
    ui.run();
    
    LOG_INFO("Main", "tui shutting down");
    return 0;
}
