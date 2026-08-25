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
  smtp: buildSmtpConfig(),
};

// SMTP is opt-in: unset SMTP_HOST and the app falls back to logging emails
// to the console (see lib/email.ts), same as every session before this one.
// Set it to switch on real delivery through any provider that speaks SMTP.
function buildSmtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return undefined;
  }
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? "StockRoom <no-reply@stockroom.app>",
  };
}
