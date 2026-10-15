// ESLint flat config (T-TRU-06 owner). TypeScript via typescript-eslint
// recommended rules without type-aware linting (typecheck owns types;
// lint owns syntax and scars). S9 void-discard is an ast-grep rule with a
// statement-shape pattern; the generic no-void fires on idiomatic floating
// promises, so it stays off here. no-unused-vars stays off: Knip owns dead
// code with entry-point awareness; ESLint flags test fixtures, dual
// test/type imports, and intentional interface args. Rules whose only
// offenders are test fixtures are scoped to test globs instead of being
// switched off repo-wide. Run: yarn eslint .
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
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
      ".tmp/**",
      ".ocr-audit/**",
      "coverage/**",
      "**/build/**",
      "**/out/**",
      ".turbo/**",
      "**/*.tsbuildinfo",
      "apps/desktop/e2e/**",
      "apps/desktop/journeys/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    languageOptions: {
      // The runtime globals the app's Node main/preload and renderer halves
      // run on. no-undef stays off (typescript-eslint owns identifiers), so
      // these declarations exist for no-global-assign: overwriting
      // console/process/timers is an error even when nothing declares them.
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
      // S5: no swallowed errors, no empty catches, and every rethrow keeps
      // its cause instead of dropping the original failure (batch-50).
      "no-empty": ["error", { allowEmptyCatch: false }],
      "preserve-caught-error": "error",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  {
    // Test fixtures deliberately reassign locals and spell escaped strings;
    // production code keeps prefer-const, no-useless-assignment and
    // no-regex-spaces (batch-50).
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.test-support.ts"],
    rules: {
      "prefer-const": "off",
      "no-useless-assignment": "off",
      "no-regex-spaces": "off",
      "no-useless-escape": "off",
    },
  },
];
