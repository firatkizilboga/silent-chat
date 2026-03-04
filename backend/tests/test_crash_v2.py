from tests.test_auth import generate_rsa_keys, sign_message, serialize_public_key, unique_alias
import base64

# Helper to get a token via proper API flow
def get_authenticated_user(client, alias_prefix):
    private_key, public_key = generate_rsa_keys()
    alias = unique_alias(alias_prefix)
    
    # Register
    resp = client.post("/auth/register-challenge", json={"alias": alias})
    if resp.status_code != 200:
        raise RuntimeError(f"Registration challenge failed: {resp.text}")
    nonce = resp.json()['nonce'].encode('utf-8')
    sig = sign_message(private_key, nonce)
    
    resp = client.post("/auth/register-complete", json={
        "alias": alias,
        "publicKey": serialize_public_key(public_key),
        "signedNonce": base64.b64encode(sig).decode('utf-8')
    })
    if resp.status_code != 201:
        raise RuntimeError(f"Registration complete failed: {resp.text}")
    
    # Login
    resp = client.post("/auth/login-challenge", json={"alias": alias})
    if resp.status_code != 200:
         raise RuntimeError(f"Login challenge failed: {resp.text}")
    nonce = resp.json()["nonce"].encode('utf-8')
    sig = sign_message(private_key, nonce)
    
    resp = client.post("/auth/login-complete", json={
        "alias": alias,
        "signedChallenge": base64.b64encode(sig).decode('utf-8')
    })
    if resp.status_code != 200:
         raise RuntimeError(f"Login complete failed: {resp.text}")
         
    token = resp.json()["token"]
    
    return {"alias": alias, "token": token}


def test_large_message_crash(client):
    """
    Attempts to send a very large message to reproduce backend crash.
    """
    # 1. Register Alice and get token
    alice = get_authenticated_user(client, "alice_crash")
    
    # 2. Register Bob (recipient)
    bob = get_authenticated_user(client, "bob_crash")
    
    headers = {"Authorization": f"Bearer {alice['token']}"}
    
    # 3. Create a MASSIVE payload (10MB)
    large_payload = "A" * (10 * 1024 * 1024) 
    
    # 4. Send message
    response = client.post("/messages", json={
        "recipientAlias": bob['alias'],
        "type": "TEXT",
        "encryptedMessage": large_payload,
        "signature": "fake_sig",
    }, headers=headers)
    
    assert response.status_code == 202