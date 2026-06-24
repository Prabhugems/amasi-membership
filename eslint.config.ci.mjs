// CI-only ESLint config. Used by the `lint` job in .github/workflows/test.yml,
// NOT by your editor, `npm run lint`, or the pre-commit hook.
//
// Why a third config: the repo carries ~300 pre-existing errors, so a normal
// full-repo `eslint .` in CI would fail every PR on legacy debt. This config
// layers eslint-plugin-diff's `flat/diff` processor, which filters lint messages
// down to lines changed relative to the PR's base branch. The base ref is passed
// in via the ESLINT_PLUGIN_DIFF_COMMIT env var (set to `origin/<base>` by the
// workflow), and `git diff <base> -- <file>` decides which lines count.
//
// Net effect: a PR's lint job blocks only on problems the PR itself introduces,
// while the legacy baseline stays out of the way. This mirrors the pre-commit
// hook (eslint.config.staged.mjs, which uses `flat/staged`) but compares against
// the base branch instead of the git index — the right granularity for CI, where
// a branch may contain many commits.
//
// The base config is reused verbatim; the diff entry MUST come last so its
// processor wins.
import baseConfig from "./eslint.config.mjs";
import { configs } from "eslint-plugin-diff";

export default [
  ...baseConfig,
  ...configs["flat/diff"],
];
