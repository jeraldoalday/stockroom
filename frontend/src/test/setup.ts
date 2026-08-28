import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// The app reads `import.meta.env.VITE_API_URL` at module scope in
// api/client.ts, so it has to be defined before the first import of it.
// Vite resolves `import.meta.env` statically at transform time from the
// loaded .env files; under Vitest there is no .env, so without this every
// request URL would be built from `undefined`.
vi.stubEnv("VITE_API_URL", "http://api.test/api");

beforeEach(() => {
  // Tokens and the cached user live in localStorage, and jsdom keeps one
  // instance for the whole file. Leaking a token from a signed-in test into
  // the next one is the classic way a suite like this starts passing for
  // the wrong reason.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});
