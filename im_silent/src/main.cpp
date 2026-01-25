/**
 * im_silent - Silent Chat TUI Client
 * A terminal-based E2EE chat client using FTXUI
 */

#include "UI.hpp"
#include "config.hpp"
#include "logger.hpp"

#include <iostream>

int main() {
    // Debug to stderr first
    std::cerr << "[DEBUG] im_silent starting..." << std::endl;
    
    // Initialize logger
    std::string logPath = silentchat::getConfigDir().string() + "/im_silent.log";
    std::cerr << "[DEBUG] Log path: " << logPath << std::endl;
    
    try {
        silentchat::Logger::instance().init(logPath);
        std::cerr << "[DEBUG] Logger initialized" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Logger init failed: " << e.what() << std::endl;
    }
    
    LOG_INFO("Main", "im_silent starting...");
    LOG_INFO("Main", "Log file: " + logPath);
    LOG_INFO("Main", "Server: " + std::string(silentchat::SERVER_URL));
    
    std::cerr << "[DEBUG] Starting app..." << std::endl;
    
    silentchat::UI ui;
    ui.run();
    
    LOG_INFO("Main", "im_silent shutting down");
    return 0;
}
