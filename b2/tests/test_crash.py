import pytest
import os
from app.db import db
from b2.tests.conftest import get_auth_headers

def test_large_message_crash(client):
    """
    Attempts to send a very large message to reproduce backend crash.
    """
    # 1. Register users (using helper from conftest or manually if needed)
    # The client fixture in conftest automagically handles DB truncation.
    
    # We need to register two users to send a message.
    # We'll reuse the logic from test_messaging.py but valid for a fresh run.
    
    # Register Alice
    headers_alice = get_auth_headers(client, "alice_crash")
    
    # Register Bob
    headers_bob = get_auth_headers(client, "bob_crash")
    
    # 2. Create a MASSIVE payload
    # 10MB string
    large_payload = "A" * (10 * 1024 * 1024) 
    
    # 3. Send message
    response = client.post("/messages", json={
        "recipientAlias": "bob_crash",
        "type": "TEXT",
        "encryptedMessage": large_payload,
        "signature": "fake_sig",
        "serverTimestamp": "123" # Optional, server sets it usually but model allows it? No, model is MessageCreate.
    }, headers=headers_alice)
    
    # If the server crashes, this might raise an exception or return a 500.
    # In TestingClient, it runs in-process usually, unless we run against live server.
    # The user is crashing the LIVE server (Uvicorn).
    # Running this with TestClient might NOT reproduce it if it's an ASGI/Uvicorn specific issue,
    # BUT it will check Pydantic/SQLite limits.
    
    assert response.status_code == 200
