from fastapi.testclient import TestClient
import pytest
import secrets
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
import base64

# --- Helper Functions ---
def unique_alias(prefix="user"):
    return f"{prefix}_{secrets.token_hex(4)}"


def generate_rsa_keys():
    """Generates a new RSA private and public key pair."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()
    return private_key, public_key

def serialize_public_key(public_key):
    """Serializes a public key to the PEM format."""
    return public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode('utf-8')

def sign_message(private_key, message: bytes):
    """Signs a message with a private key."""
    return private_key.sign(
        message,
        padding.PKCS1v15(),
        hashes.SHA256()
    )

# --- Pytest Fixtures ---

@pytest.fixture(scope="function")
def registered_user(client: TestClient):
    """Fixture to create a new user and register them, returning their keys and alias."""
    private_key, public_key = generate_rsa_keys()
    alias = unique_alias("fixture")
    
    # Get challenge
    response = client.post("/auth/register-challenge", json={"alias": alias})
    assert response.status_code == 200
    nonce = response.json()["nonce"].encode('utf-8')
    
    # Sign challenge
    signature = sign_message(private_key, nonce)
    
    # Complete registration
    response = client.post(
        "/auth/register-complete",
        json={
            "alias": alias,
            "nonce": nonce.decode('utf-8'),
            "publicKey": serialize_public_key(public_key),
            "signedNonce": base64.b64encode(signature).decode('utf-8'),
        }
    )
    assert response.status_code == 201
    
    return {"private_key": private_key, "public_key": public_key, "alias": alias}


# --- Test Functions ---

def test_health_check(client: TestClient):
    """Tests the root endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_register_challenge_endpoint_succeeds(client: TestClient):
    """Tests that the register-challenge endpoint now returns a 200 OK."""
    alias = unique_alias("challenge")
    response = client.post("/auth/register-challenge", json={"alias": alias})
    assert response.status_code == 200
    assert "nonce" in response.json()

def test_full_registration_flow(client: TestClient):
    """Tests the full registration flow from scratch."""
    private_key, public_key = generate_rsa_keys()
    public_key_pem = serialize_public_key(public_key)
    alias = unique_alias("full_flow")

    response = client.post("/auth/register-challenge", json={"alias": alias})
    assert response.status_code == 200
    nonce = response.json()["nonce"].encode('utf-8')

    signature = sign_message(private_key, nonce)

    response = client.post(
        "/auth/register-complete",
        json={
            "alias": alias,
            "nonce": nonce.decode('utf-8'),
            "publicKey": public_key_pem,
            "signedNonce": base64.b64encode(signature).decode('utf-8'),
        }
    )
    assert response.status_code == 201
    assert response.json()["message"] == "User registered successfully"


def test_login_flow(client: TestClient, registered_user):
    """
    Tests the full login flow for an existing user.
    """
    alias = registered_user["alias"]
    private_key = registered_user["private_key"]

    # 1. Get a login challenge
    response = client.post("/auth/login-challenge", json={"alias": alias})
    assert response.status_code == 200
    challenge = response.json()["nonce"].encode('utf-8')

    # 2. Sign the challenge
    signed_challenge = sign_message(private_key, challenge)

    # 3. Complete login to get JWT
    response = client.post(
        "/auth/login-complete",
        json={
            "alias": alias,
            "nonce": challenge.decode('utf-8'),
            "signedChallenge": base64.b64encode(signed_challenge).decode('utf-8')
        }
    )
    assert response.status_code == 200
    assert "token" in response.json()

# --- Security and Failure Tests ---

def test_register_with_bad_signature(client: TestClient):
    """Tests that registration fails if the nonce signature is invalid."""
    private_key, public_key = generate_rsa_keys()
    alias = unique_alias("bad_sig")

    # Get a real challenge
    response = client.post("/auth/register-challenge", json={"alias": alias})
    assert response.status_code == 200
    
    # Send a garbage signature
    bad_signature = base64.b64encode(b"this is not a valid signature").decode('utf-8')

    response = client.post(
        "/auth/register-complete",
        json={
            "alias": alias,
            "nonce": response.json()["nonce"],
            "publicKey": serialize_public_key(public_key),
            "signedNonce": bad_signature,
        }
    )
    assert response.status_code == 401 # Unauthorized

def test_login_with_bad_signature(client: TestClient, registered_user):
    """Tests that login fails if the challenge signature is invalid."""
    alias = registered_user["alias"]

    # Get a real login challenge
    response = client.post("/auth/login-challenge", json={"alias": alias})
    assert response.status_code == 200
    nonce = response.json()["nonce"]

    # Send a garbage signature
    bad_signature = base64.b64encode(b"this is not a valid signature").decode('utf-8')

    response = client.post(
        "/auth/login-complete",
        json={
            "alias": alias,
            "nonce": nonce,
            "signedChallenge": bad_signature
        }
    )
    assert response.status_code == 401 # Unauthorized


    

