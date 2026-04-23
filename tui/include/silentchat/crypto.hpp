#pragma once

#include <silentchat/logger.hpp>

#include <string>
#include <vector>
#include <optional>
#include <memory>
#include <fstream>
#include <sstream>
#include <cstring>

#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/rsa.h>
#include <openssl/rand.h>
#include <openssl/err.h>

namespace silentchat {

struct EVP_PKEY_Deleter {
    void operator()(EVP_PKEY* p) const { if (p) EVP_PKEY_free(p); }
};
using EVP_PKEY_ptr = std::unique_ptr<EVP_PKEY, EVP_PKEY_Deleter>;

class Crypto {
public:
    Crypto() = default;
    ~Crypto() = default;

    bool generateKeyPair() {
        EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, nullptr);
        if (!ctx) return false;

        if (EVP_PKEY_keygen_init(ctx) <= 0) { EVP_PKEY_CTX_free(ctx); return false; }
        if (EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, 2048) <= 0) { EVP_PKEY_CTX_free(ctx); return false; }

        EVP_PKEY* pkey = nullptr;
        if (EVP_PKEY_keygen(ctx, &pkey) <= 0) { EVP_PKEY_CTX_free(ctx); return false; }

        privateKey_.reset(pkey);

        BIO* bio = BIO_new(BIO_s_mem());
        PEM_write_bio_PUBKEY(bio, pkey);
        char* data;
        long len = BIO_get_mem_data(bio, &data);
        std::string pubPEM(data, len);
        BIO_free(bio);

