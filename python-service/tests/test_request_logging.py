import re

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_generates_a_request_id_when_the_caller_sends_none():
    response = client.get("/health")
    assert re.match(r"^[a-f0-9]{32}$", response.headers["x-request-id"])


def test_echoes_a_well_formed_incoming_request_id():
    response = client.get("/health", headers={"X-Request-Id": "req-abc123"})
    assert response.headers["x-request-id"] == "req-abc123"


def test_replaces_a_malformed_incoming_request_id_instead_of_echoing_it():
    # Same shape guard as the Node API's requestId middleware: a value that
    # doesn't match the opaque-token pattern must never reach a log line
    # verbatim (a newline could forge a second JSON line; an oversized
    # string could bloat one).
    response = client.get("/health", headers={"X-Request-Id": "has a space and \n a newline"})
    assert response.headers["x-request-id"] != "has a space and \n a newline"
    assert re.match(r"^[a-f0-9]{32}$", response.headers["x-request-id"])
