#pragma once

#include <string>
#include <optional>
#include <nlohmann/json.hpp>

namespace silentchat {

using json = nlohmann::json;

struct HttpResponse {
    int statusCode;
    std::string body;
    bool success() const { return statusCode >= 200 && statusCode < 300; }
};

class HttpClient {
public:
    HttpClient();
    ~HttpClient();

    void setBaseUrl(const std::string& url);
    void setBearerToken(const std::string& token);
    void clearBearerToken();

    HttpResponse get(const std::string& endpoint);
    HttpResponse post(const std::string& endpoint, const json& body);

private:
    std::string baseUrl_;
    std::string bearerToken_;
};

} // namespace silentchat
