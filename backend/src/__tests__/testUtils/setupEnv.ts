// Runs before the test framework is installed. src/lib/env.ts throws if
// these are missing, and app.ts is imported (transitively) by every route
// test, so they must be set before any import happens.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/stockroom_test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
process.env.JWT_ACCESS_TTL ??= "15m";
process.env.JWT_REFRESH_TTL ??= "7d";
process.env.CORS_ORIGIN ??= "http://localhost:5173";
