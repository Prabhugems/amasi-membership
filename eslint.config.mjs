import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import security from "eslint-plugin-security";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  security.configs.recommended,
  {
    rules: {
      // Noisy: flags every arr[i] / obj[key] access.
      "security/detect-object-injection": "off",
    },
  },
  // react-hooks v6.1 (pulled in by lockfile regen in 2df301c) introduced two
  // rules that fire across the app. See TODO.md for the cleanup checklist.
  {
    files: ["src/app/apply/page.tsx"],
    rules: {
      // Single site: Date.now() in JSX at L1966. File-scoped off so the rule
      // keeps protecting the rest of the repo.
      "react-hooks/purity": "off",
    },
  },
  {
    rules: {
      // 21 files trip this — most are legitimate patterns (URL state sync,
      // realtime subscriptions, search debouncing). Downgraded to warn so it
      // surfaces in CI/editor without blocking commits.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
