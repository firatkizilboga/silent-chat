/**
 * SilentChat - Crypto Operations
 * Web Crypto API functions for RSA and AES encryption
 */

import { arrayBufferToBase64, base64ToArrayBuffer, arrayBufferToPem, pemToArrayBuffer } from './utils.js';

// ========================================
// RSA Key Generation
// ========================================
export async function generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256"
        },
        true,
        ["encrypt", "decrypt"]
    );

    const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicKeySpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);

    const signPrivateKey = await crypto.subtle.importKey(
        "pkcs8",
        privateKeyPkcs8,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true,
        ["sign"]
    );
    const signPublicKey = await crypto.subtle.importKey(
        "spki",
        publicKeySpki,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true,
        ["verify"]
    );

    return {
        encryptPrivateKey: keyPair.privateKey,
        encryptPublicKey: keyPair.publicKey,
        signPrivateKey,
        signPublicKey,
        privateKeyPkcs8,
        publicKeySpki
    };
}

// ========================================
// Key Export/Import
// ========================================
export async function exportPublicKeyPem(publicKeySpki) {
    let spki = publicKeySpki;
    if (publicKeySpki instanceof CryptoKey) {
        spki = await crypto.subtle.exportKey("spki", publicKeySpki);
    }
    return arrayBufferToPem(spki, "PUBLIC KEY");
}

export async function importPeerPublicKey(pemString, forEncryption = false) {
    const spki = pemToArrayBuffer(pemString);
    const algorithm = forEncryption
        ? { name: "RSA-OAEP", hash: "SHA-256" }
        : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const usages = forEncryption ? ["encrypt"] : ["verify"];

    return await crypto.subtle.importKey("spki", spki, algorithm, true, usages);
}

// ========================================
// RSA Signing/Verification
// ========================================
export async function signData(privateKey, data) {
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        encoder.encode(data)
    );
    return arrayBufferToBase64(signature);
}

export async function verifySignature(publicKey, data, signatureB64) {
    try {
        const encoder = new TextEncoder();
        const signature = base64ToArrayBuffer(signatureB64);
        return await crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            publicKey,
            signature,
            encoder.encode(data)
        );
    } catch {
        return false;
    }
}

// ========================================
// RSA Encryption (for AES key exchange)
// ========================================
export async function encryptAesKey(publicKey, aesKeyBytes) {
    const encrypted = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        publicKey,
        aesKeyBytes
    );
    return arrayBufferToBase64(encrypted);
}

export async function decryptAesKey(privateKey, encryptedB64) {
    const encrypted = base64ToArrayBuffer(encryptedB64);
    const decrypted = await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        privateKey,
        encrypted
    );
    return new Uint8Array(decrypted);
}

// ========================================
// AES-GCM Encryption
// ========================================
export async function generateAesKey() {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return key;
}

export async function encryptMessage(aesKeyBytes, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();

    const aesKey = await crypto.subtle.importKey(
        "raw",
        aesKeyBytes,
        { name: "AES-GCM" },
        false,
        ["encrypt"]
    );

    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        encoder.encode(plaintext)
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), 12);

    return arrayBufferToBase64(combined);
}

export async function decryptMessage(aesKeyBytes, encryptedB64) {
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedB64));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const aesKey = await crypto.subtle.importKey(
        "raw",
        aesKeyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        aesKey,
        ciphertext
    );

    return new TextDecoder().decode(decrypted);
}