        loadPublicKey(pubPEM);
        EVP_PKEY_CTX_free(ctx);
        return true;
    }

    bool loadPrivateKey(const std::string& pemData) {
        BIO* bio = BIO_new_mem_buf(pemData.c_str(), -1);
        if (!bio) return false;
        EVP_PKEY* pkey = PEM_read_bio_PrivateKey(bio, nullptr, nullptr, nullptr);
        BIO_free(bio);
        if (!pkey) return false;
        privateKey_.reset(pkey);
        return true;
    }

    bool loadPublicKey(const std::string& pemData) {
        BIO* bio = BIO_new_mem_buf(pemData.c_str(), -1);
        if (!bio) return false;
        EVP_PKEY* pkey = PEM_read_bio_PUBKEY(bio, nullptr, nullptr, nullptr);
        BIO_free(bio);
        if (!pkey) return false;
        publicKey_.reset(pkey);
        return true;
    }

    std::string getPublicKeyPEM() const {
        if (!privateKey_ && !publicKey_) return "";
        EVP_PKEY* key = publicKey_ ? publicKey_.get() : privateKey_.get();
        BIO* bio = BIO_new(BIO_s_mem());
        PEM_write_bio_PUBKEY(bio, key);
        char* data;
        long len = BIO_get_mem_data(bio, &data);
        std::string result(data, len);
        BIO_free(bio);
        return result;
    }

    std::string getPrivateKeyPEM() const {
        if (!privateKey_) return "";
        BIO* bio = BIO_new(BIO_s_mem());
        PEM_write_bio_PrivateKey(bio, privateKey_.get(), nullptr, nullptr, 0, nullptr, nullptr);
        char* data;
        long len = BIO_get_mem_data(bio, &data);
        std::string result(data, len);
        BIO_free(bio);
        return result;
    }

    bool saveKeys(const std::string& privateKeyPath, const std::string& publicKeyPath) {
        std::ofstream privFile(privateKeyPath);
        std::ofstream pubFile(publicKeyPath);
        if (!privFile || !pubFile) return false;
        privFile << getPrivateKeyPEM();
        pubFile << getPublicKeyPEM();
        return true;
    }

    bool loadKeys(const std::string& privateKeyPath, const std::string& publicKeyPath) {
        std::ifstream privFile(privateKeyPath);
        std::ifstream pubFile(publicKeyPath);
        if (!privFile || !pubFile) return false;
        std::stringstream privBuf, pubBuf;
        privBuf << privFile.rdbuf();
        pubBuf << pubFile.rdbuf();
        return loadPrivateKey(privBuf.str()) && loadPublicKey(pubBuf.str());
    }

    std::string sign(const std::string& data) const {
        if (!privateKey_) { LOG_ERROR("Crypto", "sign: No private key available"); return ""; }

        EVP_MD_CTX* ctx = EVP_MD_CTX_new();
        if (!ctx) return "";

        if (EVP_DigestSignInit(ctx, nullptr, EVP_sha256(), nullptr, privateKey_.get()) <= 0) {
            EVP_MD_CTX_free(ctx); return "";
        }
        if (EVP_DigestSignUpdate(ctx, data.c_str(), data.size()) <= 0) {
            EVP_MD_CTX_free(ctx); return "";
        }

        size_t sigLen = 0;
        if (EVP_DigestSignFinal(ctx, nullptr, &sigLen) <= 0) { EVP_MD_CTX_free(ctx); return ""; }

        std::vector<uint8_t> sig(sigLen);
        if (EVP_DigestSignFinal(ctx, sig.data(), &sigLen) <= 0) { EVP_MD_CTX_free(ctx); return ""; }

        EVP_MD_CTX_free(ctx);
        sig.resize(sigLen);
        return base64Encode(sig);
    }

    bool verify(const std::string& data, const std::string& signatureB64,
                const std::string& publicKeyPEM) const {
        BIO* bio = BIO_new_mem_buf(publicKeyPEM.c_str(), -1);
        if (!bio) return false;
        EVP_PKEY* pkey = PEM_read_bio_PUBKEY(bio, nullptr, nullptr, nullptr);
        BIO_free(bio);
        if (!pkey) return false;

        EVP_MD_CTX* ctx = EVP_MD_CTX_new();
        if (!ctx) { EVP_PKEY_free(pkey); return false; }

        std::vector<uint8_t> sig = base64Decode(signatureB64);
        bool result = false;
        if (EVP_DigestVerifyInit(ctx, nullptr, EVP_sha256(), nullptr, pkey) > 0) {
            if (EVP_DigestVerifyUpdate(ctx, data.c_str(), data.size()) > 0) {
                result = EVP_DigestVerifyFinal(ctx, sig.data(), sig.size()) == 1;
            }
        }
        EVP_MD_CTX_free(ctx);
        EVP_PKEY_free(pkey);
        return result;
    }

    std::string rsaEncrypt(const std::string& data, const std::string& publicKeyPEM) const {
        BIO* bio = BIO_new_mem_buf(publicKeyPEM.c_str(), -1);
        if (!bio) return "";
        EVP_PKEY* pkey = PEM_read_bio_PUBKEY(bio, nullptr, nullptr, nullptr);
        BIO_free(bio);
        if (!pkey) return "";

        EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new(pkey, nullptr);
        if (!ctx) { EVP_PKEY_free(pkey); return ""; }

        std::string result;
        if (EVP_PKEY_encrypt_init(ctx) > 0 &&
            EVP_PKEY_CTX_set_rsa_padding(ctx, RSA_PKCS1_OAEP_PADDING) > 0 &&
            EVP_PKEY_CTX_set_rsa_oaep_md(ctx, EVP_sha256()) > 0 &&
            EVP_PKEY_CTX_set_rsa_mgf1_md(ctx, EVP_sha256()) > 0) {
            size_t outLen = 0;
            if (EVP_PKEY_encrypt(ctx, nullptr, &outLen,
                                 reinterpret_cast<const uint8_t*>(data.c_str()),
                                 data.size()) > 0) {
                std::vector<uint8_t> out(outLen);
                if (EVP_PKEY_encrypt(ctx, out.data(), &outLen,
                                     reinterpret_cast<const uint8_t*>(data.c_str()),
                                     data.size()) > 0) {
                    out.resize(outLen);
                    result = base64Encode(out);
                }
            }
        }
        EVP_PKEY_CTX_free(ctx);
        EVP_PKEY_free(pkey);
        return result;
    }

    std::string rsaDecrypt(const std::string& encryptedB64) const {
        if (!privateKey_) return "";
        std::vector<uint8_t> encrypted = base64Decode(encryptedB64);

        EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new(privateKey_.get(), nullptr);
        if (!ctx) return "";

        std::string result;
        if (EVP_PKEY_decrypt_init(ctx) > 0 &&
            EVP_PKEY_CTX_set_rsa_padding(ctx, RSA_PKCS1_OAEP_PADDING) > 0 &&
            EVP_PKEY_CTX_set_rsa_oaep_md(ctx, EVP_sha256()) > 0 &&
            EVP_PKEY_CTX_set_rsa_mgf1_md(ctx, EVP_sha256()) > 0) {
            size_t outLen = 0;
            if (EVP_PKEY_decrypt(ctx, nullptr, &outLen,
                                 encrypted.data(), encrypted.size()) > 0) {
                std::vector<uint8_t> out(outLen);
                if (EVP_PKEY_decrypt(ctx, out.data(), &outLen,
                                     encrypted.data(), encrypted.size()) > 0) {
                    result = std::string(reinterpret_cast<char*>(out.data()), outLen);
                }
            }
        }
        EVP_PKEY_CTX_free(ctx);
        return result;
    }

    static std::vector<uint8_t> generateAESKey() {
        std::vector<uint8_t> key(32);
        RAND_bytes(key.data(), static_cast<int>(key.size()));
        return key;
    }

    static std::string aesEncrypt(const std::string& plaintext, const std::vector<uint8_t>& key) {
        std::vector<uint8_t> iv(12);
        RAND_bytes(iv.data(), static_cast<int>(iv.size()));

        EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
        if (!ctx) return "";

        std::vector<uint8_t> ciphertext(plaintext.size() + 16);
        std::vector<uint8_t> tag(16);
        int len = 0, cipherLen = 0;

        if (EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1 ||
            EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, 12, nullptr) != 1 ||
            EVP_EncryptInit_ex(ctx, nullptr, nullptr, key.data(), iv.data()) != 1) {
            EVP_CIPHER_CTX_free(ctx); return "";
        }

        if (EVP_EncryptUpdate(ctx, ciphertext.data(), &len,
                              reinterpret_cast<const uint8_t*>(plaintext.c_str()),
                              static_cast<int>(plaintext.size())) != 1) {
            EVP_CIPHER_CTX_free(ctx); return "";
        }
        cipherLen = len;

        if (EVP_EncryptFinal_ex(ctx, ciphertext.data() + len, &len) != 1) {
            EVP_CIPHER_CTX_free(ctx); return "";
        }
        cipherLen += len;

        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, 16, tag.data()) != 1) {
            EVP_CIPHER_CTX_free(ctx); return "";
        }
        EVP_CIPHER_CTX_free(ctx);

        std::vector<uint8_t> result;
        result.insert(result.end(), iv.begin(), iv.end());
        result.insert(result.end(), ciphertext.begin(), ciphertext.begin() + cipherLen);
        result.insert(result.end(), tag.begin(), tag.end());
        return base64Encode(result);
    }

    static std::optional<std::string> aesDecrypt(const std::string& ciphertextB64,
                                                  const std::vector<uint8_t>& key) {
        std::vector<uint8_t> data = base64Decode(ciphertextB64);
        if (data.size() < 12 + 16) return std::nullopt;

        std::vector<uint8_t> iv(data.begin(), data.begin() + 12);
        std::vector<uint8_t> tag(data.end() - 16, data.end());
        std::vector<uint8_t> ciphertext(data.begin() + 12, data.end() - 16);

        EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
        if (!ctx) return std::nullopt;

        std::vector<uint8_t> plaintext(ciphertext.size());
        int len = 0, plainLen = 0;

        if (EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1 ||
            EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, 12, nullptr) != 1 ||
            EVP_DecryptInit_ex(ctx, nullptr, nullptr, key.data(), iv.data()) != 1 ||
            EVP_DecryptUpdate(ctx, plaintext.data(), &len, ciphertext.data(),
                              static_cast<int>(ciphertext.size())) != 1) {
            EVP_CIPHER_CTX_free(ctx); return std::nullopt;
        }
        plainLen = len;

        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16, tag.data()) != 1 ||
            EVP_DecryptFinal_ex(ctx, plaintext.data() + len, &len) != 1) {
            EVP_CIPHER_CTX_free(ctx); return std::nullopt;
        }
        plainLen += len;
        EVP_CIPHER_CTX_free(ctx);

        return std::string(reinterpret_cast<char*>(plaintext.data()), plainLen);
    }

    static std::string base64Encode(const std::vector<uint8_t>& data) {
        BIO* b64 = BIO_new(BIO_f_base64());
        BIO* mem = BIO_new(BIO_s_mem());
        BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
        BIO_push(b64, mem);
        BIO_write(b64, data.data(), static_cast<int>(data.size()));
        BIO_flush(b64);
        char* outData;
        long outLen = BIO_get_mem_data(mem, &outData);
        std::string result(outData, outLen);
        BIO_free_all(b64);
        return result;
    }

    static std::string base64Encode(const std::string& data) {
        return base64Encode(std::vector<uint8_t>(data.begin(), data.end()));
    }

    static std::vector<uint8_t> base64Decode(const std::string& encoded) {
        BIO* b64 = BIO_new(BIO_f_base64());
        BIO* mem = BIO_new_mem_buf(encoded.c_str(), static_cast<int>(encoded.size()));
        BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
        BIO_push(b64, mem);
        std::vector<uint8_t> result(encoded.size());
        int len = BIO_read(b64, result.data(), static_cast<int>(result.size()));
        BIO_free_all(b64);
        if (len > 0) result.resize(len);
        else result.clear();
        return result;
    }

private:
    EVP_PKEY_ptr privateKey_;
    EVP_PKEY_ptr publicKey_;
};

} // namespace silentchat
