from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

# F11: a basic sales/stock trend — daily units sold vs. received, plus
# revenue.
#
# Revenue used to be recoverable only by joining back to a sales order line,
# so a SALE recorded directly via POST /stock-movements — a counter sale,
# which is the common case for a shop — contributed units but zero revenue
# and silently understated takings. StockMovement now carries its own
# unitPriceCents, and this prefers it.
#
# The join is kept as a fallback rather than removed, because movements
# written before that column existed genuinely have no price of their own.
# COALESCE picks the movement's price first and the line's second, so old
# rows keep reporting exactly what they reported before and new ones are
# right whether or not an order was involved.
_TREND_SQL = text(
    """
    SELECT
        DATE(sm."createdAt") AS day,
        COALESCE(SUM(CASE WHEN sm."type" = 'SALE' THEN -sm."quantity" ELSE 0 END), 0) AS units_sold,
        COALESCE(SUM(CASE WHEN sm."type" = 'RECEIVE' THEN sm."quantity" ELSE 0 END), 0) AS units_received,
        COALESCE(
            SUM(
                CASE
                    WHEN sm."type" = 'SALE'
                    THEN -sm."quantity" * COALESCE(sm."unitPriceCents", sol."unitPriceCents", 0)
                    ELSE 0
                END
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
