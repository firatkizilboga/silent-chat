#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <memory>
#include <stdexcept>

#include <sqlite3.h>

namespace silentchat {

struct Message {
    std::string id;
    std::string peer;
    std::string sender;
    std::string content;
    double timestamp;
    int64_t msgId = 0;
};

class Database {
public:
    explicit Database(const std::string& dbPath) {
        if (sqlite3_open(dbPath.c_str(), &db_) != SQLITE_OK) {
            throw std::runtime_error("Failed to open database: " + dbPath);
        }
        initDb();
    }

    ~Database() {
        if (db_) sqlite3_close(db_);
    }

    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;

    bool addMessage(const std::string& sigId, const std::string& peer,
                    const std::string& sender, const std::string& content,
                    double timestamp, int64_t msgId = 0) {
        std::lock_guard<std::mutex> lock(mutex_);
        const char* sql = "INSERT OR IGNORE INTO messages (id, peer, sender, content, timestamp, msg_id) VALUES (?, ?, ?, ?, ?, ?)";
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return false;
        sqlite3_bind_text(stmt, 1, sigId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, peer.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, sender.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 4, content.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_double(stmt, 5, timestamp);
        sqlite3_bind_int64(stmt, 6, msgId);
        int result = sqlite3_step(stmt);
        int changes = sqlite3_changes(db_);
        sqlite3_finalize(stmt);
        return result == SQLITE_DONE && changes > 0;
    }

    std::vector<Message> getMessages(const std::string& peer) {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<Message> messages;
        const char* sql = "SELECT id, peer, sender, content, timestamp, msg_id FROM messages WHERE peer = ? ORDER BY timestamp ASC";
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return messages;
        sqlite3_bind_text(stmt, 1, peer.c_str(), -1, SQLITE_TRANSIENT);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Message msg;
            msg.id      = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
            msg.peer    = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
            msg.sender  = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2));
            msg.content = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3));
            msg.timestamp = sqlite3_column_double(stmt, 4);
            msg.msgId   = sqlite3_column_int64(stmt, 5);
            messages.push_back(msg);
        }
        sqlite3_finalize(stmt);
        return messages;
    }

    std::vector<std::string> getPeers() {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<std::string> peers;
        const char* sql = "SELECT DISTINCT peer FROM messages";
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return peers;
        while (sqlite3_step(stmt) == SQLITE_ROW)
            peers.push_back(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0)));
        sqlite3_finalize(stmt);
        return peers;
    }

    int64_t getLastMessageId() {
        std::lock_guard<std::mutex> lock(mutex_);
        const char* sql = "SELECT value FROM config WHERE key = 'lastMessageId'";
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return 0;
        int64_t result = 0;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            const char* value = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
            if (value) result = std::stoll(value);
        }
        sqlite3_finalize(stmt);
        return result;
    }

    void setLastMessageId(int64_t id) {
        std::lock_guard<std::mutex> lock(mutex_);
        const char* sql = "INSERT OR REPLACE INTO config (key, value) VALUES ('lastMessageId', ?)";
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return;
        std::string idStr = std::to_string(id);
        sqlite3_bind_text(stmt, 1, idStr.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

private:
    void initDb() {
        std::lock_guard<std::mutex> lock(mutex_);
        const char* messagesSql = R"(
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                peer TEXT,
                sender TEXT,
                content TEXT,
                timestamp REAL,
                msg_id INTEGER DEFAULT 0
            )
        )";
        const char* configSql = R"(
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        )";
        char* errMsg = nullptr;
        if (sqlite3_exec(db_, messagesSql, nullptr, nullptr, &errMsg) != SQLITE_OK) {
            std::string error = errMsg ? errMsg : "Unknown error";
            sqlite3_free(errMsg);
            throw std::runtime_error("Failed to create messages table: " + error);
        }
        if (sqlite3_exec(db_, configSql, nullptr, nullptr, &errMsg) != SQLITE_OK) {
            std::string error = errMsg ? errMsg : "Unknown error";
            sqlite3_free(errMsg);
            throw std::runtime_error("Failed to create config table: " + error);
        }
        sqlite3_exec(db_, "ALTER TABLE messages ADD COLUMN msg_id INTEGER DEFAULT 0",
                     nullptr, nullptr, nullptr);
    }

    sqlite3* db_ = nullptr;
    std::mutex mutex_;
};

} // namespace silentchat
