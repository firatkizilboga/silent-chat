from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from datetime import datetime, timedelta, UTC
import asyncio
import uuid
import json
from typing import Optional
from pydantic import BaseModel
import logging

from app.services.security import get_current_user, get_user_from_token
from app.db import db
from app.services.websockets import manager
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


class Message(BaseModel):
    recipientAlias: str
    type: str
    encryptedMessage: str
    signature: str


@router.post("/messages", status_code=status.HTTP_202_ACCEPTED)
async def post_message(message: Message, sender_alias: str = Depends(get_current_user)):
    """
    Accepts an encrypted message from an authenticated user and stores it.
    For FILE type, stores content separately and replaces message body with file reference.
    """
    if not await db.get_user(message.recipientAlias):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found"
        )

    full_message = message.model_dump()
    full_message["senderAlias"] = sender_alias
    full_message["serverTimestamp"] = datetime.now(UTC).isoformat()

    # Handle FILE type - store content separately
    if message.type == "FILE":
        file_id = str(uuid.uuid4())
        encrypted_content = message.encryptedMessage

        full_message["encryptedMessage"] = json.dumps({"fileId": file_id})

        message_id = await db.add_message(full_message)

        await db.add_file(
            file_id, message_id, sender_alias, message.recipientAlias, encrypted_content
        )
    else:
        message_id = await db.add_message(full_message)

    # Push notification via WebSocket
    # We include the ID so the client can deduplicate if they also poll
    full_message["id"] = message_id
    await manager.send_personal_message(full_message, message.recipientAlias)

    return {"message": "Message accepted"}


handlers = {}


def ws_task_handler(cmd: str):
    """
    Decorator factory to register a WebSocket command handler.
    Usage: @ws_task_handler("my_command")
    """

    def decorator(func):
        handlers[cmd] = func
        return func

    return decorator


@ws_task_handler("subscribe-to-online-status")
async def sub_to_online_stat(user_alias, arguments):
    success = await manager.subscribe_to_online_status(user_alias, arguments.get("target_user"))
    return {"status": "subscribed" if success else "limit_reached"}


@ws_task_handler("unsubscribe-from-online-status")
async def unsub_from_online_stat(user_alias, arguments):
    await manager.unsubscribe_from_online_status(user_alias, arguments.get("target_user"))
    return {"status": "unsubscribed"}


async def handle_ws_task(user_alias: str, data: str):
    """
    Parses the incoming WS data and routes it to the registered handler.
    """
    try:
        body = json.loads(data)
        cmd = body.get("cmd")
        handler = handlers.get(cmd)

        if not handler:
            return json.dumps({"error": f"Unknown command: {cmd}"})

        if asyncio.iscoroutinefunction(handler):
            result = await handler(user_alias, body.get("arguments", {}))
        else:
            result = handler(user_alias, body.get("arguments", {}))

        return json.dumps({"cmd": cmd, "payload": result})

    except json.JSONDecodeError:
        return json.dumps({"error": "Invalid JSON format"})
    except Exception as e:
        logger.error(f"WebSocket task error: {e}")
        return json.dumps({"error": "Internal server error"})


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    """
    WebSocket endpoint for real-time message updates.
    Expects a JWT token as a query parameter: ws://.../ws?token=...
    """
    user_alias = get_user_from_token(token)
    if user_alias is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, user_alias)

    try:
        while True:
            data = await websocket.receive_text()
            response = await handle_ws_task(user_alias, data)
            await websocket.send_text(response)

    except WebSocketDisconnect:
        await manager.disconnect(websocket, user_alias)
    except Exception as e:
        logger.error(f"WebSocket error for {user_alias}: {e}")
        await manager.disconnect(websocket, user_alias)


@router.get("/messages")
async def get_messages(
    current_user: str = Depends(get_current_user),
    since: Optional[int] = None,
    limit: int = Query(
        default=100, ge=1, le=1000, description="Maximum number of messages to return"
    ),
    timeout_seconds: int = Query(
        default=25, ge=0, le=60, description="Long polling timeout in seconds"
    ),
):
    """
    Retrieves messages for the authenticated user.
    - Uses long polling to wait for new messages.
    - Filters messages based on 'since' message ID (returns messages with id > since).
    """
    start_time = datetime.now(UTC)

    while True:
        try:
            # Build the query with ID-based filtering
            user_messages = await db.get_messages(current_user, since, limit)

            # If messages are found, return them immediately
            if user_messages:
                return user_messages
        except Exception as e:
            logger.error(f"Database error in get_messages: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

        # If no messages, wait and check again, unless timeout is reached
        if datetime.now(UTC) - start_time > timedelta(seconds=timeout_seconds):
            return []  # Timeout, return empty list

        await asyncio.sleep(1)  # Wait for 1 second before checking again


@router.get("/files/{file_id}")
async def get_file(file_id: str, current_user: str = Depends(get_current_user)):
    """
    Retrieves encrypted file content by file ID.
    Only the sender or recipient can access the file.
    """
    file_record = await db.get_file(file_id)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )

    # Authorization: only sender or recipient can access
    if (
        current_user != file_record["senderAlias"]
        and current_user != file_record["recipientAlias"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    return {"fileId": file_id, "encryptedContent": file_record["encryptedContent"]}


@router.get("/keys/{alias}")
async def get_user_public_key(
    alias: str, current_user: str = Depends(get_current_user)
):
    """
    Retrieves the public key for a given user.
    The requester must be authenticated.
    """
    user = await db.get_user(alias)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return {"alias": alias, "publicKey": user["publicKey"]}
