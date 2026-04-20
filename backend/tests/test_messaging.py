from fastapi.testclient import TestClient
import pytest
from tests.test_auth import generate_rsa_keys, sign_message, serialize_public_key, unique_alias
import base64

@pytest.fixture(scope="function")
def registered_alice(client: TestClient):
    private_key, public_key = generate_rsa_keys()
    alias = unique_alias("alice")
    # Full registration for Alice
    resp = client.post("/auth/register-challenge", json={"alias": alias})
    nonce = resp.json()['nonce'].encode('utf-8')
    sig = sign_message(private_key, nonce)
    client.post("/auth/register-complete", json={
        "alias": alias,
        "nonce": nonce.decode('utf-8'),
        "publicKey": serialize_public_key(public_key),
        "signedNonce": base64.b64encode(sig).decode('utf-8')
    })
    return {"private_key": private_key, "public_key": public_key, "alias": alias}

@pytest.fixture(scope="function")
def registered_bob(client: TestClient):
    private_key, public_key = generate_rsa_keys()
    alias = unique_alias("bob")
    # Full registration for Bob
    resp = client.post("/auth/register-challenge", json={"alias": alias})
    nonce = resp.json()['nonce'].encode('utf-8')
    sig = sign_message(private_key, nonce)
    client.post("/auth/register-complete", json={
        "alias": alias,
        "nonce": nonce.decode('utf-8'),
        "publicKey": serialize_public_key(public_key),
        "signedNonce": base64.b64encode(sig).decode('utf-8')
    })
    return {"private_key": private_key, "public_key": public_key, "alias": alias}


def get_jwt_for_user(client: TestClient, user_details):
    # Get login challenge
    resp = client.post("/auth/login-challenge", json={"alias": user_details["alias"]})
    nonce = resp.json()["nonce"].encode('utf-8')
    # Sign challenge
    sig = sign_message(user_details["private_key"], nonce)
    # Complete login
    resp = client.post("/auth/login-complete", json={
        "alias": user_details["alias"],
        "nonce": nonce.decode('utf-8'),
        "signedChallenge": base64.b64encode(sig).decode('utf-8')
    })
    return resp.json()["token"]

def test_get_public_key_unauthenticated(client: TestClient):
    response = client.get("/keys/some_user")
    assert response.status_code == 401 # Should be Unauthorized without a token

def test_get_public_key_authenticated(client: TestClient, registered_alice, registered_bob):
    """
    Tests that Alice (authenticated) can retrieve Bob's public key.
    """
    alice_token = get_jwt_for_user(client, registered_alice)
    headers = {"Authorization": f"Bearer {alice_token}"}
    
    response = client.get(f"/keys/{registered_bob['alias']}", headers=headers)
    
    assert response.status_code == 200
    response_data = response.json()
    assert response_data["alias"] == registered_bob["alias"]
    assert response_data["publicKey"] == serialize_public_key(registered_bob["public_key"])

def test_send_message_unauthenticated(client: TestClient):
    response = client.post("/messages", json={})
    assert response.status_code == 401

def test_send_key_exchange_message(client: TestClient, registered_alice, registered_bob):
    """
    Tests sending a symmetric key to another user.
    """
    alice_token = get_jwt_for_user(client, registered_alice)
    headers = {"Authorization": f"Bearer {alice_token}"}

    payload = {
        "recipientAlias": registered_bob['alias'],
        "type": "KEY_EXCHANGE",
        "encryptedMessage": "BASE64_ENCODED_RSA_ENCRYPTED_AES_KEY",
        "signature": "BASE64_SIGNATURE_OF_THE_ABOVE"
    }
    response = client.post("/messages", json=payload, headers=headers)
    assert response.status_code == 202

def test_get_messages_unauthenticated(client: TestClient):
    response = client.get("/messages")
    assert response.status_code == 401

