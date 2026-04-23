#pragma once

#include <string>
#include <fstream>
#include <mutex>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <filesystem>

namespace silentchat {

enum class LogLevel {
    DEBUG,
    INFO,
    WARN,
    ERROR
};

class Logger {
public:
    static Logger& instance() {
        static Logger logger;
        return logger;
    }

    void init(const std::string& logPath) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (file_.is_open()) {
                file_.close();
            }
            std::filesystem::path path(logPath);
            if (path.has_parent_path()) {
                std::filesystem::create_directories(path.parent_path());
            }
            file_.open(logPath, std::ios::out | std::ios::app);
        }
        if (file_.is_open()) {
            log(LogLevel::INFO, "Logger", "=== Log session started ===");
        }
    }

    void setLevel(LogLevel level) {
        minLevel_ = level;
    }

    void log(LogLevel level, const std::string& component, const std::string& message) {
        if (level < minLevel_) return;

        std::lock_guard<std::mutex> lock(mutex_);
        if (!file_.is_open()) return;

        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()) % 1000;

        std::ostringstream oss;
        oss << std::put_time(std::localtime(&time), "%Y-%m-%d %H:%M:%S")
            << '.' << std::setfill('0') << std::setw(3) << ms.count()
            << " [" << levelToString(level) << "] "
            << "[" << component << "] "
            << message << "\n";

        file_ << oss.str();
        file_.flush();
    }

    void debug(const std::string& component, const std::string& message) {
        log(LogLevel::DEBUG, component, message);
    }

    void info(const std::string& component, const std::string& message) {
        log(LogLevel::INFO, component, message);
    }

    void warn(const std::string& component, const std::string& message) {
        log(LogLevel::WARN, component, message);
    }

    void error(const std::string& component, const std::string& message) {
        log(LogLevel::ERROR, component, message);
    }

private:
    Logger() = default;
    ~Logger() {
        if (file_.is_open()) {
            log(LogLevel::INFO, "Logger", "=== Log session ended ===");
            file_.close();
        }
    }

    Logger(const Logger&) = delete;
    Logger& operator=(const Logger&) = delete;

    static const char* levelToString(LogLevel level) {
        switch (level) {
            case LogLevel::DEBUG: return "DEBUG";
            case LogLevel::INFO:  return "INFO ";
            case LogLevel::WARN:  return "WARN ";
            case LogLevel::ERROR: return "ERROR";
            default: return "?????";
        }
    }

    std::ofstream file_;
    std::mutex mutex_;
    LogLevel minLevel_ = LogLevel::DEBUG;
};

#define LOG_DEBUG(component, msg) silentchat::Logger::instance().debug(component, msg)
#define LOG_INFO(component, msg)  silentchat::Logger::instance().info(component, msg)
#define LOG_WARN(component, msg)  silentchat::Logger::instance().warn(component, msg)
#define LOG_ERROR(component, msg) silentchat::Logger::instance().error(component, msg)

} // namespace silentchat
