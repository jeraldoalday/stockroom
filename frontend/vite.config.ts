/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// One config for both the build and the test run. Vitest reads the same
// `plugins` array, so the JSX transform under test is byte-for-byte the one
// that ships — a separate vitest.config.ts would be a second place for the
// two to drift apart.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    // No injected globals: every suite imports `describe`/`it`/`expect`
    // from "vitest" explicitly, so `tsc -b` type-checks the tests with the
    // rest of `src` without a special `types` entry to keep in sync.
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    // Component tests import from `src/`; anything under `src/test/` is
    // scaffolding, not a suite.
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/vite-env.d.ts"],
    },
  },
});