def test_get_messages_authenticated(client: TestClient, registered_bob):
    """
    Tests retrieving messages for Bob.
    """
    bob_token = get_jwt_for_user(client, registered_bob)
    headers = {"Authorization": f"Bearer {bob_token}"}
    response = client.get("/messages?timeout_seconds=0", headers=headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_user_cannot_get_others_messages(client: TestClient, registered_alice, registered_bob):
    """
    Tests that a user can only retrieve messages addressed to them.
    """
    # 1. Alice sends a message to Bob
    alice_token = get_jwt_for_user(client, registered_alice)
    payload = {
        "recipientAlias": registered_bob['alias'],
        "type": "TEXT",
        "encryptedMessage": "...",
        "signature": "..."
    }
    response = client.post("/messages", json=payload, headers={"Authorization": f"Bearer {alice_token}"})
    assert response.status_code == 202

    # 2. Bob logs in and should see one message
    bob_token = get_jwt_for_user(client, registered_bob)
    response = client.get("/messages", headers={"Authorization": f"Bearer {bob_token}"})
    assert response.status_code == 200
    bob_messages = response.json()
    assert len(bob_messages) == 1
    assert bob_messages[0]['senderAlias'] == registered_alice['alias']

    # 3. Alice logs in again and should see zero messages
    alice_token_again = get_jwt_for_user(client, registered_alice)
    response = client.get("/messages?timeout_seconds=0", headers={"Authorization": f"Bearer {alice_token_again}"})
    assert response.status_code == 200
    alice_messages = response.json()
    assert len(alice_messages) == 0

def test_get_messages_since_filter(client: TestClient, registered_alice, registered_bob):
    """
    Tests that the 'since' parameter correctly filters messages by ID.
    """
    # 1. Alice sends a first message to Bob
    alice_token = get_jwt_for_user(client, registered_alice)
    client.post("/messages", json={
        "recipientAlias": registered_bob['alias'], "type": "TEXT",
        "encryptedMessage": "message1", "signature": "..."
    }, headers={"Authorization": f"Bearer {alice_token}"})

    # 2. Bob fetches all messages to get the first message's ID
    bob_token = get_jwt_for_user(client, registered_bob)
    response = client.get("/messages", headers={"Authorization": f"Bearer {bob_token}"})
    assert response.status_code == 200
    messages = response.json()
    assert len(messages) >= 1
    first_message_id = messages[-1]["id"]

    # 3. Alice sends a second message
    client.post("/messages", json={
        "recipientAlias": registered_bob['alias'], "type": "TEXT",
        "encryptedMessage": "message2", "signature": "..."
    }, headers={"Authorization": f"Bearer {alice_token}"})

    # 4. Bob fetches messages 'since' the first message ID
    response = client.get(f"/messages?since={first_message_id}", headers={"Authorization": f"Bearer {bob_token}"})
    
    # 5. Bob should only see the second message
    assert response.status_code == 200
    messages = response.json()
    assert len(messages) == 1
    assert messages[0]["encryptedMessage"] == "message2"


def test_send_file_message(client: TestClient, registered_alice, registered_bob):
    """
    Tests sending a FILE type message.
    """
    alice_token = get_jwt_for_user(client, registered_alice)
    headers = {"Authorization": f"Bearer {alice_token}"}

    payload = {
        "recipientAlias": registered_bob['alias'],
        "type": "FILE",
        "encryptedMessage": "BASE64_ENCRYPTED_FILE_CONTENT",
        "signature": "BASE64_SIGNATURE"
    }
    response = client.post("/messages", json=payload, headers=headers)
    assert response.status_code == 202


def test_retrieve_file_as_recipient(client: TestClient, registered_alice, registered_bob):
    """
    Tests that the recipient can retrieve file content.
    """
    alice_token = get_jwt_for_user(client, registered_alice)
    
    # Alice sends a file to Bob
    payload = {
        "recipientAlias": registered_bob['alias'],
        "type": "FILE",
        "encryptedMessage": "ENCRYPTED_IMAGE_DATA_HERE",
        "signature": "SIG"
    }
    client.post("/messages", json=payload, headers={"Authorization": f"Bearer {alice_token}"})
    
    # Bob fetches messages
    bob_token = get_jwt_for_user(client, registered_bob)
    response = client.get("/messages", headers={"Authorization": f"Bearer {bob_token}"})
    messages = response.json()
    
    # Find the FILE message
    import json
    file_message = [m for m in messages if m["type"] == "FILE"][0]
    file_ref = json.loads(file_message["encryptedMessage"])
    file_id = file_ref["fileId"]
    
    # Bob retrieves the file
    response = client.get(f"/files/{file_id}", headers={"Authorization": f"Bearer {bob_token}"})
    assert response.status_code == 200
    assert response.json()["encryptedContent"] == "ENCRYPTED_IMAGE_DATA_HERE"


def test_retrieve_file_as_sender(client: TestClient, registered_alice, registered_bob):
    """
    Tests that the sender can also retrieve the file they sent.
    """
    alice_token = get_jwt_for_user(client, registered_alice)
    
    # Alice sends a file to Bob
    payload = {
        "recipientAlias": registered_bob['alias'],
        "type": "FILE",
        "encryptedMessage": "SENDER_CAN_ACCESS_THIS",
        "signature": "SIG"
    }
    client.post("/messages", json=payload, headers={"Authorization": f"Bearer {alice_token}"})
    
    # Bob fetches messages to get the file ID
    bob_token = get_jwt_for_user(client, registered_bob)
    response = client.get("/messages", headers={"Authorization": f"Bearer {bob_token}"})
    messages = response.json()
    
    import json
    file_message = [m for m in messages if m["type"] == "FILE"][0]
    file_ref = json.loads(file_message["encryptedMessage"])
    file_id = file_ref["fileId"]
    
    # Alice (sender) can also retrieve the file
    response = client.get(f"/files/{file_id}", headers={"Authorization": f"Bearer {alice_token}"})
    assert response.status_code == 200


def test_retrieve_file_unauthorized(client: TestClient, registered_alice, registered_bob):
    """
    Tests that a third party cannot access files they're not part of.
    """
    # Register a third user (Charlie)
    from tests.test_auth import generate_rsa_keys, sign_message, serialize_public_key, unique_alias
    private_key, public_key = generate_rsa_keys()
    charlie_alias = unique_alias("charlie")
    resp = client.post("/auth/register-challenge", json={"alias": charlie_alias})
    nonce = resp.json()['nonce'].encode('utf-8')
    sig = sign_message(private_key, nonce)
    client.post("/auth/register-complete", json={
        "alias": charlie_alias,
        "nonce": nonce.decode('utf-8'),
        "publicKey": serialize_public_key(public_key),
        "signedNonce": base64.b64encode(sig).decode('utf-8')
    })

    charlie_details = {"private_key": private_key, "public_key": public_key, "alias": charlie_alias}
    
    alice_token = get_jwt_for_user(client, registered_alice)
    
    # Alice sends a file to Bob
    payload = {
        "recipientAlias": registered_bob['alias'],
        "type": "FILE",
        "encryptedMessage": "SECRET_FILE_CONTENT",
        "signature": "SIG"
    }
    client.post("/messages", json=payload, headers={"Authorization": f"Bearer {alice_token}"})
    
    # Bob fetches messages to get the file ID
    bob_token = get_jwt_for_user(client, registered_bob)
    response = client.get("/messages", headers={"Authorization": f"Bearer {bob_token}"})
    messages = response.json()
    
    import json
    file_message = [m for m in messages if m["type"] == "FILE"][0]
    file_ref = json.loads(file_message["encryptedMessage"])
    file_id = file_ref["fileId"]
    
    # Charlie tries to access the file - should be denied
    charlie_token = get_jwt_for_user(client, charlie_details)
    response = client.get(f"/files/{file_id}", headers={"Authorization": f"Bearer {charlie_token}"})
    assert response.status_code == 403
