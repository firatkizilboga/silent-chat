from fastapi import APIRouter, HTTPException, status
from app.models.auth import (
    AliasRequest,
    ChallengeResponse,
    RegisterCompleteRequest,
    LoginCompleteRequest,
    TokenResponse,
)
from app.services.security import create_access_token
from app.db import db
import secrets
from datetime import datetime, timedelta, UTC
import base64
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.exceptions import InvalidSignature
import re

router = APIRouter()

# Keyed by nonce so multiple clients can have concurrent challenges.
challenge_storage = {}


def _verify_key(public_key, data, signed_data):
    if isinstance(public_key, str):
        public_key = serialization.load_pem_public_key(public_key.encode("utf-8"))

    public_key.verify(
        signed_data,
        data,
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    # if this fails an error will be raised.

    return True


@router.post("/register-challenge", response_model=ChallengeResponse)
async def register_challenge(request: AliasRequest):
    if await db.get_user(request.alias):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Alias already taken"
        )

    alias = request.alias
    if alias.lower() != alias:
        raise HTTPException(
            status_code=status.HTTP_406_NOT_ACCEPTABLE,
            detail="Only lowercase letters allowed.",
        )

    if not re.match(r"^[a-z0-9._:-]+$", alias):
        raise HTTPException(
            status_code=status.HTTP_406_NOT_ACCEPTABLE,
            detail="Only alpha numericals, dots, underscores, colons and dashes are allowed.",
        )

    if len(alias) > 64:
        raise HTTPException(
            status_code=status.HTTP_406_NOT_ACCEPTABLE,
            detail="Username cannot exceed 64 characters.",
        )

    nonce = secrets.token_urlsafe(32)
    challenge_storage[nonce] = {
        "alias": request.alias, "timestamp": datetime.now(UTC)}
    return ChallengeResponse(nonce=nonce)


@router.post("/register-complete", status_code=status.HTTP_201_CREATED)
async def register_complete(request: RegisterCompleteRequest):
    challenge_info = challenge_storage.get(request.nonce)

    if not challenge_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Challenge not found or expired",
        )

    if challenge_info["alias"] != request.alias:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Alias mismatch"
        )

    if datetime.now(UTC) - challenge_info["timestamp"] > timedelta(minutes=5):
        del challenge_storage[request.nonce]
        raise HTTPException(
            status_code=status.HTTP_408_REQUEST_TIMEOUT, detail="Challenge expired"
        )

    try:
        _verify_key(
            request.publicKey,
            request.nonce.encode("utf-8"),
            base64.b64decode(request.signedNonce),
        )

    except InvalidSignature:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
        )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid public key or signature format",
        )

    await db.add_user({"alias": request.alias, "publicKey": request.publicKey})
    del challenge_storage[request.nonce]

    return {"message": "User registered successfully"}


@router.post("/login-challenge", response_model=ChallengeResponse)
async def login_challenge(request: AliasRequest):
    if not await db.get_user(request.alias):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    nonce = secrets.token_urlsafe(32)
    challenge_storage[nonce] = {
        "alias": request.alias,
        "timestamp": datetime.now(UTC),
        "type": "login",
    }
    return ChallengeResponse(nonce=nonce)


@router.post("/login-complete", response_model=TokenResponse)
async def login_complete(request: LoginCompleteRequest):
    challenge_info = challenge_storage.get(request.nonce)
    user_info = await db.get_user(request.alias)

    if not user_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    if not challenge_info or challenge_info.get("type") != "login":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Login challenge not found or invalid",
        )

    if challenge_info["alias"] != request.alias:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Alias mismatch"
        )

    if datetime.now(UTC) - challenge_info["timestamp"] > timedelta(minutes=5):
        del challenge_storage[request.nonce]
        raise HTTPException(
            status_code=status.HTTP_408_REQUEST_TIMEOUT, detail="Challenge expired"
        )

    try:
        public_key = serialization.load_pem_public_key(
            user_info["publicKey"].encode("utf-8")
        )

        _verify_key(
            public_key,
            request.nonce.encode("utf-8"),
            base64.b64decode(request.signedChallenge),
        )

    except InvalidSignature:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
        )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature format"
        )

    del challenge_storage[request.nonce]
    access_token = create_access_token(data={"sub": request.alias})
    return {"token": access_token}
