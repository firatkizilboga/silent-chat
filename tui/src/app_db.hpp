#pragma once

#include <string>
#include <vector>
#include <memory>
#include <chrono>
#include <sqlite3.h>
#include <mutex>
#include <filesystem>
#include "logger.hpp"

namespace silentchat {

struct UserEntry {
    std::string alias;
    int64_t lastLogin;
    bool hasFailed; // Not persistent, runtime only
};

class AppDB {
public:
    AppDB();
    ~AppDB();

    bool init();
    void migrateExistingUsers();
    
    std::vector<UserEntry> getUsers();
    void updateUserLogin(const std::string& alias);
    void addUser(const std::string& alias);
    void deleteUser(const std::string& alias);

private:
    void createTables();
    
    sqlite3* db_ = nullptr;
    std::mutex mutex_;
    std::string dbPath_;
};

} // namespace silentchat
