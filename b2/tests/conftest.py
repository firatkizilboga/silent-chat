import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db import db

@pytest.fixture(scope="function")
def client():
    # Truncate all tables before each test
    db.truncate()
    with TestClient(app) as c:
        yield c
