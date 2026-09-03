-- F15 — physical stock counts. See the Stocktake/StocktakeLine comments in
-- schema.prisma for why the count is scoped to one location and why
-- countedQty is nullable rather than defaulting to zero.

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),
    "appliedDelta" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "stocktakeId" TEXT;

-- CreateIndex
CREATE INDEX "stocktakes_organizationId_idx" ON "stocktakes"("organizationId");

-- CreateIndex
-- The list screen's default view is "open counts", so status is filtered
-- alongside the tenant on nearly every read.
CREATE INDEX "stocktakes_organizationId_status_idx" ON "stocktakes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "stocktakes_locationId_idx" ON "stocktakes"("locationId");

-- CreateIndex
CREATE INDEX "stocktake_lines_stocktakeId_idx" ON "stocktake_lines"("stocktakeId");

-- CreateIndex
-- One line per product per count. A sheet listing the same SKU twice would
-- let two counters disagree with no way to say which figure wins.
CREATE UNIQUE INDEX "stocktake_lines_stocktakeId_productId_key" ON "stocktake_lines"("stocktakeId", "productId");

-- CreateIndex
CREATE INDEX "stock_movements_stocktakeId_idx" ON "stock_movements"("stocktakeId");

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
