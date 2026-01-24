#pragma once

#include <string>
#include <vector>
#include <optional>
#include <memory>

#include <openssl/evp.h>

namespace silentchat {

// Custom deleter for EVP_PKEY
struct EVP_PKEY_Deleter {
    void operator()(EVP_PKEY* p) const { if (p) EVP_PKEY_free(p); }
};
using EVP_PKEY_ptr = std::unique_ptr<EVP_PKEY, EVP_PKEY_Deleter>;

class Crypto {
public:
    Crypto();
    ~Crypto();

    // Key management
    bool generateKeyPair();
    bool loadPrivateKey(const std::string& pemData);
    bool loadPublicKey(const std::string& pemData);
    std::string getPublicKeyPEM() const;
    std::string getPrivateKeyPEM() const;
    
    // Save/load from files
    bool saveKeys(const std::string& privateKeyPath, const std::string& publicKeyPath);
    bool loadKeys(const std::string& privateKeyPath, const std::string& publicKeyPath);

    // RSA operations
    std::string sign(const std::string& data) const;
    bool verify(const std::string& data, const std::string& signatureB64, const std::string& publicKeyPEM) const;
    std::string rsaEncrypt(const std::string& data, const std::string& publicKeyPEM) const;
    std::string rsaDecrypt(const std::string& encryptedB64) const;

    // AES-GCM operations
    static std::vector<uint8_t> generateAESKey();
    static std::string aesEncrypt(const std::string& plaintext, const std::vector<uint8_t>& key);
    static std::optional<std::string> aesDecrypt(const std::string& ciphertextB64, const std::vector<uint8_t>& key);

    // Base64 utilities
    static std::string base64Encode(const std::vector<uint8_t>& data);
    static std::string base64Encode(const std::string& data);
    static std::vector<uint8_t> base64Decode(const std::string& encoded);

private:
    EVP_PKEY_ptr privateKey_;
    EVP_PKEY_ptr publicKey_;
};

} // namespace silentchat
