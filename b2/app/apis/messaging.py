from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime, timedelta, UTC
import asyncio
import uuid
import json
from typing import Optional
from pydantic import BaseModel

from app.services.security import get_current_user
from app.db import db

router = APIRouter()

class Message(BaseModel):
    recipientAlias: str
    type: str
    encryptedMessage: str
    signature: str

@router.post("/messages", status_code=status.HTTP_202_ACCEPTED)
def post_message(message: Message, sender_alias: str = Depends(get_current_user)):
    """
    Accepts an encrypted message from an authenticated user and stores it.
    For FILE type, stores content separately and replaces message body with file reference.
    """
    if not db.get_user(message.recipientAlias):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")
    
    full_message = message.model_dump()
    full_message["senderAlias"] = sender_alias
    full_message["serverTimestamp"] = datetime.now(UTC).isoformat()
    
    # Handle FILE type - store content separately
    if message.type == "FILE":
        file_id = str(uuid.uuid4())
        encrypted_content = message.encryptedMessage
        
        # Replace message body with file reference
        full_message["encryptedMessage"] = json.dumps({"fileId": file_id})
        
        # Store the message first to get the ID
        message_id = db.add_message(full_message)
        
        # Store the file content
        db.add_file(file_id, message_id, sender_alias, message.recipientAlias, encrypted_content)
    else:
        db.add_message(full_message)
    
    return {"message": "Message accepted"}

@router.get("/messages")
async def get_messages(current_user: str = Depends(get_current_user), since: Optional[int] = None):
    """
    Retrieves messages for the authenticated user.
    - Uses long polling to wait for new messages.
    - Filters messages based on 'since' message ID (returns messages with id > since).
    """
    start_time = datetime.now(UTC)
    
    while True:
        # Build the query with ID-based filtering
        user_messages = db.get_messages(current_user, since)
        
        # If messages are found, return them immediately
        if user_messages:
            return user_messages
            
        # If no messages, wait and check again, unless timeout is reached
        if datetime.now(UTC) - start_time > timedelta(seconds=25):
            return [] # Timeout, return empty list
            
        await asyncio.sleep(1) # Wait for 1 second before checking again

@router.get("/files/{file_id}")
def get_file(file_id: str, current_user: str = Depends(get_current_user)):
    """
    Retrieves encrypted file content by file ID.
    Only the sender or recipient can access the file.
    """
    file_record = db.get_file(file_id)
    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    
    # Authorization: only sender or recipient can access
    if current_user != file_record["senderAlias"] and current_user != file_record["recipientAlias"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    return {"fileId": file_id, "encryptedContent": file_record["encryptedContent"]}

@router.get("/keys/{alias}")
def get_user_public_key(alias: str, current_user: str = Depends(get_current_user)):
    """
    Retrieves the public key for a given user.
    The requester must be authenticated.
    """
    user = db.get_user(alias)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"alias": alias, "publicKey": user["publicKey"]}
