import { PrismaClient } from "@prisma/client";

declare global {
  // `var` is the only declaration form that augments globalThis; `let` and
  // `const` don't. ESLint's no-var doesn't flag ambient declarations, so
  // this needs no suppression comment.
  var __prisma: PrismaClient | undefined;
}

// Reuse a single client across hot reloads in dev to avoid exhausting
// Postgres connections.
export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
