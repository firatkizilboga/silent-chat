// Quick test script to verify key generation works
async function testKeyGeneration() {
    console.log("Testing key generation...");

    // Generate keys
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

    console.log("✓ Keys generated successfully");
    console.log("Structure:", {
        encryptPrivateKey: keyPair.privateKey,
        encryptPublicKey: keyPair.publicKey,
        signPrivateKey,
        signPublicKey,
        privateKeyPkcs8,
        publicKeySpki
    });

    // Test signing
    const testData = "test message";
    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        signPrivateKey,
        new TextEncoder().encode(testData)
    );
    console.log("✓ Signing works");

    // Test verification
    const verified = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        signPublicKey,
        signature,
        new TextEncoder().encode(testData)
    );
    console.log("✓ Verification works:", verified);

    // Test encryption/decryption
    const aesKey = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        keyPair.publicKey,
        aesKey
    );
    console.log("✓ Encryption works");

    const decrypted = await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        keyPair.privateKey,
        encrypted
    );
    console.log("✓ Decryption works");

    console.log("All tests passed!");
}

testKeyGeneration().catch(console.error);
