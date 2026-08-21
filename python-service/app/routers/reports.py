from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.engine import Connection

from app.config import settings
from app.db import get_db
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
    if x_internal_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Missing or invalid internal API key")


def _csv_response(rows: list[dict[str, Any]], filename: str) -> Response:
    df = pd.DataFrame(rows)
    buffer = StringIO()
    df.to_csv(buffer, index=False)
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
