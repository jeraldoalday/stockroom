-- AlterTable
-- Defaulting to true backfills every existing row as active, which is what
-- they all are: nothing could be archived before this column existed.
ALTER TABLE "locations" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
