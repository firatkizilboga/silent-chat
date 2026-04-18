from pydantic import BaseModel


class AliasRequest(BaseModel):
    alias: str


class ChallengeResponse(BaseModel):
    nonce: str  # Can be used for register or login challenge


class RegisterCompleteRequest(BaseModel):
    alias: str
    nonce: str
    publicKey: str
    signedNonce: str


class LoginCompleteRequest(BaseModel):
    alias: str
    nonce: str
    signedChallenge: str


class TokenResponse(BaseModel):
    token: str
    token_type: str = "bearer"
