from fastapi import APIRouter, HTTPException, status
from app.models.auth import AliasRequest, ChallengeResponse, RegisterCompleteRequest, LoginCompleteRequest, TokenResponse
from app.services.security import create_access_token
from app.db import db
import secrets
from datetime import datetime, timedelta, UTC
import base64
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.exceptions import InvalidSignature

router = APIRouter()

# WARNING: In-memory storage is for development only.
challenge_storage = {}

@router.post("/register-challenge", response_model=ChallengeResponse)
def register_challenge(request: AliasRequest):
    if db.get_user(request.alias):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Alias already taken")
    
    nonce = secrets.token_urlsafe(32)
    challenge_storage[request.alias] = {
        "nonce": nonce,
        "timestamp": datetime.now(UTC)
    }
    return ChallengeResponse(nonce=nonce)

@router.post("/register-complete", status_code=status.HTTP_201_CREATED)
def register_complete(request: RegisterCompleteRequest):
    alias = request.alias
    challenge_info = challenge_storage.get(alias)

    if not challenge_info:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Challenge not found or expired")
    if datetime.now(UTC) - challenge_info["timestamp"] > timedelta(minutes=5):
        raise HTTPException(status_code=status.HTTP_408_REQUEST_TIMEOUT, detail="Challenge expired")

    try:
        public_key = serialization.load_pem_public_key(request.publicKey.encode('utf-8'))
        signature = base64.b64decode(request.signedNonce)
        nonce_bytes = challenge_info["nonce"].encode('utf-8')
        public_key.verify(signature, nonce_bytes, padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid public key or signature format")

    db.add_user({"alias": alias, "publicKey": request.publicKey})
    del challenge_storage[alias]

    return {"message": "User registered successfully"}

@router.post("/login-challenge", response_model=ChallengeResponse)
def login_challenge(request: AliasRequest):
    if not db.get_user(request.alias):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    nonce = secrets.token_urlsafe(32)
    challenge_storage[request.alias] = {
        "nonce": nonce,
        "timestamp": datetime.now(UTC),
        "type": "login"
    }
    return ChallengeResponse(nonce=nonce)

@router.post("/login-complete", response_model=TokenResponse)
def login_complete(request: LoginCompleteRequest):
    alias = request.alias
    challenge_info = challenge_storage.get(alias)
    user_info = db.get_user(alias)

    if not user_info:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if not challenge_info or challenge_info.get("type") != "login":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login challenge not found or invalid")
    if datetime.now(UTC) - challenge_info["timestamp"] > timedelta(minutes=5):
        raise HTTPException(status_code=status.HTTP_408_REQUEST_TIMEOUT, detail="Challenge expired")

    try:
        public_key = serialization.load_pem_public_key(user_info["publicKey"].encode('utf-8'))
        signature = base64.b64decode(request.signedChallenge)
        nonce_bytes = challenge_info["nonce"].encode('utf-8')
        public_key.verify(signature, nonce_bytes, padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature format")

    del challenge_storage[alias]
    access_token = create_access_token(data={"sub": alias})
    return {"token": access_token}
