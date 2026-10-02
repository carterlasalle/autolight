// ESLint flat config (T-TRU-06 owner). TypeScript via typescript-eslint
// recommended rules without type-aware linting (typecheck owns types;
// lint owns syntax and scars). S9 void-discard is an ast-grep rule with a
// statement-shape pattern; the generic no-void fires on idiomatic floating
// promises, so it stays off here. no-unused-vars stays off: Knip owns dead
// code with entry-point awareness; ESLint flags test fixtures, dual
// test/type imports, and intentional interface args. Run: yarn eslint .
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.map",
      "**/.venv/**",
      ".bughunt/**",
      ".omp/**",
      "analysis/.venv/**",
      "apps/desktop/e2e/**",
      "apps/desktop/journeys/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        BigInt: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      // S5: no swallowed errors, no empty catches.
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "preserve-caught-error": "off",
      "prefer-const": "off",
      "no-useless-escape": "off",
      "no-regex-spaces": "off",
      "no-useless-assignment": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
    },
  },
);
