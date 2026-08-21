-- AlterTable
-- Nullable with no default and no backfill: existing SALE movements have no
-- recorded price, and inventing one (from the product's current price, say)
-- would put a number in the audit trail that nobody ever charged. The trend
-- report falls back to the sales order line for those, exactly as before.
ALTER TABLE "stock_movements" ADD COLUMN "unitPriceCents" INTEGER;
