from typing import Dict, List
from fastapi import WebSocket
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Map user_alias -> List[WebSocket]
        # A user might have multiple active connections (e.g., phone and laptop)
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_alias: str):
        await websocket.accept()
        if user_alias not in self.active_connections:
            self.active_connections[user_alias] = []
        self.active_connections[user_alias].append(websocket)
        logger.info(f"User {user_alias} connected via WebSocket. Total connections: {len(self.active_connections.get(user_alias, []))}")

    def disconnect(self, websocket: WebSocket, user_alias: str):
        if user_alias in self.active_connections:
            if websocket in self.active_connections[user_alias]:
                self.active_connections[user_alias].remove(websocket)
            if not self.active_connections[user_alias]:
                del self.active_connections[user_alias]
        logger.info(f"User {user_alias} disconnected via WebSocket.")

    async def send_personal_message(self, message: dict, user_alias: str):
        if user_alias in self.active_connections:
            for connection in self.active_connections[user_alias]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message to {user_alias}: {e}")
                    # Could perform cleanup here if the socket is dead

# Global instance
manager = ConnectionManager()
