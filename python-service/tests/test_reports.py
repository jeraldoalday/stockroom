from datetime import date

from fastapi.testclient import TestClient

from app.config import settings
from app.db import get_db
from app.main import app

client = TestClient(app)

HEADERS = {"x-internal-key": settings.internal_api_key}


def override_db():
    yield None


app.dependency_overrides[get_db] = override_db


def test_export_products_requires_internal_key(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_products_rows",
        lambda conn, organization_id: [],
    )
    res = client.get("/export/products", params={"organization_id": "org_1"})
    assert res.status_code == 401


def test_export_products_returns_csv(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_products_rows",
        lambda conn, organization_id: [
            {
                "sku": "WIDGET-1",
                "name": "Widget",
                "category": "Gadgets",
                "cost_cents": 500,
                "price_cents": 999,
                "reorder_point": 5,
                "reorder_qty": 20,
                "is_active": True,
            }
        ],
    )
    res = client.get("/export/products", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "WIDGET-1" in res.text
    assert "Widget" in res.text


def test_export_stock_returns_csv(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_stock_rows",
        lambda conn, organization_id: [
            {"sku": "WIDGET-1", "product_name": "Widget", "location": "Main", "quantity": 12}
        ],
    )
    res = client.get("/export/stock", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert "Main" in res.text
    assert "12" in res.text


def test_export_movements_returns_csv(monkeypatch):
    captured = {}

    def fake_fetch(conn, organization_id, since):
        captured["since"] = since
        return [
            {
                "created_at": "2026-08-15T00:00:00Z",
                "sku": "WIDGET-1",
                "product_name": "Widget",
                "location": "Main",
                "type": "SALE",
                "quantity": -3,
                "reason": None,
            }
        ]

    monkeypatch.setattr("app.routers.reports.fetch_movement_rows", fake_fetch)
    res = client.get("/export/movements", params={"organization_id": "org_1", "days": 14}, headers=HEADERS)
    assert res.status_code == 200
    assert "SALE" in res.text
    assert captured["since"] is not None


def test_sales_stock_trend_returns_series_and_totals(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_sales_stock_trend",
        lambda conn, organization_id, since: [
            {"day": date(2026, 8, 14), "units_sold": 5, "units_received": 10, "revenue_cents": 4995},
            {"day": date(2026, 8, 15), "units_sold": 3, "units_received": 0, "revenue_cents": 2997},
        ],
    )
    res = client.get("/reports/trend", params={"organization_id": "org_1", "days": 7}, headers=HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["days"] == 7
    assert len(body["series"]) == 2
    assert body["series"][0]["date"] == "2026-08-14"
    assert body["totals"]["unitsSold"] == 8
    assert body["totals"]["unitsReceived"] == 10
    assert body["totals"]["revenueCents"] == 7992


def test_trend_rejects_invalid_days(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_sales_stock_trend",
        lambda conn, organization_id, since: [],
    )
    res = client.get("/reports/trend", params={"organization_id": "org_1", "days": 0}, headers=HEADERS)
    assert res.status_code == 422


def test_reorder_suggestions_computes_moving_average_and_target(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_reorder_candidates",
        lambda conn, organization_id, since: [
            # 30 units sold over a 30-day window -> 1/day; 14-day coverage
            # target is 14, current stock is 3, so target - current = 11,
            # which beats the product's own reorderQty of 5.
            {
                "product_id": "prod_1",
                "sku": "WIDGET-1",
                "name": "Widget",
                "reorder_point": 5,
                "reorder_qty": 5,
                "current_stock": 3,
                "units_sold": 30,
            },
            # No sales in the window -> avgDailyDemand 0, no days-of-stock
            # figure, suggestion falls back to the product's own reorderQty.
            {
                "product_id": "prod_2",
                "sku": "GADGET-1",
                "name": "Gadget",
                "reorder_point": 10,
                "reorder_qty": 20,
                "current_stock": 2,
                "units_sold": 0,
            },
        ],
    )
    res = client.get(
        "/reports/reorder-suggestions",
        params={"organization_id": "org_1", "days": 30, "coverage_days": 14},
        headers=HEADERS,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["days"] == 30
    assert body["coverageDays"] == 14
    assert len(body["items"]) == 2

    widget = next(item for item in body["items"] if item["sku"] == "WIDGET-1")
    assert widget["avgDailyDemand"] == 1.0
    assert widget["daysOfStockRemaining"] == 3.0
    assert widget["suggestedQty"] == 11

    gadget = next(item for item in body["items"] if item["sku"] == "GADGET-1")
    assert gadget["avgDailyDemand"] == 0.0
    assert gadget["daysOfStockRemaining"] is None
    assert gadget["suggestedQty"] == 20

    # Most urgent (fewest days of stock remaining) sorts first.
    assert [item["sku"] for item in body["items"]] == ["WIDGET-1", "GADGET-1"]


def test_reorder_suggestions_requires_internal_key(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_reorder_candidates",
        lambda conn, organization_id, since: [],
    )
    res = client.get("/reports/reorder-suggestions", params={"organization_id": "org_1"})
    assert res.status_code == 401
