import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// The app reads `import.meta.env.VITE_API_URL` at module scope in
// api/client.ts, so it has to be defined before the first import of it.
// Vite resolves `import.meta.env` statically at transform time from the
// loaded .env files; under Vitest there is no .env, so without this every
// request URL would be built from `undefined`.
vi.stubEnv("VITE_API_URL", "http://api.test/api");

// This jsdom version's Blob (and File, which extends it) has no `.text()` —
// real browsers have had it for years, and ProductsPage's CSV import relies
// on it (`file.text()` in handleImport). FileReader is implemented, so it
// stands in as the polyfill rather than skipping CSV-import coverage
// entirely or reaching for a real network File API that doesn't exist here.
if (typeof Blob !== "undefined" && !Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

beforeEach(() => {
  // Tokens and the cached user live in localStorage, and jsdom keeps one
  // instance for the whole file. Leaking a token from a signed-in test into
  // the next one is the classic way a suite like this starts passing for
  // the wrong reason.
  localStorage.clear();

  // This jsdom version also has no URL.createObjectURL/revokeObjectURL
  // (real browsers have had both for years). Every CSV-download path --
  // ReportsPage's exports, StocktakesPage's count-sheet export -- calls
  // them to turn a blob into a clickable link, so this was a one-off local
  // stub in ReportsPage.test.tsx until a second caller showed up and made
  // it worth sharing.
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
