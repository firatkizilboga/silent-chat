/**
 * im_silent - Silent Chat TUI Client
 * A terminal-based E2EE chat client using ImTui
 */

#include "imtui/imtui.h"
#include "imtui/imtui-impl-ncurses.h"

#include "config.hpp"
#include "backend.hpp"
#include "logger.hpp"

#include <string>
#include <vector>
#include <mutex>
#include <algorithm>
#include <iostream>

namespace silentchat {

// Application state
enum class Screen {
    Login,
    Chat
};

class App {
public:
    App() = default;

    void run() {
        IMGUI_CHECKVERSION();
        ImGui::CreateContext();

        auto screen = ImTui_ImplNcurses_Init(true);
        ImTui_ImplText_Init();

        while (running_) {
            ImTui_ImplNcurses_NewFrame();
            ImTui_ImplText_NewFrame();
            ImGui::NewFrame();

            switch (currentScreen_) {
                case Screen::Login:
                    renderLoginScreen();
                    break;
                case Screen::Chat:
                    renderChatScreen();
                    break;
            }

            ImGui::Render();
            ImTui_ImplText_RenderDrawData(ImGui::GetDrawData(), screen);
            ImTui_ImplNcurses_DrawScreen();
        }

        backend_.stopPolling();
        ImTui_ImplText_Shutdown();
        ImTui_ImplNcurses_Shutdown();
    }

private:
    void renderLoginScreen() {
        ImVec2 displaySize = ImGui::GetIO().DisplaySize;
        float windowWidth = 60.0f;
        float windowHeight = 25.0f;
        
        ImGui::SetNextWindowPos(ImVec2(
            (displaySize.x - windowWidth) / 2,
            (displaySize.y - windowHeight) / 2
        ), ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(windowWidth, windowHeight), ImGuiCond_Always);

        ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar | 
                                  ImGuiWindowFlags_NoResize | 
                                  ImGuiWindowFlags_NoMove |
                                  ImGuiWindowFlags_NoCollapse;

        ImGui::Begin("##Login", nullptr, flags);

        // Title - Bright cyan
        ImGui::TextColored(ImVec4(0.3f, 0.9f, 0.9f, 1.0f), "  === %s v%s ===", APP_NAME, APP_VERSION);
        ImGui::Separator();
        ImGui::Text("");

    // List of known users
        // ImGui::BeginChild("UserList", ImVec2(windowWidth - 4, windowHeight - 8), true); // Removed redundant/early begin
        
        if (backend_.getAppDB()) {
            auto users = backend_.getAppDB()->getUsers();
            int totalItems = users.size() + 1; // +1 for "Add User"

            // Auto-select last used user if not set
            if (activeUserIndex_ == -1 && !users.empty()) {
                activeUserIndex_ = 0;
            } else if (users.empty()) {
                activeUserIndex_ = 0; // Point to "Add User"
            }
            if (activeUserIndex_ >= totalItems) activeUserIndex_ = totalItems - 1;

            // Handle keyboard navigation
            if (!showAddUser_ && !showDeleteConfirm_) {
                if (ImGui::IsKeyPressed(ImGui::GetKeyIndex(ImGuiKey_UpArrow)) || ImGui::IsKeyPressed('k') || ImGui::IsKeyPressed('K')) {
                    activeUserIndex_--;
                    if (activeUserIndex_ < 0) activeUserIndex_ = totalItems - 1;
                }
                else if (ImGui::IsKeyPressed(ImGui::GetKeyIndex(ImGuiKey_DownArrow)) || ImGui::IsKeyPressed('j') || ImGui::IsKeyPressed('J')) {
                    activeUserIndex_++;
                    if (activeUserIndex_ >= totalItems) activeUserIndex_ = 0;
                }
                else if (ImGui::IsKeyPressed(ImGui::GetKeyIndex(ImGuiKey_Enter))) {
                    if (activeUserIndex_ < (int)users.size()) {
                        performLogin(users[activeUserIndex_].alias);
                    } else {
                        showAddUser_ = true;
                        loginFocusInput_ = true;
                        aliasBuffer_[0] = '\0';
                    }
                }
                else if (ImGui::IsKeyPressed(ImGui::GetKeyIndex(ImGuiKey_Delete)) || ImGui::IsKeyPressed('x') || ImGui::IsKeyPressed('X')) {
                    if (activeUserIndex_ < (int)users.size()) {
                        showDeleteConfirm_ = true;
                        userToDeleteIndex_ = activeUserIndex_;
                    }
                }
            }

            // Render list
            ImGui::BeginChild("UserList", ImVec2(windowWidth - 4, windowHeight - 8), true);
            
            for (size_t i = 0; i < users.size(); ++i) {
                const auto& user = users[i];
                bool isSelected = (activeUserIndex_ == (int)i);
                
                std::string label = user.alias;
                if (user.hasFailed) label += " (Login Failed)";
                
                if (ImGui::Selectable(label.c_str(), isSelected)) {
                    activeUserIndex_ = i;
                    // Trigger login on click
                    performLogin(user.alias);
                }
                if (isSelected && !showAddUser_ && !showDeleteConfirm_) {
                    ImGui::SetItemDefaultFocus();
                }
            }
            
            // "Add User" row
            bool isAddSelected = (activeUserIndex_ == (int)users.size());
            ImGui::Separator();
            if (ImGui::Selectable("+ Add New User", isAddSelected)) {
                showAddUser_ = true;
                loginFocusInput_ = true;
                aliasBuffer_[0] = '\0';
            }
            
            ImGui::EndChild();
        } else {
             // Fallback if no DB
             ImGui::BeginChild("UserList", ImVec2(windowWidth - 4, windowHeight - 8), true);
             ImGui::Text("Database Error");
             ImGui::EndChild();
        }

        ImGui::Separator();

        if (showDeleteConfirm_) {
             ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "Delete user?");
             ImGui::SameLine();
             ImGui::Text("Press ENTER to confirm, ESC to cancel");
             
             if (ImGui::IsKeyPressed(ImGui::GetKeyIndex(ImGuiKey_Enter))) {
                 if (backend_.getAppDB()) {
                    auto users = backend_.getAppDB()->getUsers();
                    if (userToDeleteIndex_ < (int)users.size()) {
                        backend_.getAppDB()->deleteUser(users[userToDeleteIndex_].alias);
                        activeUserIndex_ = 0;
                    }
                 }
                 showDeleteConfirm_ = false;
             } else if (ImGui::IsKeyPressed(ImGui::GetKeyIndex(ImGuiKey_Escape))) {
                 showDeleteConfirm_ = false;
             }
        }
        else if (showAddUser_) {
            ImGui::Text("Enter new alias:");
            if (loginFocusInput_) {
                ImGui::SetKeyboardFocusHere();
                loginFocusInput_ = false;
            }
            if (ImGui::InputText("##newalias", aliasBuffer_, sizeof(aliasBuffer_), 
                ImGuiInputTextFlags_EnterReturnsTrue)) {
                if (strlen(aliasBuffer_) > 0) {
                    performLogin(aliasBuffer_);
                }
            }
            if (ImGui::IsKeyPressed(ImGuiKey_Escape)) {
                showAddUser_ = false;
            }
        } else {
            // Legend
            ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), 
                "NAV: k/j/Arrows  SELECT: Enter  DELETE: Del/x");
        }

        if (loginError_) {
            ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "Connection failed for %s", lastAttemptedAlias_.c_str());
        }

        ImGui::End();

    }

    void performLogin(const std::string& alias) {
        if (backend_.registerAndLogin(alias)) {
            currentScreen_ = Screen::Chat;
            refreshPeers();
            startPolling();
        } else {
            loginError_ = true;
            lastAttemptedAlias_ = alias;
            // Note: In a real app we'd mark the user as failed in memory
        }
    }

    void renderChatScreen() {
        ImVec2 displaySize = ImGui::GetIO().DisplaySize;
        float sidebarWidth = displaySize.x * 0.25f;
        
        // Full screen window
        ImGui::SetNextWindowPos(ImVec2(0, 0), ImGuiCond_Always);
        ImGui::SetNextWindowSize(displaySize, ImGuiCond_Always);

        ImGuiWindowFlags flags = ImGuiWindowFlags_NoTitleBar | 
                                  ImGuiWindowFlags_NoResize | 
                                  ImGuiWindowFlags_NoMove |
                                  ImGuiWindowFlags_NoCollapse |
                                  ImGuiWindowFlags_NoBringToFrontOnFocus;

        ImGui::Begin("##ChatScreen", nullptr, flags);

        // Sidebar with custom background color
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.15f, 0.15f, 0.18f, 1.0f));
        ImGui::BeginChild("Sidebar", ImVec2(sidebarWidth, 0), true);
        renderSidebar();
        ImGui::EndChild();
        ImGui::PopStyleColor();

        ImGui::SameLine();

        // Main chat area
        ImGui::BeginChild("MainArea", ImVec2(0, 0), true);
        renderMainArea();
        ImGui::EndChild();

        ImGui::End();
    }

    void renderSidebar() {
        // Header - Bright green
        ImGui::TextColored(ImVec4(0.4f, 1.0f, 0.4f, 1.0f), "  CHATS");
        ImGui::Separator();

        // New chat input
        ImGui::PushItemWidth(-1);
        if (ImGui::InputText("##newchat", newChatBuffer_, sizeof(newChatBuffer_), 
                             ImGuiInputTextFlags_EnterReturnsTrue)) {
            if (strlen(newChatBuffer_) > 0) {
                currentPeer_ = newChatBuffer_;
                newChatBuffer_[0] = '\0';
                refreshMessages();
            }
        }
        if (strlen(newChatBuffer_) == 0) {
            // Show placeholder - dim gray
            ImVec2 pos = ImGui::GetItemRectMin();
            ImGui::GetWindowDrawList()->AddText(
                ImVec2(pos.x + 2, pos.y), 
                ImGui::GetColorU32(ImVec4(0.4f, 0.4f, 0.4f, 1.0f)),
                "+ New chat..."
            );
        }
        ImGui::PopItemWidth();
        ImGui::Separator();

        // Peer list
        {
            std::lock_guard<std::mutex> lock(peersMutex_);
            if (peers_.empty()) {
                ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "No conversations yet");
            } else {
                for (const auto& peer : peers_) {
                    bool isSelected = (peer == currentPeer_);
                    if (ImGui::Selectable(peer.c_str(), isSelected)) {
                        currentPeer_ = peer;
                        refreshMessages();
                    }
                }
            }
        }
    }

    void renderMainArea() {
        float bottomBarHeight = 3.0f;
        float headerHeight = 2.0f;
        
        // Header - Yellow peer name
        ImGui::BeginChild("Header", ImVec2(0, headerHeight), false);
        if (currentPeer_.empty()) {
            ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Select a chat");
        } else {
            ImGui::TextColored(ImVec4(1.0f, 0.9f, 0.3f, 1.0f), "@%s", currentPeer_.c_str());
        }
        ImGui::Separator();
        ImGui::EndChild();

        // Messages area
        float messagesHeight = ImGui::GetContentRegionAvail().y - bottomBarHeight;
        ImGui::BeginChild("Messages", ImVec2(0, messagesHeight), false);
        
        if (currentPeer_.empty()) {
            // Center "Select a chat to start messaging"
            ImVec2 windowSize = ImGui::GetWindowSize();
            ImVec2 textSize = ImGui::CalcTextSize("Select a chat to start messaging");
            ImGui::SetCursorPos(ImVec2(
                (windowSize.x - textSize.x) / 2,
                windowSize.y / 2
            ));
            ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.55f, 1.0f), "Select a chat to start messaging");
        } else {
            std::lock_guard<std::mutex> lock(messagesMutex_);
            for (const auto& msg : messages_) {
                bool isMe = (msg.sender == "Me");
                float windowWidth = ImGui::GetWindowWidth();
                ImVec2 textSize = ImGui::CalcTextSize(msg.content.c_str());
                float paddingX = 2.0f;
                float paddingY = 0.0f;
                float bubbleWidth = textSize.x + paddingX * 2;
                float bubbleHeight = textSize.y + paddingY * 2;
                
                if (isMe) {
                    // Right-aligned message
                    float indent = windowWidth - bubbleWidth - 20;
                    if (indent > 10) ImGui::Indent(indent);
                    
                    // Draw bubble background
                    ImVec2 p = ImGui::GetCursorScreenPos();
                    ImGui::GetWindowDrawList()->AddRectFilled(
                        p, 
                        ImVec2(p.x + bubbleWidth, p.y + bubbleHeight), 
                        ImGui::GetColorU32(ImVec4(0.2f, 0.4f, 0.6f, 1.0f)), // Blue background
                        0.0f  // No rounding for TUI
                    );
                    
                    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + paddingX);
                    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + paddingY);
                    ImGui::TextColored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", msg.content.c_str());
                    
                    // Sender label below bubble
                    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + paddingY); 
                    ImGui::TextColored(ImVec4(0.6f, 0.7f, 0.8f, 1.0f), "Me");
                    
                    if (indent > 10) ImGui::Unindent(indent);
                } else {
                    // Left-aligned message
                    // Draw bubble background
                    ImVec2 p = ImGui::GetCursorScreenPos();
                    ImGui::GetWindowDrawList()->AddRectFilled(
                        p, 
                        ImVec2(p.x + bubbleWidth, p.y + bubbleHeight), 
                        ImGui::GetColorU32(ImVec4(0.25f, 0.25f, 0.25f, 1.0f)), // Dark gray background
                        0.0f  // No rounding for TUI
                    );
                    
                    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + paddingX);
                    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + paddingY);
                    ImGui::TextColored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", msg.content.c_str());
                    
                    // Sender label below bubble
                    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + paddingY);
                    ImGui::TextColored(ImVec4(0.5f, 0.7f, 0.5f, 1.0f), "%s", msg.sender.c_str());
                }
                ImGui::Text(""); // Space between messages
            }
            
            // Auto-scroll
            if (shouldScrollToBottom_) {
                ImGui::SetScrollHereY(1.0f);
                shouldScrollToBottom_ = false;
            }
        }
        ImGui::EndChild();

        // Input bar
        ImGui::Separator();
        ImGui::BeginChild("InputBar", ImVec2(0, 0), false);
        
        ImGui::PushItemWidth(-1);
        if (currentPeer_.empty()) {
            ImGui::InputText("##msginput", messageBuffer_, sizeof(messageBuffer_),
                             ImGuiInputTextFlags_ReadOnly);
        } else {
            if (ImGui::InputText("##msginput", messageBuffer_, sizeof(messageBuffer_),
                                 ImGuiInputTextFlags_EnterReturnsTrue)) {
                if (strlen(messageBuffer_) > 0) {
                    backend_.sendMessage(currentPeer_, messageBuffer_);
                    messageBuffer_[0] = '\0';
                    refreshMessages();
                    shouldScrollToBottom_ = true;
                }
            }
        }
        ImGui::PopItemWidth();
        
        ImGui::EndChild();
    }

    void refreshPeers() {
        std::lock_guard<std::mutex> lock(peersMutex_);
        peers_ = backend_.getPeers();
    }

    void refreshMessages() {
        if (currentPeer_.empty()) return;
        
        std::lock_guard<std::mutex> lock(messagesMutex_);
        messages_ = backend_.getMessages(currentPeer_);
        shouldScrollToBottom_ = true;
    }

    void startPolling() {
        backend_.startPolling([this](const std::set<std::string>& updatedPeers) {
            refreshPeers();
            if (updatedPeers.count(currentPeer_)) {
                refreshMessages();
            }
        });
    }

    // State
    bool running_ = true;
    Screen currentScreen_ = Screen::Login;
    Backend backend_;

    // Login screen state
    char aliasBuffer_[256] = "";  // Increased buffer size
    bool loginFocusInput_ = true;
    bool loginError_ = false;
    std::string lastAttemptedAlias_;
    
    // User selection state
    int activeUserIndex_ = -1;
    bool showAddUser_ = false;
    bool showDeleteConfirm_ = false;
    int userToDeleteIndex_ = -1;

    // Chat screen state
    std::string currentPeer_;
    char newChatBuffer_[256] = "";
    char messageBuffer_[1024] = "";
    
    std::vector<std::string> peers_;
    std::mutex peersMutex_;
    
    std::vector<Message> messages_;
    std::mutex messagesMutex_;
    
    bool shouldScrollToBottom_ = false;
};

} // namespace silentchat

int main() {
    // Debug to stderr first (before ncurses takes over)
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
    
    silentchat::App app;
    app.run();
    
    LOG_INFO("Main", "im_silent shutting down");
    return 0;
}
