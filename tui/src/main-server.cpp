#include <silentchat/server.hpp>

#include <iostream>
#include <cstdlib>
#include <cstring>

int main(int argc, char* argv[])
{
    uint16_t port = 2222;

    for (int i = 1; i < argc - 1; ++i) {
        if (std::strcmp(argv[i], "--port") == 0) {
            port = static_cast<uint16_t>(std::atoi(argv[i + 1]));
            break;
        }
    }

    auto serverDir = silentchat::getServerStateDir();
    std::string logPath = (serverDir / "server.log").string();
    try {
        silentchat::Logger::instance().init(logPath);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Logger init failed: " << e.what() << "\n";
    }

    std::string keyPath = (serverDir / "ssh_host_key").string();
    if (!silentchat::ensureHostKey(keyPath)) {
        std::cerr << "[ERROR] Failed to generate/load SSH host key at " << keyPath << "\n";
        return 1;
    }

    std::cout << "schatui SSH server starting on port " << port << "\n";
    std::cout << "  host key   : " << keyPath << "\n";
    std::cout << "  connect via: ssh -p " << port
              << " -o StrictHostKeyChecking=no any@localhost\n";

    try {
        silentchat::runSSHServer(port, keyPath, []() {
            silentchat::Logger::instance().init(
                (silentchat::getConfigDir() / "tui.log").string());
            silentchat::UI ui;
            ui.run();
        });
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] " << e.what() << "\n";
        return 1;
    }

    return 0;
}
