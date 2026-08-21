-- AddForeignKey
-- `sales_orders.locationId` has always held a real location id, but nothing
-- at the database level required it to: the column was declared without a
-- relation, so deleting a location could leave orders pointing at a row
-- that no longer existed. The application checks for this on the delete
-- path; this makes it true regardless of which path does the deleting.
--
-- RESTRICT rather than CASCADE deliberately: an order is a business record
-- and must not disappear because someone tidied up a location. The delete
-- is refused instead, which is what locations.routes.ts already reports.
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
-- The constraint is checked on every location delete, and the route also
-- counts orders per location before archiving one.
CREATE INDEX "sales_orders_locationId_idx" ON "sales_orders"("locationId");
