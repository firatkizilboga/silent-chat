import sqlite3
from typing import List, Optional, Dict, Any

DB_NAME = "silent-chat.db"

class Database:
    def __init__(self, db_name=DB_NAME):
        self.db_name = db_name
        self.init_db()

    def get_connection(self):
        conn = sqlite3.connect(self.db_name)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # User table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                alias TEXT PRIMARY KEY,
                publicKey TEXT NOT NULL
            )
        ''')

        # Messages table
        cursor.execute('''
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
        cursor.execute('''
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
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipientAlias)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (serverTimestamp)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_files_message ON files (messageId)')
        
        conn.commit()
        conn.close()

    def add_user(self, user_data: Dict[str, Any]):
        conn = self.get_connection()
        try:
            conn.execute(
                'INSERT INTO users (alias, publicKey) VALUES (?, ?)',
                (user_data['alias'], user_data['publicKey'])
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # User might already exist, caller should check or handle distinctness
            pass
        finally:
            conn.close()

    def get_user(self, alias: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        cursor = conn.execute('SELECT * FROM users WHERE alias = ?', (alias,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return dict(row)
        return None

    def add_message(self, message_data: Dict[str, Any]):
        conn = self.get_connection()
        # Message data keys: recipientAlias, senderAlias, type, encryptedMessage, signature, serverTimestamp
        cursor = conn.execute('''
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
        conn.commit()
        conn.close()
        return message_id

    def get_messages(self, recipient_alias: str, since_id: Optional[int] = None) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        query = 'SELECT * FROM messages WHERE recipientAlias = ?'
        params = [recipient_alias]
        
        if since_id is not None:
            query += ' AND id > ?'
            params.append(since_id)
            
        query += ' ORDER BY id ASC'
            
        cursor = conn.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]

    def get_all_users(self) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cursor = conn.execute('SELECT * FROM users')
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]

    def add_file(self, file_id: str, message_id: int, sender_alias: str, recipient_alias: str, encrypted_content: str):
        conn = self.get_connection()
        conn.execute('''
            INSERT INTO files (id, messageId, senderAlias, recipientAlias, encryptedContent)
            VALUES (?, ?, ?, ?, ?)
        ''', (file_id, message_id, sender_alias, recipient_alias, encrypted_content))
        conn.commit()
        conn.close()

    def get_file(self, file_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        cursor = conn.execute('SELECT * FROM files WHERE id = ?', (file_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return dict(row)
        return None

    def truncate(self):
        conn = self.get_connection()
        conn.execute('DELETE FROM users')
        conn.execute('DELETE FROM messages')
        conn.execute('DELETE FROM files')
        conn.commit()
        conn.close()

# Global instance
db = Database()
