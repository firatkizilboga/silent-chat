#include "backend.hpp"
#include "config.hpp"
#include "logger.hpp"

#include <fstream>
#include <sstream>
#include <chrono>
#include <filesystem>

namespace silentchat {

namespace fs = std::filesystem;

Backend::Backend() {
    http_.setBaseUrl(SERVER_URL);
    appDB_ = std::make_unique<AppDB>();
    if (!appDB_->init()) {
        LOG_ERROR("Backend", "Failed to initialize AppDB");
    }
}

Backend::~Backend() {
    stopPolling();
}

bool Backend::loadState() {
    fs::path userDir = getUserDir(alias_);
    fs::path privateKeyPath = userDir / "private_key.pem";
    fs::path publicKeyPath = userDir / "public_key.pem";
    fs::path tokenPath = userDir / "token.txt";
    fs::path dbPath = userDir / "chat.db";

    if (!fs::exists(privateKeyPath)) {
        return false;
    }

    if (!crypto_.loadKeys(privateKeyPath.string(), publicKeyPath.string())) {
        return false;
    }

    if (fs::exists(tokenPath)) {
        std::ifstream tokenFile(tokenPath);
        std::getline(tokenFile, jwt_);
    }

    db_ = std::make_unique<Database>(dbPath.string());
    return true;
}

void Backend::saveState() {
    fs::path userDir = getUserDir(alias_);
    fs::create_directories(userDir);

    fs::path privateKeyPath = userDir / "private_key.pem";
    fs::path publicKeyPath = userDir / "public_key.pem";
    fs::path tokenPath = userDir / "token.txt";

    crypto_.saveKeys(privateKeyPath.string(), publicKeyPath.string());

    if (!jwt_.empty()) {
        std::ofstream tokenFile(tokenPath);
        tokenFile << jwt_;
    }
}

bool Backend::registerAndLogin(const std::string& alias) {
    LOG_INFO("Backend", "Starting registerAndLogin for alias: " + alias);
    alias_ = alias;
    
    fs::path userDir = getUserDir(alias_);
    fs::create_directories(userDir);
    LOG_DEBUG("Backend", "User directory: " + userDir.string());
    
    fs::path dbPath = userDir / "chat.db";
    db_ = std::make_unique<Database>(dbPath.string());
    LOG_DEBUG("Backend", "Database initialized");

    bool hasKeys = loadState();
    LOG_INFO("Backend", hasKeys ? "Existing keys loaded" : "No existing keys found");
    
    if (!hasKeys) {
        // Generate new keys
        LOG_INFO("Backend", "Generating new key pair...");
        if (!crypto_.generateKeyPair()) {
            LOG_ERROR("Backend", "Failed to generate key pair");
            return false;
        }
        LOG_INFO("Backend", "Key pair generated successfully");

        // Register
        LOG_INFO("Backend", "Requesting registration challenge...");
        auto regChallenge = http_.post("/auth/register-challenge", {{"alias", alias}});
        if (!regChallenge.success()) {
            LOG_ERROR("Backend", "Registration challenge failed: " + std::to_string(regChallenge.statusCode));
            return false;
        }

        json regChallengeJson = json::parse(regChallenge.body);
        std::string nonce = regChallengeJson["nonce"];
        std::string signedNonce = crypto_.sign(nonce);

        auto regComplete = http_.post("/auth/register-complete", {
            {"alias", alias},
            {"publicKey", crypto_.getPublicKeyPEM()},
            {"signedNonce", signedNonce}
        });

        if (regComplete.statusCode != 201 && regComplete.statusCode != 409) {
            LOG_ERROR("Backend", "Registration failed: " + std::to_string(regComplete.statusCode) + " " + regComplete.body);
            return false;
        }
        LOG_INFO("Backend", "Registration complete (status: " + std::to_string(regComplete.statusCode) + ")");
    }

    // Login
    LOG_INFO("Backend", "Requesting login challenge...");
    auto loginChallenge = http_.post("/auth/login-challenge", {{"alias", alias}});
    
    // Handle user not found - re-register with existing keys
    if (loginChallenge.statusCode == 404 && hasKeys) {
        LOG_WARN("Backend", "User not found on server, re-registering with existing keys...");
        auto regChallenge = http_.post("/auth/register-challenge", {{"alias", alias}});
        if (!regChallenge.success()) {
            return false;
        }

        json regChallengeJson = json::parse(regChallenge.body);
        std::string nonce = regChallengeJson["nonce"];
        std::string signedNonce = crypto_.sign(nonce);

        auto regComplete = http_.post("/auth/register-complete", {
            {"alias", alias},
            {"publicKey", crypto_.getPublicKeyPEM()},
            {"signedNonce", signedNonce}
        });

        if (regComplete.statusCode != 201 && regComplete.statusCode != 409) {
            return false;
        }
        
        // Retry login
        loginChallenge = http_.post("/auth/login-challenge", {{"alias", alias}});
    }
    
    if (!loginChallenge.success()) {
        LOG_ERROR("Backend", "Login challenge failed: " + std::to_string(loginChallenge.statusCode) + " " + loginChallenge.body);
        return false;
    }
    LOG_DEBUG("Backend", "Login challenge received");

    json loginChallengeJson = json::parse(loginChallenge.body);
    std::string challenge = loginChallengeJson.contains("challenge") 
        ? loginChallengeJson["challenge"].get<std::string>()
        : loginChallengeJson["nonce"].get<std::string>();
    
    std::string signedChallenge = crypto_.sign(challenge);

    auto loginComplete = http_.post("/auth/login-complete", {
        {"alias", alias},
        {"signedChallenge", signedChallenge}
    });

    if (!loginComplete.success()) {
        LOG_ERROR("Backend", "Login failed: " + std::to_string(loginComplete.statusCode) + " " + loginComplete.body);
        return false;
    }
    LOG_INFO("Backend", "Login successful!");

    json loginCompleteJson = json::parse(loginComplete.body);
    jwt_ = loginCompleteJson["token"];
    http_.setBearerToken(jwt_);
    
    saveState();
    
    // Update global user history
    if (appDB_) {
        appDB_->updateUserLogin(alias);
    }
    
    return true;
}

bool Backend::fetchPeerKey(const std::string& target) {
    auto response = http_.get("/keys/" + target);
    if (!response.success()) {
        return false;
    }

    json responseJson = json::parse(response.body);
    peerPublicKeys_[target] = responseJson["publicKey"];
    return true;
}

bool Backend::sendMessage(const std::string& target, const std::string& text) {
    // Ensure we have a session with this peer
    if (activeSessions_.find(target) == activeSessions_.end()) {
        if (!fetchPeerKey(target)) {
            return false;
        }

        // Generate and exchange AES key
        auto aesKey = Crypto::generateAESKey();
        activeSessions_[target] = aesKey;

        std::string aesKeyStr(aesKey.begin(), aesKey.end());
        std::string encryptedKey = crypto_.rsaEncrypt(aesKeyStr, peerPublicKeys_[target]);
        std::string keySignature = crypto_.sign(encryptedKey);

        http_.post("/messages", {
            {"recipientAlias", target},
            {"type", "KEY_EXCHANGE"},
            {"encryptedMessage", encryptedKey},
            {"signature", keySignature}
        });
    }

    // Encrypt message
    std::string encryptedMsg = Crypto::aesEncrypt(text, activeSessions_[target]);
    std::string signature = crypto_.sign(encryptedMsg);

    // Store locally
    auto now = std::chrono::duration<double>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    db_->addMessage(signature, target, "Me", text, now, 0);

    // Send to server
    http_.post("/messages", {
        {"recipientAlias", target},
        {"type", "TEXT"},
        {"encryptedMessage", encryptedMsg},
        {"signature", signature}
    });

    return true;
}

std::vector<Message> Backend::getMessages(const std::string& peer) {
    return db_->getMessages(peer);
}

std::vector<std::string> Backend::getPeers() {
    return db_->getPeers();
}

std::set<std::string> Backend::decryptIncoming(const json& messages) {
    std::set<std::string> newChats;
    int64_t maxId = db_->getLastMessageId();

    for (const auto& m : messages) {
        std::string sender = m.value("senderAlias", "Unknown");
        std::string signature = m["signature"];
        std::string encryptedMessage = m["encryptedMessage"];
        std::string type = m["type"];
        int64_t msgId = m.value("id", int64_t(0));

        // Track max ID
        if (msgId > maxId) {
            maxId = msgId;
        }

        // Skip our own messages
        if (sender == alias_) continue;

        // Fetch peer key if needed
        if (peerPublicKeys_.find(sender) == peerPublicKeys_.end()) {
            if (!fetchPeerKey(sender)) continue;
        }
        
        // Verify signature
        if (!crypto_.verify(encryptedMessage, signature, peerPublicKeys_[sender])) {
            continue;
        }

        if (type == "KEY_EXCHANGE") {
            std::string decryptedKey = crypto_.rsaDecrypt(encryptedMessage);
            if (!decryptedKey.empty()) {
                activeSessions_[sender] = std::vector<uint8_t>(decryptedKey.begin(), decryptedKey.end());
            }
        } else if (type == "TEXT") {
            if (activeSessions_.find(sender) != activeSessions_.end()) {
                auto decrypted = Crypto::aesDecrypt(encryptedMessage, activeSessions_[sender]);
                if (decrypted) {
                    double timestamp = m.value("timestamp", 
                        std::chrono::duration<double>(
                            std::chrono::system_clock::now().time_since_epoch()
                        ).count());
                    
                    if (db_->addMessage(signature, sender, sender, *decrypted, timestamp, msgId)) {
                        newChats.insert(sender);
                    }
                }
            }
        }
    }

    // Update watermark
    if (maxId > db_->getLastMessageId()) {
        db_->setLastMessageId(maxId);
    }

    return newChats;
}

void Backend::startPolling(UpdateCallback callback) {
    if (polling_) return;
    
    updateCallback_ = callback;
    polling_ = true;

    pollThread_ = std::thread([this]() {
        while (polling_) {
            try {
                int64_t lastId = db_->getLastMessageId();
                std::string endpoint = "/messages?since=" + std::to_string(lastId);
                
                auto response = http_.get(endpoint);
                if (response.success() && !response.body.empty()) {
                    json messages = json::parse(response.body);
                    if (messages.is_array() && !messages.empty()) {
                        auto updatedPeers = decryptIncoming(messages);
                        if (!updatedPeers.empty() && updateCallback_) {
                            updateCallback_(updatedPeers);
                        }
                    }
                }
            } catch (...) {
                // Ignore polling errors
            }

            // Use condition variable with timeout instead of sleep
            // This allows immediate wakeup when stopPolling() is called
            std::unique_lock<std::mutex> lock(pollMutex_);
            pollCV_.wait_for(lock, std::chrono::seconds(1), [this]() {
                return !polling_.load();
            });
        }
    });
}

void Backend::stopPolling() {
    polling_ = false;
    pollCV_.notify_all(); // Wake up the polling thread immediately
    if (pollThread_.joinable()) {
        pollThread_.join();
    }
}

} // namespace silentchat
