import pytest
import jwt
import os
from datetime import datetime, timedelta, timezone

# We mimic the logic without relying on conftest helpers to avoid import issues
SECRET_KEY = os.environ.get("SECRET_KEY", "supersecretkey")
ALGORITHM = os.environ.get("ALGORITHM", "HS256")

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def test_large_message_crash(client):
    """
    Attempts to send a very large message to reproduce backend crash.
    """
    # 1. Manually "Register" by just creating a token for Alice
    # The database state is handled by the client fixture's auto-use setup (truncation).
    # We still need to create the user in the DB so the Foreign Key constraints (if any) or logic works.
    
    # Actually, let's just use the client to "register" properly via API if we can,
    # OR just use the 'db' object directly if we can import it.
    from app.db import db
    
    # Insert Alice
    db.add_user({
        "alias": "alice_crash",
        "publicKey": "fake_pk_alice"
    })
    
    # Insert Bob
    db.add_user({
        "alias": "bob_crash",
        "publicKey": "fake_pk_bob"
    })
    
    # Generate token for Alice
    token = create_access_token({"sub": "alice_crash"})
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Create a MASSIVE payload (10MB)
    large_payload = "A" * (10 * 1024 * 1024) 
    
    # 3. Send message
    response = client.post("/messages", json={
        "recipientAlias": "bob_crash",
        "type": "TEXT",
        "encryptedMessage": large_payload,
        "signature": "fake_sig",
        "serverTimestamp": "123"
    }, headers=headers)
    
    assert response.status_code == 202
