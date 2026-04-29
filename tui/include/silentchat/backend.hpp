#pragma once

#include <silentchat/config.hpp>
#include <silentchat/logger.hpp>
#include <silentchat/crypto.hpp>
#include <silentchat/http.hpp>
#include <silentchat/database.hpp>
#include <silentchat/app_db.hpp>

#include <string>
#include <map>
#include <vector>
#include <memory>
#include <set>
#include <functional>
#include <atomic>
#include <thread>
#include <condition_variable>
#include <fstream>
#include <sstream>
#include <chrono>
#include <filesystem>

namespace silentchat {

class Backend {
public:
    Backend() {
        http_.setBaseUrl(SERVER_URL);
        appDB_ = std::make_unique<AppDB>();
        if (!appDB_->init()) {
            LOG_ERROR("Backend", "Failed to initialize AppDB");
        }
    }

    ~Backend() {
        stopPolling();
    }

    bool registerAndLogin(const std::string& alias) {
        namespace fs = std::filesystem;
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
            LOG_INFO("Backend", "Generating new key pair...");
            if (!crypto_.generateKeyPair()) {
                LOG_ERROR("Backend", "Failed to generate key pair");
                return false;
            }
            LOG_INFO("Backend", "Key pair generated successfully");

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
                {"nonce", nonce},
                {"signedNonce", signedNonce}
            });

            if (regComplete.statusCode != 201 && regComplete.statusCode != 409) {
                LOG_ERROR("Backend", "Registration failed: " + std::to_string(regComplete.statusCode) + " " + regComplete.body);
                return false;
            }
            LOG_INFO("Backend", "Registration complete (status: " + std::to_string(regComplete.statusCode) + ")");
        }

        LOG_INFO("Backend", "Requesting login challenge...");
        auto loginChallenge = http_.post("/auth/login-challenge", {{"alias", alias}});

        if (loginChallenge.statusCode == 404 && hasKeys) {
            LOG_WARN("Backend", "User not found on server, re-registering with existing keys...");
            auto regChallenge = http_.post("/auth/register-challenge", {{"alias", alias}});
            if (!regChallenge.success()) return false;

            json regChallengeJson = json::parse(regChallenge.body);
            std::string nonce = regChallengeJson["nonce"];
            std::string signedNonce = crypto_.sign(nonce);

            auto regComplete = http_.post("/auth/register-complete", {
                {"alias", alias},
                {"publicKey", crypto_.getPublicKeyPEM()},
                {"nonce", nonce},
                {"signedNonce", signedNonce}
            });

            if (regComplete.statusCode != 201 && regComplete.statusCode != 409) return false;

            loginChallenge = http_.post("/auth/login-challenge", {{"alias", alias}});
        }

        if (!loginChallenge.success()) {
            LOG_ERROR("Backend", "Login challenge failed: " + std::to_string(loginChallenge.statusCode) + " " + loginChallenge.body);
            return false;
        }

        json loginChallengeJson = json::parse(loginChallenge.body);
        std::string challenge = loginChallengeJson.contains("challenge")
            ? loginChallengeJson["challenge"].get<std::string>()
            : loginChallengeJson["nonce"].get<std::string>();

        std::string signedChallenge = crypto_.sign(challenge);

        auto loginComplete = http_.post("/auth/login-complete", {
            {"alias", alias},
            {"nonce", challenge},
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

        if (appDB_) appDB_->updateUserLogin(alias);

        return true;
    }

    bool isLoggedIn() const { return !jwt_.empty(); }
    const std::string& getAlias() const { return alias_; }

    bool sendMessage(const std::string& target, const std::string& text) {
        if (activeSessions_.find(target) == activeSessions_.end()) {
            if (!fetchPeerKey(target)) return false;

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

        std::string encryptedMsg = Crypto::aesEncrypt(text, activeSessions_[target]);
        std::string signature = crypto_.sign(encryptedMsg);

        auto now = std::chrono::duration<double>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
        db_->addMessage(signature, target, "Me", text, now, 0);

        http_.post("/messages", {
            {"recipientAlias", target},
            {"type", "TEXT"},
            {"encryptedMessage", encryptedMsg},
            {"signature", signature}
        });

        return true;
    }

    std::vector<Message> getMessages(const std::string& peer) {
        return db_->getMessages(peer);
    }

    std::vector<std::string> getPeers() {
        return db_->getPeers();
    }

    using UpdateCallback = std::function<void(const std::set<std::string>&)>;

    void startPolling(UpdateCallback callback) {
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
                            if (!updatedPeers.empty() && updateCallback_)
                                updateCallback_(updatedPeers);
                        }
                    }
                } catch (...) {}

                std::unique_lock<std::mutex> lock(pollMutex_);
                pollCV_.wait_for(lock, std::chrono::seconds(1), [this]() {
                    return !polling_.load();
                });
            }
        });
    }

    void stopPolling() {
        polling_ = false;
        pollCV_.notify_all();
        if (pollThread_.joinable()) pollThread_.join();
    }

    AppDB* getAppDB() { return appDB_.get(); }

