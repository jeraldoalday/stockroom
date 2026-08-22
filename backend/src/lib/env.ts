import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // How often the API process sweeps expired token rows. Hourly by default:
  // the table is housekeeping, not something anyone waits on, and a sweep
  // that runs while the process is otherwise idle costs nothing.
  tokenPruneIntervalMs: Number(process.env.TOKEN_PRUNE_INTERVAL_MS ?? 60 * 60 * 1000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  // The Python service is never exposed to the frontend directly (it talks
  // only to this API); these let the reports routes proxy to it internally.
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000",
  pythonServiceInternalKey: process.env.PYTHON_SERVICE_INTERNAL_KEY ?? "dev-internal-key",
};
