from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

# F11: a basic sales/stock trend — daily units sold vs. received, plus
# revenue where it can be attributed. Revenue is only known for SALE
# movements that came from fulfilling a sales order (they carry a
# salesOrderId we can join back to the line's unitPriceCents); a SALE
# movement recorded directly via POST /stock-movements has no order line
# and so contributes 0 revenue — that's a real gap in the data model, not
# a bug in this query, and is called out in PROGRESS.md.
_TREND_SQL = text(
    """
    SELECT
        DATE(sm."createdAt") AS day,
        COALESCE(SUM(CASE WHEN sm."type" = 'SALE' THEN -sm."quantity" ELSE 0 END), 0) AS units_sold,
        COALESCE(SUM(CASE WHEN sm."type" = 'RECEIVE' THEN sm."quantity" ELSE 0 END), 0) AS units_received,
        COALESCE(
            SUM(
                CASE WHEN sm."type" = 'SALE' THEN -sm."quantity" * COALESCE(sol."unitPriceCents", 0) ELSE 0 END
            ),
            0
        ) AS revenue_cents
    FROM "stock_movements" sm
    LEFT JOIN "sales_order_lines" sol
        ON sol."salesOrderId" = sm."salesOrderId" AND sol."productId" = sm."productId"
    WHERE sm."organizationId" = :organization_id
      AND sm."createdAt" >= :since
    GROUP BY DATE(sm."createdAt")
    ORDER BY day
    """
)


def fetch_sales_stock_trend(conn: Connection, organization_id: str, since) -> list[dict[str, Any]]:
    result = conn.execute(_TREND_SQL, {"organization_id": organization_id, "since": since})
    return [dict(row) for row in result.mappings().all()]
