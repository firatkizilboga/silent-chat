from typing import Dict, List, Set
from fastapi import WebSocket
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # Map user_alias -> List[WebSocket]
        # A user might have multiple active connections (e.g., phone and laptop)
        self.active_connections: Dict[str, List[WebSocket]] = {}

        # Who is watching ME? subscribee -> {set of subscribers}
        self.subscribers_of: Dict[str, Set[str]] = defaultdict(set)

        # Who am I watching? subscriber -> {set of target_users}
        self.subscribed_to: Dict[str, Set[str]] = defaultdict(set)

        self.MAX_SUBSCRIPTIONS = 3

    async def connect(self, websocket: WebSocket, user_alias: str):
        await websocket.accept()
        if user_alias not in self.active_connections:
            self.active_connections[user_alias] = []

        self.active_connections[user_alias].append(websocket)
        await self.dispatch_online_status(user_alias, True)

        logger.info(
            f"User {user_alias} connected via WebSocket. Total connections: {
                len(self.active_connections.get(user_alias, []))
            }"
        )

    async def disconnect(self, websocket: WebSocket, user_alias: str):
        if user_alias in self.active_connections:
            if websocket in self.active_connections[user_alias]:
                self.active_connections[user_alias].remove(websocket)
            if not self.active_connections[user_alias]:
                del self.active_connections[user_alias]
                # If truly gone, perform deep cleanup
                await self._cleanup_subscriptions(user_alias)

        await self.dispatch_online_status(user_alias, False)
        logger.info(f"User {user_alias} disconnected via WebSocket.")

    async def _cleanup_subscriptions(self, user_alias: str):
        """Removes user from all tracking when they disconnect completely."""
        # 1. Stop watching everyone this user was interested in
        targets = self.subscribed_to.pop(user_alias, set())
        for target in targets:
            self.subscribers_of[target].discard(user_alias)

        # 2. Note: We DON'T remove their own entry from 'subscribers_of' 
        # because other people might still be waiting for them to come back online.
        # But if no one is watching them, we can clean that up too.
        if not self.subscribers_of.get(user_alias):
            self.subscribers_of.pop(user_alias, None)

    async def dispatch_online_status(self, subscribee: str, state: bool):
        subscribers = self.subscribers_of.get(subscribee, set())
        if not subscribers:
            return

        payload = {
            "type": "online_status",
            "user": subscribee,
            "status": "ONLINE" if state else "OFFLINE",
        }

        for subscriber in list(subscribers):
            success = await self.send_personal_message(payload, subscriber)
            if not success:
                # If we can't send to a subscriber, they might be dead.
                # In a real app, you might trigger a cleanup here.
                pass

    async def subscribe_to_online_status(self, subscriber: str, subscribee: str) -> bool:
        """
        Subscribes a user to another user's online status.
        Returns True if successful, False if limit reached.
        """
        # Limit check
        if len(self.subscribed_to[subscriber]) >= self.MAX_SUBSCRIPTIONS:
            if subscribee not in self.subscribed_to[subscriber]:
                return False

        # Update mappings
        self.subscribed_to[subscriber].add(subscribee)
        self.subscribers_of[subscribee].add(subscriber)

        # Immediately send current status
        is_online = subscribee in self.active_connections
        await self.dispatch_online_status(subscribee, is_online)
        return True

    async def unsubscribe_from_online_status(self, subscriber: str, subscribee: str):
        """Removes a subscription."""
        if subscriber in self.subscribed_to:
            self.subscribed_to[subscriber].discard(subscribee)
        
        if subscribee in self.subscribers_of:
            self.subscribers_of[subscribee].discard(subscriber)
            # Cleanup if no one else is watching
            if not self.subscribers_of[subscribee]:
                self.subscribers_of.pop(subscribee, None)

    async def send_personal_message(self, message: dict, user_alias: str) -> bool:
        if user_alias in self.active_connections:
            for connection in self.active_connections[user_alias]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending to {user_alias}: {e}")
                    return False
            return True
        return False


# Global instance
manager = ConnectionManager()
