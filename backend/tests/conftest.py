import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db import db
import asyncio

@pytest.fixture(scope="function")
def client():
    # Initialize and truncate all tables before each test
    async def setup_db():
        await db.init_db()
        await db.truncate()
    
    asyncio.run(setup_db())
    with TestClient(app) as c:
        yield c
