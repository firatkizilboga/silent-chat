import aiosqlite
from typing import List, Optional, Dict, Any

DB_NAME = "silent-chat.db"

class Database:
    def __init__(self, db_name=DB_NAME):
        self.db_name = db_name

    def get_connection(self):
        # This helper is less useful in async context managers unless we return the connect awaitable
        # We will use aiosqlite.connect directly in methods
        pass

    async def init_db(self):
        async with aiosqlite.connect(self.db_name) as conn:
            # User table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    alias TEXT PRIMARY KEY,
                    publicKey TEXT NOT NULL
                )
            ''')

            # Messages table
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recipientAlias TEXT NOT NULL,
                    senderAlias TEXT NOT NULL,
                    type TEXT NOT NULL,
                    encryptedMessage TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    serverTimestamp TEXT NOT NULL
                )
            ''')
            
            # Files table - stores encrypted file content separately
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY,
                    messageId INTEGER NOT NULL,
                    senderAlias TEXT NOT NULL,
                    recipientAlias TEXT NOT NULL,
                    encryptedContent TEXT NOT NULL,
                    FOREIGN KEY (messageId) REFERENCES messages (id)
                )
            ''')
            
            # Indexes for performance
            await conn.execute('CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipientAlias)')
            await conn.execute('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (serverTimestamp)')
            await conn.execute('CREATE INDEX IF NOT EXISTS idx_files_message ON files (messageId)')
            
            await conn.commit()

    async def add_user(self, user_data: Dict[str, Any]):
        async with aiosqlite.connect(self.db_name) as conn:
            try:
                await conn.execute(
                    'INSERT INTO users (alias, publicKey) VALUES (?, ?)',
                    (user_data['alias'], user_data['publicKey'])
                )
                await conn.commit()
            except aiosqlite.IntegrityError:
                # User might already exist, caller should check or handle distinctness
                pass

    async def get_user(self, alias: str) -> Optional[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_name) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute('SELECT * FROM users WHERE alias = ?', (alias,))
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None

    async def add_message(self, message_data: Dict[str, Any]):
        async with aiosqlite.connect(self.db_name) as conn:
            # Message data keys: recipientAlias, senderAlias, type, encryptedMessage, signature, serverTimestamp
            cursor = await conn.execute('''
                INSERT INTO messages (recipientAlias, senderAlias, type, encryptedMessage, signature, serverTimestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                message_data['recipientAlias'],
                message_data['senderAlias'],
                message_data['type'],
                message_data['encryptedMessage'],
                message_data['signature'],
                message_data['serverTimestamp']
            ))
            message_id = cursor.lastrowid
            await conn.commit()
            return message_id

    async def get_messages(self, recipient_alias: str, since_id: Optional[int] = None, limit: int = 100) -> List[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_name) as conn:
            conn.row_factory = aiosqlite.Row
            query = 'SELECT * FROM messages WHERE recipientAlias = ?'
            params = [recipient_alias]
            
            if since_id is not None:
                query += ' AND id > ?'
                params.append(since_id)
                
            query += ' ORDER BY id ASC LIMIT ?'
            params.append(limit)
                
            cursor = await conn.execute(query, params)
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def get_all_users(self) -> List[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_name) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute('SELECT * FROM users')
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def add_file(self, file_id: str, message_id: int, sender_alias: str, recipient_alias: str, encrypted_content: str):
        async with aiosqlite.connect(self.db_name) as conn:
            await conn.execute('''
                INSERT INTO files (id, messageId, senderAlias, recipientAlias, encryptedContent)
                VALUES (?, ?, ?, ?, ?)
            ''', (file_id, message_id, sender_alias, recipient_alias, encrypted_content))
            await conn.commit()

    async def get_file(self, file_id: str) -> Optional[Dict[str, Any]]:
        async with aiosqlite.connect(self.db_name) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute('SELECT * FROM files WHERE id = ?', (file_id,))
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None

    async def truncate(self):
        async with aiosqlite.connect(self.db_name) as conn:
            await conn.execute('DELETE FROM users')
            await conn.execute('DELETE FROM messages')
            await conn.execute('DELETE FROM files')
            await conn.commit()

# Global instance
db = Database()
