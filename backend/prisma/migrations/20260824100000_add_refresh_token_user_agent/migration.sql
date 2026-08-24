-- AlterTable
-- Nullable, and left null for every existing row: there is no way to
-- recover the User-Agent a past login used, and the session list already
-- has to handle a session with no recorded device.
ALTER TABLE "refresh_tokens" ADD COLUMN "userAgent" TEXT;
