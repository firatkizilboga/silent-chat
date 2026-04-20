import pytest
from fastapi.testclient import TestClient
import json
import asyncio
from tests.test_websockets import get_jwt_for_user, registered_alice, registered_bob
from tests.test_auth import unique_alias, generate_rsa_keys, serialize_public_key, sign_message
import base64

@pytest.fixture(scope="function")
def registered_user_factory(client: TestClient):
    def _create(name_prefix):
        private_key, public_key = generate_rsa_keys()
        alias = unique_alias(name_prefix)
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
    return _create

def test_subscribe_immediate_status(client: TestClient, registered_alice, registered_bob):
    """Test that subscribing returns the current status immediately."""
    alice_token = get_jwt_for_user(client, registered_alice)
    bob_token = get_jwt_for_user(client, registered_bob)

    # Bob connects first
    with client.websocket_connect(f"/ws?token={bob_token}") as ws_bob:
        # Alice connects and subscribes to Bob
        with client.websocket_connect(f"/ws?token={alice_token}") as ws_alice:
            ws_alice.send_json({
                "cmd": "subscribe-to-online-status",
                "arguments": {"target_user": registered_bob["alias"]}
            })
            
            # 1. Immediate status update (sent via manager.dispatch_online_status during handler)
            status_msg = ws_alice.receive_json()
            assert status_msg["type"] == "online_status"
            assert status_msg["user"] == registered_bob["alias"]
            assert status_msg["status"] == "ONLINE"

            # 2. Ack from the command (the return value of the handler)
            resp = ws_alice.receive_json()
            assert resp["cmd"] == "subscribe-to-online-status"
            assert resp["payload"]["status"] == "subscribed"

def test_presence_transition(client: TestClient, registered_alice, registered_bob):
    """Test that Alice gets a notification when Bob connects/disconnects."""
    alice_token = get_jwt_for_user(client, registered_alice)
    bob_token = get_jwt_for_user(client, registered_bob)

    with client.websocket_connect(f"/ws?token={alice_token}") as ws_alice:
        # Alice subscribes to Bob (who is currently offline)
        ws_alice.send_json({
            "cmd": "subscribe-to-online-status",
            "arguments": {"target_user": registered_bob["alias"]}
        })
        
        # Initial status update
        status_msg = ws_alice.receive_json()
        assert status_msg["status"] == "OFFLINE"

        # Ack
        ws_alice.receive_json()

        # Bob connects
        with client.websocket_connect(f"/ws?token={bob_token}") as ws_bob:
            status_msg = ws_alice.receive_json()
            assert status_msg["status"] == "ONLINE"
        
        # Bob disconnects (exit context manager)
        status_msg = ws_alice.receive_json()
        assert status_msg["status"] == "OFFLINE"

def test_subscription_limit(client: TestClient, registered_user_factory):
    """Test that a user cannot subscribe to more than 3 users."""
    alice = registered_user_factory("alice")
    targets = [registered_user_factory(f"target_{i}") for i in range(4)]
    
    alice_token = get_jwt_for_user(client, alice)
    
    with client.websocket_connect(f"/ws?token={alice_token}") as ws_alice:
        for i in range(4):
            ws_alice.send_json({
                "cmd": "subscribe-to-online-status",
                "arguments": {"target_user": targets[i]["alias"]}
            })
            
            if i < 3:
                # Expect status update THEN ack
                ws_alice.receive_json() # status
                resp = ws_alice.receive_json() # ack
                assert resp["payload"]["status"] == "subscribed"
            else:
                # 4th one should fail (no status update sent on failure)
                resp = ws_alice.receive_json()
                assert resp["payload"]["status"] == "limit_reached"

def test_unsubscribe(client: TestClient, registered_alice, registered_bob):
    """Test that unsubscribing stops notifications."""
    alice_token = get_jwt_for_user(client, registered_alice)
    bob_token = get_jwt_for_user(client, registered_bob)

    with client.websocket_connect(f"/ws?token={alice_token}") as ws_alice:
        # Subscribe
        ws_alice.send_json({
            "cmd": "subscribe-to-online-status",
            "arguments": {"target_user": registered_bob["alias"]}
        })
        ws_alice.receive_json() # status
        ws_alice.receive_json() # ack

        # Unsubscribe
        ws_alice.send_json({
            "cmd": "unsubscribe-from-online-status",
            "arguments": {"target_user": registered_bob["alias"]}
        })
        ws_alice.receive_json() # Ack

        # Bob connects - Alice should NOT receive anything
        with client.websocket_connect(f"/ws?token={bob_token}") as ws_bob:
            with pytest.raises(Exception):
                ws_alice.receive_json(timeout=1)
