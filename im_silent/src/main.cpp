/**
 * im_silent - Silent Chat TUI Client
 * A terminal-based E2EE chat client using FTXUI
 */

#include "ftxui/component/captured_mouse.hpp"
#include "ftxui/component/component.hpp"
#include "ftxui/component/component_base.hpp"
#include "ftxui/component/component_options.hpp"
#include "ftxui/component/screen_interactive.hpp"
#include "ftxui/dom/elements.hpp"
#include "ftxui/screen/color.hpp"

#include "config.hpp"
#include "backend.hpp"
#include "logger.hpp"

#include <string>
#include <vector>
#include <mutex>
#include <algorithm>
#include <iostream>
#include <memory>

namespace silentchat {

using namespace ftxui;

// Application state
enum class Screen {
    Login,
    Chat
};

class App {
public:
    App() = default;

    void run() {
        auto screen = ScreenInteractive::Fullscreen();
        
        // Create main component that switches between login and chat
        auto mainComponent = Container::Tab(
            {
                createLoginScreen(),
                createChatScreen()
            },
            &screenIndex_
        );

        screen.Loop(mainComponent);
    }

private:
    Component createLoginScreen() {
        // Input for new alias
        auto aliasInput = Input(&aliasInputText_, "Enter alias");
        
        // Menu for user list
        MenuOption menuOption;
        menuOption.on_enter = [this] {
            if (selectedUserIndex_ < (int)userDisplayList_.size() - 1) {
                // Login with selected user
                auto users = backend_.getAppDB()->getUsers();
                if (selectedUserIndex_ < (int)users.size()) {
                    performLogin(users[selectedUserIndex_].alias);
                }
            } else {
                // "Add New User" selected
                showAddUser_ = true;
                aliasInputText_ = "";
            }
        };
        
        auto userMenu = Menu(&userDisplayList_, &selectedUserIndex_, menuOption);
        
        // Container for add user or user list
        auto userListContainer = Container::Vertical({userMenu});
        
        // Delete confirmation buttons
        auto confirmDeleteBtn = Button("Confirm Delete", [this] {
            if (backend_.getAppDB()) {
                auto users = backend_.getAppDB()->getUsers();
                if (userToDeleteIndex_ < (int)users.size()) {
                    backend_.getAppDB()->deleteUser(users[userToDeleteIndex_].alias);
                    refreshUserList();
                    selectedUserIndex_ = 0;
                }
            }
            showDeleteConfirm_ = false;
        });
        
        auto cancelDeleteBtn = Button("Cancel", [this] {
            showDeleteConfirm_ = false;
        });
        
        auto deleteButtonsContainer = Container::Horizontal({confirmDeleteBtn, cancelDeleteBtn});
        
        // Add user input container
        auto addUserSubmit = Button("Add", [this, aliasInput] {
            if (!aliasInputText_.empty()) {
                performLogin(aliasInputText_);
                showAddUser_ = false;
            }
        });
        
        auto addUserCancel = Button("Cancel", [this] {
            showAddUser_ = false;
            aliasInputText_ = "";
        });
        
        auto addUserContainer = Container::Vertical({
            aliasInput,
            Container::Horizontal({addUserSubmit, addUserCancel})
        });
        
        // Main container that switches between states
        auto mainContainer = Container::Vertical({
            userListContainer,
            deleteButtonsContainer,
            addUserContainer
        });
        
        // Renderer to display everything
        return Renderer(mainContainer, [this, userMenu, deleteButtonsContainer, addUserContainer] {
            refreshUserList(); // Update user list on each render
            
            Elements elements;
            
            // Title
            elements.push_back(
                hbox({
                    text("  === ") | color(Color::Cyan),
                    text(APP_NAME) | color(Color::Cyan) | bold,
                    text(" v") | color(Color::Cyan),
                    text(APP_VERSION) | color(Color::Cyan),
                    text(" ===  ") | color(Color::Cyan)
                })
            );
            elements.push_back(separator());
            elements.push_back(text(""));
            
            // User list or add user form
            if (showDeleteConfirm_) {
                elements.push_back(
                    hbox({
                        text("Delete user? ") | color(Color::RedLight),
                        text("Press Enter to confirm, Esc to cancel")
                    })
                );
                elements.push_back(deleteButtonsContainer->Render());
            } else if (showAddUser_) {
                elements.push_back(text("Enter new alias:"));
                elements.push_back(addUserContainer->Render());
            } else {
                elements.push_back(userMenu->Render() | border | size(HEIGHT, LESS_THAN, 15));
                elements.push_back(separator());
                elements.push_back(
                    text("NAV: ↑/↓/j/k  SELECT: Enter  DELETE: Del/x") | 
                    color(Color::GrayDark)
                );
            }
            
            if (loginError_) {
                elements.push_back(
                    text("Connection failed for " + lastAttemptedAlias_) | 
                    color(Color::RedLight)
                );
            }
            
            auto content = vbox(elements);
            
            // Center the window
            return content | 
                   size(WIDTH, EQUAL, 60) | 
                   size(HEIGHT, EQUAL, 25) |
                   border |
                   center;
        }) | CatchEvent([this](Event event) {
            // Handle custom keyboard shortcuts
            if (showDeleteConfirm_) {
                if (event == Event::Return) {
                    if (backend_.getAppDB()) {
                        auto users = backend_.getAppDB()->getUsers();
                        if (userToDeleteIndex_ < (int)users.size()) {
                            backend_.getAppDB()->deleteUser(users[userToDeleteIndex_].alias);
                            refreshUserList();
                            selectedUserIndex_ = 0;
                        }
                    }
                    showDeleteConfirm_ = false;
                    return true;
                } else if (event == Event::Escape) {
                    showDeleteConfirm_ = false;
                    return true;
                }
            } else if (showAddUser_) {
                if (event == Event::Escape) {
                    showAddUser_ = false;
                    aliasInputText_ = "";
                    return true;
                }
            } else {
                // Regular navigation
                if (event == Event::Character('k') || event == Event::Character('K')) {
                    if (selectedUserIndex_ > 0) selectedUserIndex_--;
                    else selectedUserIndex_ = userDisplayList_.size() - 1;
                    return true;
                } else if (event == Event::Character('j') || event == Event::Character('J')) {
                    selectedUserIndex_ = (selectedUserIndex_ + 1) % userDisplayList_.size();
                    return true;
                } else if (event == Event::Character('x') || event == Event::Character('X') || 
                           event == Event::Delete) {
                    if (selectedUserIndex_ < (int)userDisplayList_.size() - 1) {
                        showDeleteConfirm_ = true;
                        userToDeleteIndex_ = selectedUserIndex_;
                        return true;
                    }
                }
            }
            return false;
        });
    }
    
