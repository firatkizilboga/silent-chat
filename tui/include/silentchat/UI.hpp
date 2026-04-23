#pragma once

#include <silentchat/config.hpp>
#include <silentchat/backend.hpp>

#include "ftxui/component/captured_mouse.hpp"
#include "ftxui/component/component.hpp"
#include "ftxui/component/component_base.hpp"
#include "ftxui/component/component_options.hpp"
#include "ftxui/component/screen_interactive.hpp"
#include "ftxui/dom/elements.hpp"
#include "ftxui/screen/color.hpp"

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
    UI() = default;

    void run() {
        auto screen = ScreenInteractive::Fullscreen();
        auto mainComponent = Container::Tab(
            {createLoginScreen(), createChatScreen()},
            &screenIndex_
        );
        screen.Loop(mainComponent);
    }

private:
    Component createLoginScreen() {
        auto aliasInput = Input(&aliasInputText_, "Enter alias");

        MenuOption menuOption;
        menuOption.on_enter = [this, aliasInput] {
            if (selectedUserIndex_ < (int)userDisplayList_.size() - 1) {
                auto users = backend_.getAppDB()->getUsers();
                if (selectedUserIndex_ < (int)users.size())
                    performLogin(users[selectedUserIndex_].alias);
            } else {
                showAddUser_ = true;
                aliasInputText_ = "";
                aliasInput->TakeFocus();
            }
        };

        auto userMenu = Menu(&userDisplayList_, &selectedUserIndex_, menuOption);
        auto userListContainer = Container::Vertical({userMenu});

        auto confirmDeleteBtn = Button("Confirm Delete", [this] {
            if (backend_.getAppDB()) {
                auto users = backend_.getAppDB()->getUsers();
                if (userToDeleteIndex_ < (int)users.size())
                    backend_.getAppDB()->deleteUser(users[userToDeleteIndex_].alias);
                refreshUserList();
                selectedUserIndex_ = 0;
            }
            showDeleteConfirm_ = false;
        });

        auto cancelDeleteBtn = Button("Cancel", [this] { showDeleteConfirm_ = false; });
        auto deleteButtonsContainer = Container::Horizontal({confirmDeleteBtn, cancelDeleteBtn});

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

        auto mainContainer = Container::Vertical({
            userListContainer,
            deleteButtonsContainer,
            addUserContainer
        });

        return Renderer(mainContainer, [this, userMenu, deleteButtonsContainer, addUserContainer] {
            refreshUserList();

            Elements elements;
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
            }

            if (loginError_) {
                elements.push_back(
                    text("Connection failed for " + lastAttemptedAlias_) | color(Color::RedLight)
                );
            }

            elements.push_back(filler());

            if (!showDeleteConfirm_ && !showAddUser_) {
                elements.push_back(separator());
                elements.push_back(
                    text("NAV: ↑/↓/j/k  SELECT: Enter  DELETE: Del/x") |
                    color(Color::GrayDark)
                );
            }

            auto content = vbox(elements);
            return content |
                   size(WIDTH, EQUAL, 60) |
                   size(HEIGHT, EQUAL, 25) |
                   border |
                   center;
        }) | CatchEvent([this](Event event) {
            if (showDeleteConfirm_) {
                if (event == Event::Return) {
                    if (backend_.getAppDB()) {
                        auto users = backend_.getAppDB()->getUsers();
                        if (userToDeleteIndex_ < (int)users.size())
                            backend_.getAppDB()->deleteUser(users[userToDeleteIndex_].alias);
                        refreshUserList();
                        selectedUserIndex_ = 0;
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
                if (event == Event::Character('k') || event == Event::Character('K')) {
                    if (selectedUserIndex_ > 0) selectedUserIndex_--;
                    else selectedUserIndex_ = static_cast<int>(userDisplayList_.size()) - 1;
                    return true;
                } else if (event == Event::Character('j') || event == Event::Character('J')) {
                    selectedUserIndex_ = (selectedUserIndex_ + 1) % static_cast<int>(userDisplayList_.size());
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
        auto newChatButton = Button("+ New Chat", [] {});
        auto newChatInput  = Input(&newChatInputText_, "Enter username...");
        auto messageInput  = Input(&messageInputText_, "Type a message...");

        MenuOption peerMenuOption;
        peerMenuOption.on_enter = [this, messageInput] {
            std::lock_guard<std::mutex> lock(peersMutex_);
            if (selectedPeerIndex_ >= 0 && selectedPeerIndex_ < (int)peers_.size()) {
                currentPeer_ = peers_[selectedPeerIndex_];
                refreshMessages();
                messageInput->TakeFocus();
            }
        };
        peerMenuOption.on_change = [this, messageInput] {
            std::lock_guard<std::mutex> lock(peersMutex_);
            if (selectedPeerIndex_ >= 0 && selectedPeerIndex_ < (int)peers_.size()) {
                currentPeer_ = peers_[selectedPeerIndex_];
                refreshMessages();
                messageInput->TakeFocus();
            }
        };
        auto peerMenu = Menu(&peers_, &selectedPeerIndex_, peerMenuOption);

        auto sidebarContainer  = Container::Vertical({peerMenu, newChatInput, newChatButton});
        auto mainAreaContainer = Container::Vertical({messageInput});
        auto chatContainer     = Container::Horizontal({sidebarContainer, mainAreaContainer});

        auto chatWithExit = chatContainer | CatchEvent([this](Event event) {
            if (event == Event::CtrlC) {
                backend_.stopPolling();
                return true;
            }
            return false;
        });

        return Renderer(chatWithExit, [this, sidebarContainer, messageInput, peerMenu, newChatButton, newChatInput] {
            Elements sidebarElements;
            sidebarElements.push_back(
                vbox({text(""), text("silent-chat") | color(Color::Cyan) | bold | center, text("")}) |
                size(HEIGHT, EQUAL, 3)
            );
            sidebarElements.push_back(separator());
            sidebarElements.push_back(text("  CHATS") | color(Color::GreenLight) | bold);
            sidebarElements.push_back(separator());

            {
                std::lock_guard<std::mutex> lock(peersMutex_);
                if (peers_.empty())
                    sidebarElements.push_back(text("No conversations yet") | color(Color::GrayDark) | flex);
                else
                    sidebarElements.push_back(peerMenu->Render() | flex);
            }

            sidebarElements.push_back(separator());
            sidebarElements.push_back(newChatInput->Render() | size(WIDTH, EQUAL, 28));
            sidebarElements.push_back(newChatButton->Render() | hcenter);

            auto sidebar = vbox(sidebarElements) | size(WIDTH, EQUAL, 30);

            Elements mainElements;
            if (currentPeer_.empty()) {
                mainElements.push_back(
                    vbox({text(""), text("Select a chat") | color(Color::GrayDark) | center, text("")})
                );
            } else {
                mainElements.push_back(
                    vbox({text(""), hbox({text(" "), text("@" + currentPeer_) | color(Color::Yellow) | bold, text(" ")}) | center, text("")}) |
                    size(HEIGHT, EQUAL, 3)
                );
            }
            mainElements.push_back(separator());

            if (currentPeer_.empty()) {
                mainElements.push_back(
                    text("Select a chat to start messaging") | color(Color::GrayLight) | center | flex
                );
            } else {
                Elements messageElements;
                std::lock_guard<std::mutex> lock(messagesMutex_);
                for (const auto& msg : messages_) {
                    bool isMe = (msg.sender == "Me");
                    Element bubble;
                    if (isMe) {
                        bubble = hbox({
                            filler(),
                            vbox({
                                hbox({text(" "), text(msg.content) | border | color(Color::White), text(" ")}),
                                hbox({filler(), text("Me") | color(Color::CyanLight)})
                            }) | size(WIDTH, LESS_THAN, 60)
                        });
                    } else {
                        bubble = vbox({
                            hbox({text(" "), text(msg.content) | border | color(Color::White), text(" ")}),
                            text(msg.sender) | color(Color::GreenLight)
                        }) | size(WIDTH, LESS_THAN, 60);
                    }
                    messageElements.push_back(bubble);
                    messageElements.push_back(text(""));
                }
                mainElements.push_back(vbox(messageElements) | vscroll_indicator | frame | flex);
            }

            mainElements.push_back(separator());
            mainElements.push_back(
                hbox({text(" "), messageInput->Render() | flex, text(" ")})
            );

            auto mainArea = vbox(mainElements);
            return hbox({sidebar, separator(), mainArea | flex});
        }) | CatchEvent([this, messageInput, newChatInput](Event event) {
            if (event == Event::Return && messageInput->Focused()) {
                if (!currentPeer_.empty() && !messageInputText_.empty()) {
                    backend_.sendMessage(currentPeer_, messageInputText_);
                    messageInputText_ = "";
                    refreshMessages();
                    shouldScrollToBottom_ = true;
                    return true;
                }
            }
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
        if (selectedUserIndex_ >= static_cast<int>(userDisplayList_.size()))
            selectedUserIndex_ = static_cast<int>(userDisplayList_.size()) - 1;
    }

    void performLogin(const std::string& alias) {
        if (backend_.registerAndLogin(alias)) {
            screenIndex_ = 1;
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
            if (updatedPeers.count(currentPeer_)) refreshMessages();
        });
    }

    int screenIndex_ = 0;
    Screen currentScreen_ = Screen::Login;
    Backend backend_;

    std::string aliasInputText_;
    bool loginError_ = false;
    std::string lastAttemptedAlias_;

    int selectedUserIndex_ = 0;
    std::vector<std::string> userDisplayList_;
    bool showAddUser_ = false;
    bool showDeleteConfirm_ = false;
    int userToDeleteIndex_ = -1;

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
