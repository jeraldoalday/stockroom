// Flat config (ESLint 9). The `lint` script has existed since Day 1 but
// ESLint itself was never installed and no config was ever written, so
// `npm run lint` failed with "command not found" — which is why the
// `eslint-disable-next-line` comments scattered through the source have
// never actually suppressed anything.
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        Response: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      // The tenant boundary is enforced with `req.auth!.organizationId` in
      // every route, after requireAuth has guaranteed it — banning the
      // assertion outright would mean threading an Optional through every
      // handler for no safety gain.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Not in eslint:recommended, and worth having in a TypeScript
      // codebase. It doesn't flag the ambient `declare global` block in
      // lib/prisma.ts, which genuinely needs `var`.
      "no-var": "error",
      // Deliberately-discarded values (the `costCents` a STAFF caller isn't
      // allowed to set) are named with a leading underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // The in-memory Prisma mock stands in for a client whose real types are
    // generated; modelling them faithfully would be a second implementation
    // of Prisma's type surface, so `any` is the honest choice there.
    files: ["src/lib/__mocks__/**/*.ts", "src/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/__tests__/**/*.ts"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly",
      },
    },
  }
);
