#pragma once

#include "ftxui/component/component.hpp"
#include "backend.hpp"

#include <string>
#include <vector>
#include <mutex>
#include <set>

namespace silentchat {

using namespace ftxui;

enum class Screen {
    Login,
    Chat
};

class UI {
public:
    UI();
    void run();

private:
    Component createLoginScreen();
    Component createChatScreen();
    
    void refreshUserList();
    void performLogin(const std::string& alias);
    void refreshPeers();
    void refreshMessages();
    void startPolling();

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
