from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Every query here is filtered by organizationId, mirroring the tenant
# isolation rule the Node API enforces at its middleware layer (PRD §7) —
# this service reads the same multi-tenant tables, so it re-applies the
# same filter rather than trusting the caller's SQL to be scoped already.

_PRODUCTS_SQL = text(
    """
    SELECT
        p."sku" AS sku,
        p."name" AS name,
        c."name" AS category,
        p."costCents" AS cost_cents,
        p."priceCents" AS price_cents,
        p."reorderPoint" AS reorder_point,
        p."reorderQty" AS reorder_qty,
        p."isActive" AS is_active
    FROM "products" p
    LEFT JOIN "categories" c ON c."id" = p."categoryId"
    WHERE p."organizationId" = :organization_id
    ORDER BY p."name"
    """
)


def fetch_products_rows(conn: Connection, organization_id: str) -> list[dict[str, Any]]:
    result = conn.execute(_PRODUCTS_SQL, {"organization_id": organization_id})
    return [dict(row) for row in result.mappings().all()]


_STOCK_SQL = text(
    """
    SELECT
        p."sku" AS sku,
        p."name" AS product_name,
        l."name" AS location,
        i."quantity" AS quantity
    FROM "inventory_items" i
    JOIN "products" p ON p."id" = i."productId"
    JOIN "locations" l ON l."id" = i."locationId"
    WHERE i."organizationId" = :organization_id
    ORDER BY p."name", l."name"
    """
)


def fetch_stock_rows(conn: Connection, organization_id: str) -> list[dict[str, Any]]:
    result = conn.execute(_STOCK_SQL, {"organization_id": organization_id})
    return [dict(row) for row in result.mappings().all()]


_MOVEMENTS_SQL = text(
    """
    SELECT
        sm."createdAt" AS created_at,
        p."sku" AS sku,
        p."name" AS product_name,
        l."name" AS location,
        sm."type" AS type,
        sm."quantity" AS quantity,
        -- Same precedence as the trend report: the movement's own price
        -- first, the sales order line second for rows written before
        -- stock_movements carried a price at all.
        COALESCE(sm."unitPriceCents", sol."unitPriceCents") AS unit_price_cents,
        sm."reason" AS reason
    FROM "stock_movements" sm
    JOIN "products" p ON p."id" = sm."productId"
    JOIN "locations" l ON l."id" = sm."locationId"
    -- Collapsed to one fallback price per (salesOrderId, productId) before
    -- the join, same reason and same shape as the trend report's _TREND_SQL
    -- above it in this module's sibling file: a sales order can carry two
    -- lines for the same product, and joining straight to
    -- "sales_order_lines" would otherwise turn one movement row into one row
    -- per matching line in this export.
    LEFT JOIN (
        SELECT "salesOrderId", "productId", MAX("unitPriceCents") AS "unitPriceCents"
        FROM "sales_order_lines"
        GROUP BY "salesOrderId", "productId"
    ) sol
        ON sol."salesOrderId" = sm."salesOrderId" AND sol."productId" = sm."productId"
    WHERE sm."organizationId" = :organization_id
      AND sm."createdAt" >= :since
    ORDER BY sm."createdAt" DESC
    """
)


def fetch_movement_rows(conn: Connection, organization_id: str, since) -> list[dict[str, Any]]:
    result = conn.execute(_MOVEMENTS_SQL, {"organization_id": organization_id, "since": since})
    return [dict(row) for row in result.mappings().all()]