private:
    bool loadState() {
        namespace fs = std::filesystem;
        fs::path userDir = getUserDir(alias_);
        fs::path privateKeyPath = userDir / "private_key.pem";
        fs::path publicKeyPath  = userDir / "public_key.pem";
        fs::path tokenPath      = userDir / "token.txt";
        fs::path dbPath         = userDir / "chat.db";

        if (!fs::exists(privateKeyPath)) return false;
        if (!crypto_.loadKeys(privateKeyPath.string(), publicKeyPath.string())) return false;

        if (fs::exists(tokenPath)) {
            std::ifstream tokenFile(tokenPath);
            std::getline(tokenFile, jwt_);
        }

        db_ = std::make_unique<Database>(dbPath.string());
        return true;
    }

    void saveState() {
        namespace fs = std::filesystem;
        fs::path userDir = getUserDir(alias_);
        fs::create_directories(userDir);
        crypto_.saveKeys((userDir / "private_key.pem").string(),
                         (userDir / "public_key.pem").string());
        if (!jwt_.empty()) {
            std::ofstream tokenFile(userDir / "token.txt");
            tokenFile << jwt_;
        }
    }

    bool fetchPeerKey(const std::string& target) {
        auto response = http_.get("/keys/" + target);
        if (!response.success()) return false;
        json responseJson = json::parse(response.body);
        peerPublicKeys_[target] = responseJson["publicKey"];
        return true;
    }

    std::set<std::string> decryptIncoming(const json& messages) {
        std::set<std::string> newChats;
        int64_t maxId = db_->getLastMessageId();

        for (const auto& m : messages) {
            std::string sender         = m.value("senderAlias", "Unknown");
            std::string signature      = m["signature"];
            std::string encryptedMessage = m["encryptedMessage"];
            std::string type           = m["type"];
            int64_t msgId              = m.value("id", int64_t(0));

            if (msgId > maxId) maxId = msgId;
            if (sender == alias_) continue;

            if (peerPublicKeys_.find(sender) == peerPublicKeys_.end()) {
                if (!fetchPeerKey(sender)) continue;
            }

            if (!crypto_.verify(encryptedMessage, signature, peerPublicKeys_[sender])) continue;

            if (type == "KEY_EXCHANGE") {
                std::string decryptedKey = crypto_.rsaDecrypt(encryptedMessage);
                if (!decryptedKey.empty())
                    activeSessions_[sender] = std::vector<uint8_t>(decryptedKey.begin(), decryptedKey.end());
            } else if (type == "TEXT") {
                if (activeSessions_.find(sender) != activeSessions_.end()) {
                    auto decrypted = Crypto::aesDecrypt(encryptedMessage, activeSessions_[sender]);
                    if (decrypted) {
                        double timestamp = m.value("timestamp",
                            std::chrono::duration<double>(
                                std::chrono::system_clock::now().time_since_epoch()
                            ).count());
                        if (db_->addMessage(signature, sender, sender, *decrypted, timestamp, msgId))
                            newChats.insert(sender);
                    }
                }
            }
        }

        if (maxId > db_->getLastMessageId()) db_->setLastMessageId(maxId);
        return newChats;
    }

    std::string alias_;
    std::string jwt_;
    Crypto crypto_;
    HttpClient http_;
    std::unique_ptr<Database> db_;
    std::unique_ptr<AppDB> appDB_;

    std::map<std::string, std::string> peerPublicKeys_;
    std::map<std::string, std::vector<uint8_t>> activeSessions_;

    std::atomic<bool> polling_{false};
    std::thread pollThread_;
    UpdateCallback updateCallback_;
    std::mutex pollMutex_;
    std::condition_variable pollCV_;
};

} // namespace silentchat
