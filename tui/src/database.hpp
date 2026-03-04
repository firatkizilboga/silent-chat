#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <memory>

struct sqlite3;

namespace silentchat {

struct Message {
    std::string id;        // signature (for dedup)
    std::string peer;
    std::string sender;
    std::string content;
    double timestamp;
    int64_t msgId = 0;     // server message ID for polling
};

class Database {
public:
    explicit Database(const std::string& dbPath);
    ~Database();

    // Prevent copying
    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;

    bool addMessage(const std::string& sigId, const std::string& peer, 
                    const std::string& sender, const std::string& content, 
                    double timestamp, int64_t msgId = 0);
    
    std::vector<Message> getMessages(const std::string& peer);
    std::vector<std::string> getPeers();
    
    // Config storage for lastMessageId
    int64_t getLastMessageId();
    void setLastMessageId(int64_t id);

private:
    void initDb();
    
    sqlite3* db_ = nullptr;
    std::mutex mutex_;
};

} // namespace silentchat
