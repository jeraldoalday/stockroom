import { prisma } from "../../lib/prisma";

interface ResettablePrismaMock {
  __reset: () => void;
}

/**
 * Clears the in-memory Prisma store between tests.
 *
 * Import path matters here. A test file activates the manual mock with
 * `jest.mock("../lib/prisma")`, which makes *that module id* resolve to
 * `lib/__mocks__/prisma`. Importing `lib/__mocks__/prisma` directly instead
 * registers a second copy of the module under a different id, with its own
 * `tables` — so the reset ran against a store nobody was reading. That was
 * silent: every test still passed, because the suite had grown the habit of
 * giving each test unique emails and SKUs to route around the leftover rows.
 *
 * Resolving `prisma` through the same "../../lib/prisma" specifier the
 * routes use guarantees we hold the store under test, and the explicit
 * check below turns "you forgot jest.mock()" into a loud failure rather than
 * a reset that quietly does nothing.
 */
export function resetPrismaMock() {
  const client = prisma as unknown as Partial<ResettablePrismaMock>;
  if (typeof client.__reset !== "function") {
    throw new Error(
      'resetPrismaMock() requires jest.mock("../lib/prisma") at the top of the test file'
    );
  }
  client.__reset();
}
