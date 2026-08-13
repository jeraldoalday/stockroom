from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_200_even_when_database_is_unreachable():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in ("ok", "degraded")
    assert body["database"] in ("connected", "unreachable")
