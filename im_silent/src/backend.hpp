#pragma once

#include "crypto.hpp"
#include "http.hpp"
#include "database.hpp"
#include "app_db.hpp"

#include <string>
#include <map>
#include <vector>
#include <memory>
#include <set>
#include <functional>
#include <atomic>
#include <thread>

namespace silentchat {

class Backend {
public:
    Backend();
    ~Backend();

    // User management
    bool registerAndLogin(const std::string& alias);
    bool isLoggedIn() const { return !jwt_.empty(); }
    const std::string& getAlias() const { return alias_; }

    // Messaging
    bool sendMessage(const std::string& target, const std::string& text);
    std::vector<Message> getMessages(const std::string& peer);
    std::vector<std::string> getPeers();

    // Polling
    using UpdateCallback = std::function<void(const std::set<std::string>&)>;
    void startPolling(UpdateCallback callback);
    void stopPolling();

    AppDB* getAppDB() { return appDB_.get(); }

private:
    bool loadState();
    void saveState();
    bool fetchPeerKey(const std::string& target);
    std::set<std::string> decryptIncoming(const json& messages);

    std::string alias_;
    std::string jwt_;
    Crypto crypto_;
    HttpClient http_;
    std::unique_ptr<Database> db_;
    std::unique_ptr<AppDB> appDB_;

    std::map<std::string, std::string> peerPublicKeys_; // alias -> PEM
    std::map<std::string, std::vector<uint8_t>> activeSessions_; // alias -> AES key

    std::atomic<bool> polling_{false};
    std::thread pollThread_;
    UpdateCallback updateCallback_;
};

} // namespace silentchat
