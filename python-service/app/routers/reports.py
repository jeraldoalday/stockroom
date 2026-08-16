from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import StringIO

import pandas as pd
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.engine import Connection

from app.config import settings
from app.db import get_db
from app.services.export import fetch_movement_rows, fetch_products_rows, fetch_stock_rows
from app.services.reports import fetch_sales_stock_trend

router = APIRouter()


def require_internal_caller(x_internal_key: str | None = Header(default=None)) -> None:
    if x_internal_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Missing or invalid internal API key")


def _csv_response(rows: list[dict], filename: str) -> Response:
    df = pd.DataFrame(rows)
    buffer = StringIO()
    df.to_csv(buffer, index=False)
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/products", dependencies=[Depends(require_internal_caller)])
def export_products(organization_id: str = Query(...), conn: Connection = Depends(get_db)) -> Response:
    rows = fetch_products_rows(conn, organization_id)
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
