// Flat config (ESLint 9). Like the backend's, the `lint` script here has
// existed since Day 1 with nothing behind it — ESLint was never a
// dependency, so `npm run lint` failed outright and nothing has ever been
// linted.
//
// react-hooks is the rule set that earns its keep in this codebase: the
// pages are full of `useQuery`/`useMutation` callbacks closing over state,
// and a missing dependency there shows up as a stale filter or a page that
// won't refresh, not as a crash.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // The provider and its `useAuth` accessor belong in one file — the hook
    // is the only supported way to read this context, and splitting them
    // just to satisfy a dev-server refresh optimisation would make the
    // context's contract harder to find, not easier.
    files: ["src/context/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  }
);
