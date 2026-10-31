from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

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


def test_export_products_drops_cost_when_include_cost_is_false(monkeypatch):
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
    res = client.get(
        "/export/products",
        params={"organization_id": "org_1", "include_cost": "false"},
        headers=HEADERS,
    )
    assert res.status_code == 200
    assert "cost_cents" not in res.text
    assert "500" not in res.text
    assert "999" in res.text  # price_cents is unaffected


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


# CSV injection (CWE-1236): a Staff member controls a product's name/SKU and
# a movement's own free-text `reason`; an Owner is who opens the export in
# Excel/Sheets. A cell starting with `=`/`+`/`-`/`@` is read as a formula by
# those apps no matter what content type this API sends, so every such value
# must come back prefixed with a defusing `'` — and a legitimate negative
# number in the same export (movements' own `quantity`) must not be touched,
# since it's a native `int`, never a stringified one, by the time it reaches
# `_csv_response`.
def test_export_products_neutralizes_a_formula_leading_name(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_products_rows",
        lambda conn, organization_id: [
            {
                "sku": "=cmd|' /C calc'!A0",
                "name": "+SUM(1,2)",
                "category": "@evil",
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
    assert "'=cmd|' /C calc'!A0" in res.text
    assert "'+SUM(1,2)" in res.text
    assert "'@evil" in res.text


def test_export_movements_neutralizes_a_formula_leading_reason_but_not_a_negative_quantity(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_movement_rows",
        lambda conn, organization_id, since: [
            {
                "created_at": "2026-08-15T00:00:00Z",
                "sku": "WIDGET-1",
                "product_name": "Widget",
                "location": "Main",
                "type": "SALE",
                "quantity": -3,
                "reason": '=HYPERLINK("http://evil.example/","steal")',
            }
        ],
    )
    res = client.get("/export/movements", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert "'=HYPERLINK" in res.text
    # The quantity is a real negative int, not a stringified number the
    # sanitizer could mistake for a dangerous leading `-`.
    assert ",-3," in res.text or res.text.strip().endswith("-3")


def test_export_dead_stock_neutralizes_a_formula_leading_name(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_dead_stock",
        lambda conn, organization_id, since: [_dead_stock_row(name="-2+3+cmd")],
    )
    res = client.get("/export/dead-stock", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert "'-2+3+cmd" in res.text


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


def test_movements_export_includes_unit_price(monkeypatch):
    """A SALE's price is part of what the owner reconciles takings against,
    so the movements export carries it. Receipts and adjustments have no
    price and come through blank rather than as a misleading zero."""
    monkeypatch.setattr(
        "app.routers.reports.fetch_movement_rows",
        lambda conn, organization_id, since: [
            {
                "created_at": "2026-08-21T00:00:00Z",
                "sku": "WIDGET-1",
                "product_name": "Widget",
                "location": "Main",
                "type": "SALE",
                "quantity": -3,
                "unit_price_cents": 1999,
                "reason": None,
            },
            {
                "created_at": "2026-08-20T00:00:00Z",
                "sku": "WIDGET-1",
                "product_name": "Widget",
                "location": "Main",
                "type": "RECEIVE",
                "quantity": 10,
                "unit_price_cents": None,
                "reason": None,
            },
        ],
    )
    res = client.get("/export/movements", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert "unit_price_cents" in res.text
    assert "1999" in res.text

    sale_row = next(line for line in res.text.splitlines() if "SALE" in line)
    receive_row = next(line for line in res.text.splitlines() if "RECEIVE" in line)
    assert "1999" in sale_row
    # Blank, not 0.0 — "we didn't charge anything" and "this isn't a sale"
    # are different statements and the CSV shouldn't conflate them.
    assert ",," in receive_row


def test_trend_prefers_the_movements_own_price_over_the_order_line():
    """Guards the COALESCE argument order in the trend query.

    This asserts on SQL text rather than on results, because the query needs
    a live Postgres to execute. It is deliberately narrow: the one thing that
    silently breaks here is the precedence, since swapping the arguments
    still runs, still returns numbers, and quietly reports the ordered price
    instead of the price actually charged.
    """
    from app.services.reports import _TREND_SQL

    sql = str(_TREND_SQL)
    assert 'COALESCE(sm."unitPriceCents", sol."unitPriceCents", 0)' in sql


# --- Dead stock -----------------------------------------------------------
#
# The report the product was missing: not "what am I about to run out of"
# but "what have I bought that nobody wants". Every figure here is money on
# a shelf, so the arithmetic is worth pinning down.


def _dead_stock_row(**overrides):
    row = {
        "product_id": "prod_1",
        "sku": "DUST-1",
        "name": "Dusty Widget",
        "cost_cents": 250,
        "quantity_on_hand": 12,
        "last_sold_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "units_sold_in_window": 0,
    }
    row.update(overrides)
    return row


def test_dead_stock_requires_internal_key(monkeypatch):
    monkeypatch.setattr("app.routers.reports.fetch_dead_stock", lambda conn, organization_id, since: [])
    res = client.get("/reports/dead-stock", params={"organization_id": "org_1"})
    assert res.status_code == 401


def test_dead_stock_values_stock_at_cost(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_dead_stock",
        lambda conn, organization_id, since: [_dead_stock_row()],
    )
    res = client.get("/reports/dead-stock", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    body = res.json()
    item = body["items"][0]
    assert item["quantityOnHand"] == 12
    assert item["tiedUpValueCents"] == 12 * 250
    assert body["totals"]["tiedUpValueCents"] == 12 * 250
    assert body["totals"]["productCount"] == 1


def test_dead_stock_reports_days_since_the_last_sale(monkeypatch):
    long_ago = datetime.now(timezone.utc) - timedelta(days=200)
    monkeypatch.setattr(
        "app.routers.reports.fetch_dead_stock",
        lambda conn, organization_id, since: [_dead_stock_row(last_sold_at=long_ago)],
    )
    res = client.get("/reports/dead-stock", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.json()["items"][0]["daysSinceLastSale"] == 200


# "Never sold" and "sold once, ages ago" are different situations — one is a
# buying mistake, the other is a product that has died — so null has to
# survive rather than being flattened to a number.
def test_dead_stock_distinguishes_never_sold_from_long_ago(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_dead_stock",
        lambda conn, organization_id, since: [_dead_stock_row(last_sold_at=None)],
    )
    item = client.get(
        "/reports/dead-stock", params={"organization_id": "org_1"}, headers=HEADERS
    ).json()["items"][0]
    assert item["lastSoldAt"] is None
    assert item["daysSinceLastSale"] is None


# A timestamp without a timezone would raise on the subtraction against an
# aware "now" and take the whole report down with it.
def test_dead_stock_tolerates_a_naive_timestamp(monkeypatch):
    naive = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30)
    monkeypatch.setattr(
        "app.routers.reports.fetch_dead_stock",
        lambda conn, organization_id, since: [_dead_stock_row(last_sold_at=naive)],
    )
    res = client.get("/reports/dead-stock", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert res.json()["items"][0]["daysSinceLastSale"] == 30


# The list is capped so a catalogue full of slow movers can't return
# thousands of rows, but the headline figure has to describe the whole
# problem — a total that only covered the page would understate it.
def test_dead_stock_totals_cover_rows_beyond_the_limit(monkeypatch):
    rows = [
        _dead_stock_row(product_id=f"prod_{i}", sku=f"DUST-{i}", quantity_on_hand=2, cost_cents=100)
        for i in range(5)
    ]
    monkeypatch.setattr("app.routers.reports.fetch_dead_stock", lambda conn, organization_id, since: rows)

    body = client.get(
        "/reports/dead-stock",
        params={"organization_id": "org_1", "limit": 2},
        headers=HEADERS,
    ).json()
    assert len(body["items"]) == 2
    assert body["totals"]["productCount"] == 5
    assert body["totals"]["tiedUpValueCents"] == 5 * 2 * 100


def test_dead_stock_passes_the_window_to_the_query(monkeypatch):
    captured = {}

    def fake(conn, organization_id, since):
        captured["since"] = since
        return []

    monkeypatch.setattr("app.routers.reports.fetch_dead_stock", fake)
    res = client.get(
        "/reports/dead-stock",
        params={"organization_id": "org_1", "days": 180},
        headers=HEADERS,
    )
    assert res.status_code == 200
    assert res.json()["days"] == 180
    elapsed = datetime.now(timezone.utc) - captured["since"]
    assert 179 <= elapsed.days <= 180


def test_dead_stock_rejects_an_out_of_range_window():
    res = client.get(
        "/reports/dead-stock",
        params={"organization_id": "org_1", "days": 3},
        headers=HEADERS,
    )
    assert res.status_code == 422


# --- Dead stock CSV export -------------------------------------------------
#
# The report an owner would actually hand to someone — a supplier, an
# accountant — rather than the JSON a dashboard panel renders. Shares the
# same row-shaping helper as the JSON report above, so these two assert the
# same numbers rather than re-deriving them.


def test_export_dead_stock_requires_internal_key():
    res = client.get("/export/dead-stock", params={"organization_id": "org_1"})
    assert res.status_code == 401


def test_export_dead_stock_returns_csv_with_shaped_columns(monkeypatch):
    monkeypatch.setattr(
        "app.routers.reports.fetch_dead_stock",
        lambda conn, organization_id, since: [_dead_stock_row()],
    )
    res = client.get("/export/dead-stock", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "DUST-1" in res.text
    assert "tied_up_value_cents" in res.text
    assert str(12 * 250) in res.text


# The JSON report caps at `limit` so a dashboard panel doesn't drown; the
# export is a handoff document and has no such cap.
def test_export_dead_stock_has_no_row_limit(monkeypatch):
    rows = [
        _dead_stock_row(product_id=f"prod_{i}", sku=f"DUST-{i}", quantity_on_hand=2, cost_cents=100)
        for i in range(60)
    ]
    monkeypatch.setattr("app.routers.reports.fetch_dead_stock", lambda conn, organization_id, since: rows)

    res = client.get("/export/dead-stock", params={"organization_id": "org_1"}, headers=HEADERS)
    assert res.status_code == 200
    assert res.text.count("DUST-") == 60


def test_export_dead_stock_rejects_an_out_of_range_window():
    res = client.get(
        "/export/dead-stock",
        params={"organization_id": "org_1", "days": 3},
        headers=HEADERS,
    )
    assert res.status_code == 422


# --- Sales-order line fan-out ----------------------------------------------
#
# A sales order is allowed to carry two lines for the same product --
# POST /sales-orders and POST /:id/lines never reject one, and there's no
# unique constraint on (salesOrderId, productId) in schema.prisma. Fulfilling
# posts one SALE movement per line (salesOrders.routes.ts), so one order can
# leave two stock_movements rows that share the same (salesOrderId,
# productId) pair.
#
# Both queries below fall back to "sales_order_lines" for a price when a
# movement predates the unitPriceCents column, joined on exactly that pair
# because that's all a movement itself records. Joining straight to the line
# table turns each such movement into one row per matching line instead of
# one, so every SUM() over the result silently multiplies -- a sale of 5 and
# 3 units reports as 16 sold, not 8, with no error anywhere to catch it.
#
# Run for real against a real SQLAlchemy engine (SQLite) rather than
# monkeypatched: the bug this guards against lived entirely in the SQL text,
# which a monkeypatched fetch function can't exercise and a result-shape
# assertion can't catch either, since the broken query still returns a
# well-formed, just wrong, answer.


def _engine_with_a_sales_order_with_two_lines_for_the_same_product():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                'CREATE TABLE "stock_movements" (id TEXT, "organizationId" TEXT, '
                '"salesOrderId" TEXT, "productId" TEXT, "locationId" TEXT, type TEXT, '
                'quantity INTEGER, "unitPriceCents" INTEGER, reason TEXT, "createdAt" TEXT)'
            )
        )
        conn.execute(
            text(
                'CREATE TABLE "sales_order_lines" (id TEXT, "salesOrderId" TEXT, '
                '"productId" TEXT, "unitPriceCents" INTEGER)'
            )
        )
        conn.execute(text('CREATE TABLE "products" (id TEXT, sku TEXT, name TEXT)'))
        conn.execute(text('CREATE TABLE "locations" (id TEXT, name TEXT)'))

        created_at = "2026-08-15T00:00:00+00:00"
        # One order, one product, two lines (5 @ $10.00, 3 @ $12.00):
        # fulfilling posts one SALE movement per line, each already carrying
        # its own price -- the ordinary case on the current schema, not an
        # edge case needing a missing-price fallback.
        conn.execute(
            text(
                'INSERT INTO "stock_movements" VALUES '
                "(:id, :org, :so, :p, :loc, :type, :qty, :price, :reason, :created)"
            ),
            [
                dict(id="m1", org="org_1", so="so_1", p="p_1", loc="l_1", type="SALE",
                     qty=-5, price=1000, reason=None, created=created_at),
                dict(id="m2", org="org_1", so="so_1", p="p_1", loc="l_1", type="SALE",
                     qty=-3, price=1200, reason=None, created=created_at),
            ],
        )
        conn.execute(
            text('INSERT INTO "sales_order_lines" VALUES (:id, :so, :p, :price)'),
            [
                dict(id="line_1", so="so_1", p="p_1", price=1000),
                dict(id="line_2", so="so_1", p="p_1", price=1200),
            ],
        )
        conn.execute(
            text('INSERT INTO "products" VALUES (:id, :sku, :name)'),
            [dict(id="p_1", sku="WIDGET-1", name="Widget")],
        )
        conn.execute(text('INSERT INTO "locations" VALUES (:id, :name)'), [dict(id="l_1", name="Main")])
    return engine


def test_trend_does_not_double_count_a_sales_order_with_two_lines_for_the_same_product():
    from app.services.reports import fetch_sales_stock_trend

    engine = _engine_with_a_sales_order_with_two_lines_for_the_same_product()
    since = datetime(2026, 8, 1, tzinfo=timezone.utc)
    with engine.connect() as conn:
        rows = fetch_sales_stock_trend(conn, "org_1", since)

    assert len(rows) == 1
    # 5 + 3 units sold, not 16 -- the fan-out this guards against counted
    # each movement once per matching sales-order line.
    assert int(rows[0]["units_sold"]) == 8
    assert int(rows[0]["revenue_cents"]) == 5 * 1000 + 3 * 1200


def test_movements_export_does_not_duplicate_a_row_for_a_sales_order_with_two_lines_for_the_same_product():
    from app.services.export import fetch_movement_rows

    engine = _engine_with_a_sales_order_with_two_lines_for_the_same_product()
    since = datetime(2026, 8, 1, tzinfo=timezone.utc)
    with engine.connect() as conn:
        rows = fetch_movement_rows(conn, "org_1", since)

    # One row per movement, not one row per (movement x matching line).
    assert len(rows) == 2
    assert {row["quantity"] for row in rows} == {-5, -3}


# --- Products and stock exports, against a real engine ---------------------
#
# Every other query in app/services touched by this test file gets exercised
# against real SQL somewhere in here; fetch_products_rows and
# fetch_stock_rows were only ever hit through a monkeypatch at the route
# layer (test_export_products_returns_csv and friends), so a column-name
# typo or a join that silently dropped or duplicated a row would pass the
# whole suite. These run the actual SQL text, the same way the fan-out
# tests above do.


def test_fetch_products_rows_scopes_to_the_organization_and_joins_the_category():
    from app.services.export import fetch_products_rows

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE "categories" (id TEXT, name TEXT)'))
        conn.execute(
            text(
                'CREATE TABLE "products" (id TEXT, "organizationId" TEXT, sku TEXT, '
                'name TEXT, "categoryId" TEXT, "costCents" INTEGER, "priceCents" INTEGER, '
                '"reorderPoint" INTEGER, "reorderQty" INTEGER, "isActive" INTEGER)'
            )
        )
        conn.execute(text('INSERT INTO "categories" VALUES (:id, :name)'), [dict(id="c_1", name="Gadgets")])
        conn.execute(
            text(
                'INSERT INTO "products" VALUES '
                "(:id, :org, :sku, :name, :cat, :cost, :price, :rp, :rq, :active)"
            ),
            [
                # Scoped to org_1, with a category -- the row this test asserts on.
                dict(id="p_1", org="org_1", sku="WIDGET-1", name="Widget", cat="c_1",
                     cost=500, price=999, rp=5, rq=20, active=1),
                # No category -- the LEFT JOIN must not drop it.
                dict(id="p_2", org="org_1", sku="GIZMO-1", name="Gizmo", cat=None,
                     cost=100, price=250, rp=2, rq=10, active=1),
                # A different organization -- must not appear in org_1's export.
                dict(id="p_3", org="org_2", sku="OTHER-1", name="Other Co's Widget", cat="c_1",
                     cost=1, price=1, rp=1, rq=1, active=1),
            ],
        )
    with engine.connect() as conn:
        rows = fetch_products_rows(conn, "org_1")

    assert {row["sku"] for row in rows} == {"WIDGET-1", "GIZMO-1"}
    widget = next(row for row in rows if row["sku"] == "WIDGET-1")
    assert widget["category"] == "Gadgets"
    gizmo = next(row for row in rows if row["sku"] == "GIZMO-1")
    assert gizmo["category"] is None


def test_fetch_stock_rows_scopes_to_the_organization_and_joins_product_and_location():
    from app.services.export import fetch_stock_rows

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE "products" (id TEXT, sku TEXT, name TEXT)'))
        conn.execute(text('CREATE TABLE "locations" (id TEXT, name TEXT)'))
        conn.execute(
            text(
                'CREATE TABLE "inventory_items" (id TEXT, "organizationId" TEXT, '
                '"productId" TEXT, "locationId" TEXT, quantity INTEGER)'
            )
        )
        conn.execute(text('INSERT INTO "products" VALUES (:id, :sku, :name)'), [dict(id="p_1", sku="WIDGET-1", name="Widget")])
        conn.execute(text('INSERT INTO "locations" VALUES (:id, :name)'), [dict(id="l_1", name="Main")])
        conn.execute(
            text('INSERT INTO "inventory_items" VALUES (:id, :org, :p, :loc, :qty)'),
            [
                dict(id="i_1", org="org_1", p="p_1", loc="l_1", qty=42),
                # A different organization's stock of the same product/location
                # must not leak into org_1's export.
                dict(id="i_2", org="org_2", p="p_1", loc="l_1", qty=999),
            ],
        )
    with engine.connect() as conn:
        rows = fetch_stock_rows(conn, "org_1")

    assert len(rows) == 1
    assert rows[0]["sku"] == "WIDGET-1"
    assert rows[0]["location"] == "Main"
    assert int(rows[0]["quantity"]) == 42
