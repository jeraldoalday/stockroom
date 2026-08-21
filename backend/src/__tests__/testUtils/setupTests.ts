// Runs after the test framework is installed, so it can register hooks.
//
// Rate limiters are module-level singletons (they have to outlive a single
// request to count anything), which means a test that deliberately trips
// the login limiter would otherwise leave every later test in the same file
// getting a 429. Clearing them between cases keeps each test independent.
// Only lib/rateLimit is imported here — pulling in a route module would drag
// the real Prisma client into test files that deliberately mock it.
import { __resetAllRateLimiters } from "../../lib/rateLimit";

beforeEach(() => {
  __resetAllRateLimiters();
});
