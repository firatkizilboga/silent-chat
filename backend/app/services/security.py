from datetime import datetime, timedelta, UTC
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from app.core.config import settings

# TODO: Decide if we need Oauth here at all.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login-complete")


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


async def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Decodes JWT, validates it, and returns the user's alias (from 'sub' claim).
    This function is a FastAPI dependency.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        alias: str = payload.get("sub")
        if alias is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # In a real app, you would fetch the user from the database here to ensure they still exist.
    # from app.apis.auth import user_storage
    # if alias not in user_storage:
    #     raise credentials_exception

    return alias
