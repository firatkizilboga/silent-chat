#pragma once

#include <silentchat/logger.hpp>

#include <string>
#include <optional>
#include <nlohmann/json.hpp>
#include <curl/curl.h>
#include <sstream>

namespace silentchat {

using json = nlohmann::json;

struct HttpResponse {
    int statusCode;
    std::string body;
    bool success() const { return statusCode >= 200 && statusCode < 300; }
};

class HttpClient {
public:
    HttpClient() {
        curl_global_init(CURL_GLOBAL_DEFAULT);
        LOG_DEBUG("HTTP", "HttpClient initialized");
    }

    ~HttpClient() {
        curl_global_cleanup();
    }

    void setBaseUrl(const std::string& url) {
        baseUrl_ = url;
        LOG_INFO("HTTP", "Base URL set to: " + url);
    }

    void setBearerToken(const std::string& token) {
        bearerToken_ = token;
        LOG_DEBUG("HTTP", "Bearer token set (length: " + std::to_string(token.length()) + ")");
    }

    void clearBearerToken() {
        bearerToken_.clear();
        LOG_DEBUG("HTTP", "Bearer token cleared");
    }

    HttpResponse get(const std::string& endpoint) {
        HttpResponse response{0, ""};

        CURL* curl = curl_easy_init();
        if (!curl) {
            LOG_ERROR("HTTP", "Failed to initialize CURL for GET request");
            return response;
        }

        std::string url = baseUrl_ + endpoint;
        std::string responseBody;

        LOG_DEBUG("HTTP", "GET " + url);

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseBody);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);

        struct curl_slist* headers = nullptr;
        if (!bearerToken_.empty()) {
            std::string authHeader = "Authorization: Bearer " + bearerToken_;
            headers = curl_slist_append(headers, authHeader.c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        }

        CURLcode res = curl_easy_perform(curl);
        if (res == CURLE_OK) {
            long httpCode = 0;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
            response.statusCode = static_cast<int>(httpCode);
            response.body = responseBody;
            LOG_DEBUG("HTTP", "GET " + endpoint + " -> " + std::to_string(httpCode) +
                      " (body: " + std::to_string(responseBody.length()) + " bytes)");
        } else {
            LOG_ERROR("HTTP", "GET " + endpoint + " failed: " + std::string(curl_easy_strerror(res)));
        }

        if (headers) curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        return response;
    }

    HttpResponse post(const std::string& endpoint, const json& body) {
        HttpResponse response{0, ""};

        CURL* curl = curl_easy_init();
        if (!curl) {
            LOG_ERROR("HTTP", "Failed to initialize CURL for POST request");
            return response;
        }

        std::string url = baseUrl_ + endpoint;
        std::string requestBody = body.dump();
        std::string responseBody;

        LOG_DEBUG("HTTP", "POST " + url + " (body: " + std::to_string(requestBody.length()) + " bytes)");

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, requestBody.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseBody);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);

        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");
        if (!bearerToken_.empty()) {
            std::string authHeader = "Authorization: Bearer " + bearerToken_;
            headers = curl_slist_append(headers, authHeader.c_str());
        }
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

        CURLcode res = curl_easy_perform(curl);
        if (res == CURLE_OK) {
            long httpCode = 0;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
            response.statusCode = static_cast<int>(httpCode);
            response.body = responseBody;
            LOG_DEBUG("HTTP", "POST " + endpoint + " -> " + std::to_string(httpCode) +
                      " (response: " + std::to_string(responseBody.length()) + " bytes)");
            if (httpCode >= 400) {
                LOG_WARN("HTTP", "POST " + endpoint + " error response: " + responseBody);
            }
        } else {
            LOG_ERROR("HTTP", "POST " + endpoint + " failed: " + std::string(curl_easy_strerror(res)));
        }

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        return response;
    }

private:
    static size_t writeCallback(void* contents, size_t size, size_t nmemb, std::string* userp) {
        size_t totalSize = size * nmemb;
        userp->append(static_cast<char*>(contents), totalSize);
        return totalSize;
    }

    std::string baseUrl_;
    std::string bearerToken_;
};

} // namespace silentchat
