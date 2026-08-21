"""Every route in this service is behind the shared internal key.

The service is read-only and never exposed to the browser (PRD section 8):
the Node API is its only client. That makes the internal key the entire
access control story, so it's worth asserting on every endpoint rather than
on one representative — a route added without the `require_internal_caller`
dependency would otherwise be an unauthenticated read of any tenant's data
by organization id.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db import get_db
from app.main import app

client = TestClient(app)

HEADERS = {"x-internal-key": settings.internal_api_key}

PROTECTED_ENDPOINTS = [
    "/export/products",
    "/export/stock",
    "/export/movements",
    "/reports/trend",
    "/reports/reorder-suggestions",
]


def override_db():
    yield None


app.dependency_overrides[get_db] = override_db


@pytest.fixture(autouse=True)
def stub_queries(monkeypatch):
    """Every data access in the router returns nothing, so these tests are
    about the guard and not about the SQL behind it."""
    for name in (
        "fetch_products_rows",
        "fetch_stock_rows",
    ):
        monkeypatch.setattr(f"app.routers.reports.{name}", lambda conn, organization_id: [])
    for name in (
        "fetch_movement_rows",
        "fetch_sales_stock_trend",
        "fetch_reorder_candidates",
    ):
        monkeypatch.setattr(f"app.routers.reports.{name}", lambda conn, organization_id, since: [])


@pytest.mark.parametrize("path", PROTECTED_ENDPOINTS)
def test_endpoint_rejects_a_missing_internal_key(path):
    response = client.get(path, params={"organization_id": "org_1"})
    assert response.status_code == 401


@pytest.mark.parametrize("path", PROTECTED_ENDPOINTS)
def test_endpoint_rejects_a_wrong_internal_key(path):
    response = client.get(
        path,
        params={"organization_id": "org_1"},
        headers={"x-internal-key": "not-the-key"},
    )
    assert response.status_code == 401


@pytest.mark.parametrize("path", PROTECTED_ENDPOINTS)
def test_endpoint_accepts_the_configured_internal_key(path):
    response = client.get(path, params={"organization_id": "org_1"}, headers=HEADERS)
    assert response.status_code == 200


@pytest.mark.parametrize("path", PROTECTED_ENDPOINTS)
def test_endpoint_requires_an_organization_id(path):
    """Tenant scoping is not optional: without an organization id there is
    no correct answer to give, so it must be a 422 rather than a query that
    quietly spans every tenant."""
    response = client.get(path, headers=HEADERS)
    assert response.status_code == 422
