from fastapi import APIRouter, Depends
from app.services.security import get_current_user
from app.db import db

router = APIRouter()

@router.get("/users")
async def get_all_users(current_user: str = Depends(get_current_user)):
    """
    Retrieves a list of all registered user aliases.
    The requester must be authenticated.
    """
    users = db.get_all_users()
    # Return aliases, excluding the current user's alias
    return [user['alias'] for user in users if user['alias'] != current_user]
