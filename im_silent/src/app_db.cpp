#include "app_db.hpp"
#include "config.hpp"
#include "logger.hpp"

#include <iostream>
#include <system_error>

namespace silentchat {

AppDB::AppDB() {
    dbPath_ = (getConfigDir() / "app.db").string();
}

AppDB::~AppDB() {
    if (db_) {
        sqlite3_close(db_);
    }
}

bool AppDB::init() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    int rc = sqlite3_open(dbPath_.c_str(), &db_);
    if (rc) {
        LOG_ERROR("AppDB", "Can't open database: " + std::string(sqlite3_errmsg(db_)));
        return false;
    }

    createTables();
    migrateExistingUsers();
    return true;
}

void AppDB::createTables() {
    const char* sql = 
        "CREATE TABLE IF NOT EXISTS users ("
        "alias TEXT PRIMARY KEY,"
        "last_login INTEGER NOT NULL DEFAULT 0"
        ");";

    char* errMsg = nullptr;
    int rc = sqlite3_exec(db_, sql, nullptr, nullptr, &errMsg);
    if (rc != SQLITE_OK) {
        LOG_ERROR("AppDB", "SQL error: " + std::string(errMsg));
        sqlite3_free(errMsg);
    }
}

void AppDB::migrateExistingUsers() {
    LOG_INFO("AppDB", "Checking for users to migrate...");
    
    std::filesystem::path configDir = getConfigDir();
    if (!std::filesystem::exists(configDir)) return;

    for (const auto& entry : std::filesystem::directory_iterator(configDir)) {
        if (entry.is_directory()) {
            std::string alias = entry.path().filename().string();
            
            // Skip non-user directories
            if (alias == "." || alias == "..") continue;
            
            // Check if it looks like a user dir (has keys)
            if (std::filesystem::exists(entry.path() / "public_key.pem") ||
                std::filesystem::exists(entry.path() / "chat.db")) {
                
                addUser(alias);
            }
        }
    }
}

void AppDB::addUser(const std::string& alias) {
    std::string sql = "INSERT OR IGNORE INTO users (alias, last_login) VALUES (?, 0);";
    
    sqlite3_stmt* stmt;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
        sqlite3_bind_text(stmt, 1, alias.c_str(), -1, SQLITE_STATIC);
        
        if (sqlite3_step(stmt) != SQLITE_DONE) {
            LOG_ERROR("AppDB", "Error adding user: " + std::string(sqlite3_errmsg(db_)));
        }
        sqlite3_finalize(stmt);
    }
}

void AppDB::updateUserLogin(const std::string& alias) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    std::string sql = "INSERT OR REPLACE INTO users (alias, last_login) VALUES (?, ?);";
    
    auto now = std::chrono::system_clock::now();
    int64_t timestamp = std::chrono::duration_cast<std::chrono::seconds>(
        now.time_since_epoch()).count();

    sqlite3_stmt* stmt;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
        sqlite3_bind_text(stmt, 1, alias.c_str(), -1, SQLITE_STATIC);
        sqlite3_bind_int64(stmt, 2, timestamp);
        
        if (sqlite3_step(stmt) != SQLITE_DONE) {
            LOG_ERROR("AppDB", "Error updating login: " + std::string(sqlite3_errmsg(db_)));
        }
        sqlite3_finalize(stmt);
    }
}

std::vector<UserEntry> AppDB::getUsers() {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<UserEntry> users;
    
    const char* sql = "SELECT alias, last_login FROM users ORDER BY last_login DESC;";
    
    sqlite3_stmt* stmt;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) == SQLITE_OK) {
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            UserEntry user;
            user.alias = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
            user.lastLogin = sqlite3_column_int64(stmt, 1);
            user.hasFailed = false;
            users.push_back(user);
        }
        sqlite3_finalize(stmt);
    }
    
    return users;
}

void AppDB::deleteUser(const std::string& alias) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    std::string sql = "DELETE FROM users WHERE alias = ?;";
    
    sqlite3_stmt* stmt;
    if (sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr) == SQLITE_OK) {
        sqlite3_bind_text(stmt, 1, alias.c_str(), -1, SQLITE_STATIC);
        
        if (sqlite3_step(stmt) != SQLITE_DONE) {
            LOG_ERROR("AppDB", "Error deleting user: " + std::string(sqlite3_errmsg(db_)));
        } else {
            // Also remove the user directory from filesystem
            try {
                std::filesystem::path dbPath(dbPath_);
                std::filesystem::path configDir = dbPath.parent_path();
                std::filesystem::path userDir = configDir / alias;
                
                if (std::filesystem::exists(userDir)) {
                    std::filesystem::remove_all(userDir);
                    LOG_INFO("AppDB", "Deleted user directory: " + userDir.string());
                }
            } catch (const std::exception& e) {
                LOG_ERROR("AppDB", "Failed to delete user directory: " + std::string(e.what()));
            }
        }
        sqlite3_finalize(stmt);
    }
}

} // namespace silentchat
