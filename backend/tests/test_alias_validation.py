from fastapi.testclient import TestClient
import pytest

def test_alias_validation_lowercase(client: TestClient):
    """Tests that aliases must be lowercase."""
    response = client.post("/auth/register-challenge", json={"alias": "User123"})
    assert response.status_code == 406
    assert "Only lowercase letters allowed" in response.json()["detail"]

def test_alias_validation_valid_chars(client: TestClient):
    """Tests that valid characters are accepted."""
    valid_aliases = ["user.name", "user_name", "user:name", "user-name", "user123"]
    for alias in valid_aliases:
        response = client.post("/auth/register-challenge", json={"alias": alias})
        assert response.status_code == 200, f"Failed for alias: {alias}"

def test_alias_validation_invalid_chars(success_client: TestClient):
    """Tests that invalid characters are rejected."""
    invalid_aliases = ["user name", "user@name", "user#name", "user!", "user$"]
    for alias in invalid_aliases:
        response = success_client.post("/auth/register-challenge", json={"alias": alias})
        assert response.status_code == 406, f"Should have failed for alias: {alias}"
        assert "Only alpha numericals" in response.json()["detail"]

def test_alias_validation_length(client: TestClient):
    """Tests that aliases cannot exceed 64 characters."""
    long_alias = "a" * 65
    response = client.post("/auth/register-challenge", json={"alias": long_alias})
    assert response.status_code == 406
    assert "Username cannot exceed 64 characters" in response.json()["detail"]

    valid_long_alias = "a" * 64
    response = client.post("/auth/register-challenge", json={"alias": valid_long_alias})
    assert response.status_code == 200

@pytest.fixture
def success_client(client):
    return client