    Component createChatScreen() {
        // Sidebar: New chat input
        auto newChatInput = Input(&newChatInputText_, "+ New chat...");
        
        // Sidebar: Peer list menu
        MenuOption peerMenuOption;
        peerMenuOption.on_enter = [this] {
            std::lock_guard<std::mutex> lock(peersMutex_);
            if (selectedPeerIndex_ >= 0 && selectedPeerIndex_ < (int)peers_.size()) {
                currentPeer_ = peers_[selectedPeerIndex_];
                refreshMessages();
            }
        };
        auto peerMenu = Menu(&peers_, &selectedPeerIndex_, peerMenuOption);
        
        // Sidebar container
        auto sidebarContainer = Container::Vertical({newChatInput, peerMenu});
        
        // Message input
        auto messageInput = Input(&messageInputText_, "Type a message...");
        
        // Main area container
        auto mainAreaContainer = Container::Vertical({messageInput});
        
        // Horizontal split: sidebar | main area
        auto chatContainer = Container::Horizontal({
            sidebarContainer,
            mainAreaContainer
        });
        
        return Renderer(chatContainer, [this, sidebarContainer, messageInput, peerMenu] {
            // Render sidebar
            Elements sidebarElements;
            sidebarElements.push_back(text("  CHATS") | color(Color::GreenLight) | bold);
            sidebarElements.push_back(separator());
            
            {
                std::lock_guard<std::mutex> lock(peersMutex_);
                if (peers_.empty()) {
                    sidebarElements.push_back(
                        text("No conversations yet") | color(Color::GrayDark)
                    );
                } else {
                    sidebarElements.push_back(peerMenu->Render());
                }
            }
            
            auto sidebar = vbox(sidebarElements) | 
                          bgcolor(Color::GrayDark) |
                          size(WIDTH, EQUAL, 30);
            
            // Render main area
            Elements mainElements;
            
            // Header
            if (currentPeer_.empty()) {
                mainElements.push_back(
                    text("Select a chat") | color(Color::GrayDark)
                );
            } else {
                mainElements.push_back(
                    text("@" + currentPeer_) | color(Color::Yellow) | bold
                );
            }
            mainElements.push_back(separator());
            
            // Messages
            if (currentPeer_.empty()) {
                mainElements.push_back(
                    text("Select a chat to start messaging") | 
                    color(Color::GrayLight) | 
                    center
                );
            } else {
                Elements messageElements;
                std::lock_guard<std::mutex> lock(messagesMutex_);
                for (const auto& msg : messages_) {
                    bool isMe = (msg.sender == "Me");
                    
                    Element bubble;
                    if (isMe) {
                        // Right-aligned message
                        bubble = vbox({
                            text(msg.content) | bgcolor(Color::Blue) | color(Color::White),
                            text("Me") | color(Color::CyanLight)
                        }) | align_right;
                    } else {
                        // Left-aligned message
                        bubble = vbox({
                            text(msg.content) | bgcolor(Color::GrayDark) | color(Color::White),
                            text(msg.sender) | color(Color::GreenLight)
                        });
                    }
                    messageElements.push_back(bubble);
                    messageElements.push_back(text(""));
                }
                mainElements.push_back(vbox(messageElements) | vscroll_indicator | frame);
            }
            
            mainElements.push_back(separator());
            mainElements.push_back(messageInput->Render());
            
            auto mainArea = vbox(mainElements);
            
            return hbox({sidebar, separator(), mainArea | flex});
        }) | CatchEvent([this, messageInput, newChatInput](Event event) {
            // Handle message sending
            if (event == Event::Return && messageInput->Focused()) {
                if (!currentPeer_.empty() && !messageInputText_.empty()) {
                    backend_.sendMessage(currentPeer_, messageInputText_);
                    messageInputText_ = "";
                    refreshMessages();
                    shouldScrollToBottom_ = true;
                    return true;
                }
            }
            
            // Handle new chat creation
            if (event == Event::Return && newChatInput->Focused()) {
                if (!newChatInputText_.empty()) {
                    currentPeer_ = newChatInputText_;
                    newChatInputText_ = "";
                    refreshMessages();
                    return true;
                }
            }
            
            return false;
        });
    }

