from fastapi.testclient import TestClient
import pytest
from tests.test_auth import generate_rsa_keys, sign_message, serialize_public_key, unique_alias
import base64

# --- Reused Fixtures/Helpers ---

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


# --- WebSocket Tests ---

def test_websocket_connection_unauthorized(client: TestClient):
    """Test that connecting without a valid token fails."""
    # TestClient.websocket_connect raises exception on close or uses context manager
    # We expect a 403 or immediate close code 1008
    with pytest.raises(Exception): # Starlette test client might raise an error for 1008
        with client.websocket_connect("/ws?token=INVALID_TOKEN"):
            pass

def test_websocket_connection_success(client: TestClient, registered_alice):
    """Test that a valid user can connect."""
    token = get_jwt_for_user(client, registered_alice)
    with client.websocket_connect(f"/ws?token={token}") as websocket:
        # Just connecting is success enough for this test now
        pass

def test_receive_message_via_websocket(client: TestClient, registered_alice, registered_bob):
    """
    Test that Bob receives a message instantly via WebSocket when Alice sends it.
    """
    # 1. Login both
    alice_token = get_jwt_for_user(client, registered_alice)
    bob_token = get_jwt_for_user(client, registered_bob)

    # 2. Bob connects to WebSocket
    with client.websocket_connect(f"/ws?token={bob_token}") as websocket_bob:
        
        # 3. Alice sends a message via REST API
        message_payload = {
            "recipientAlias": registered_bob['alias'],
            "type": "TEXT",
            "encryptedMessage": "HELLO_SOCKET",
            "signature": "SIG"
        }
        resp = client.post(
            "/messages", 
            json=message_payload, 
            headers={"Authorization": f"Bearer {alice_token}"}
        )
        assert resp.status_code == 202

        # 4. Bob should receive it via WebSocket
        data = websocket_bob.receive_json()
        
        assert data["senderAlias"] == registered_alice["alias"]
        assert data["encryptedMessage"] == "HELLO_SOCKET"
        assert "serverTimestamp" in data
        assert "id" in data

def test_websocket_deduplication(client: TestClient, registered_alice, registered_bob):
    """
    Test that the message received via WebSocket has the same ID as stored in DB.
    """
    alice_token = get_jwt_for_user(client, registered_alice)
    bob_token = get_jwt_for_user(client, registered_bob)

    with client.websocket_connect(f"/ws?token={bob_token}") as websocket_bob:
        # Alice sends message
        client.post(
            "/messages", 
            json={
                "recipientAlias": registered_bob['alias'],
                "type": "TEXT",
                "encryptedMessage": "DEDUP_TEST",
                "signature": "SIG"
            }, 
            headers={"Authorization": f"Bearer {alice_token}"}
        )
        
        # Bob gets WebSocket push
        ws_msg = websocket_bob.receive_json()
        ws_id = ws_msg["id"]
        
        # Bob also fetches via REST (polling simulation)
        resp = client.get("/messages", headers={"Authorization": f"Bearer {bob_token}"})
        rest_msgs = resp.json()
        
        # Find the message in REST response
        matching_msg = next((m for m in rest_msgs if m["id"] == ws_id), None)
        assert matching_msg is not None
        assert matching_msg["encryptedMessage"] == "DEDUP_TEST"
