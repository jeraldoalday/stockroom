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
#
# The fallback joins on (salesOrderId, productId), not a specific line id,
# because the movement itself only ever recorded those two — but nothing
# stops a sales order from carrying two lines for the same product (adding a
# product that's already on the order is a legitimate edit, not a rejected
# one; see salesOrders.routes.ts). Joining straight to "sales_order_lines" in
# that case fans a single stock_movement row out to one row per matching
# line, and every aggregate below counts it that many times over — a sale
# of 5 units reported as 10 sold at double the revenue, from an order that
# was fulfilled correctly and whose own inventory math was never wrong. The
# subquery collapses each (salesOrderId, productId) pair to a single
# fallback price first, so the join above it can never multiply a row no
# matter how many lines share that pair; it's a no-op for the ordinary case
# of one line per product.
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
    LEFT JOIN (
        SELECT "salesOrderId", "productId", MAX("unitPriceCents") AS "unitPriceCents"
        FROM "sales_order_lines"
        GROUP BY "salesOrderId", "productId"
    ) sol
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