    void refreshUserList() {
        userDisplayList_.clear();
        if (backend_.getAppDB()) {
            auto users = backend_.getAppDB()->getUsers();
            for (const auto& user : users) {
                std::string label = user.alias;
                if (user.hasFailed) label += " (Login Failed)";
                userDisplayList_.push_back(label);
            }
        }
        userDisplayList_.push_back("+ Add New User");
        
        // Ensure selected index is valid
        if (selectedUserIndex_ >= (int)userDisplayList_.size()) {
            selectedUserIndex_ = userDisplayList_.size() - 1;
        }
    }

    void performLogin(const std::string& alias) {
        if (backend_.registerAndLogin(alias)) {
            screenIndex_ = 1; // Switch to chat screen
            currentScreen_ = Screen::Chat;
            refreshPeers();
            startPolling();
            loginError_ = false;
        } else {
            loginError_ = true;
            lastAttemptedAlias_ = alias;
        }
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
    int screenIndex_ = 0; // 0 = Login, 1 = Chat
    Screen currentScreen_ = Screen::Login;
    Backend backend_;

    // Login screen state
    std::string aliasInputText_;
    bool loginError_ = false;
    std::string lastAttemptedAlias_;
    
    // User selection state
    int selectedUserIndex_ = 0;
    std::vector<std::string> userDisplayList_;
    bool showAddUser_ = false;
    bool showDeleteConfirm_ = false;
    int userToDeleteIndex_ = -1;

    // Chat screen state
    std::string currentPeer_;
    std::string newChatInputText_;
    std::string messageInputText_;
    
    std::vector<std::string> peers_;
    std::mutex peersMutex_;
    
    int selectedPeerIndex_ = 0;
    
    std::vector<Message> messages_;
    std::mutex messagesMutex_;
    
    bool shouldScrollToBottom_ = false;
};

} // namespace silentchat

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
    
    silentchat::App app;
    app.run();
    
    LOG_INFO("Main", "im_silent shutting down");
    return 0;
}
