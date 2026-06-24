// Pre-commit-only ESLint config. Used by lint-staged (see package.json),
// NOT by your editor or `npm run lint` — those use eslint.config.mjs and keep
// full-file linting so you still SEE every error.
//
// Why this exists: the repo carries ~300 pre-existing errors (mostly
// @typescript-eslint/no-explicit-any in fragile payment / zoho / apply code).
// Whole-file lint-staged surfaced all of them on every commit touching a legacy
// file, which created constant pressure to bypass the hook with `--no-verify`
// (see BACKLOG.md "Tooling: lint-staged scope" and the lint/type-debt rows).
//
// eslint-plugin-diff's `flat/staged` config wraps every file in a processor that
// filters lint messages down to lines present in `git diff --staged`. Result:
// the hook only blocks on problems you actually introduced in this commit, while
// legacy debt on untouched lines stays out of your way. `--fix` only touches the
// staged lines too.
//
// The base config is reused verbatim, so any rule change in eslint.config.mjs
// automatically applies here. The diff entry MUST come last so its processor wins.
import baseConfig from "./eslint.config.mjs";
import { configs } from "eslint-plugin-diff";

export default [
  ...baseConfig,
  ...configs["flat/staged"],
];
