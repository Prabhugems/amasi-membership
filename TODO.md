# Lint Cleanup TODO

Tracking files where react-hooks v6.1 rules were suppressed/downgraded
to unblock the Sentry AMASI-MEMBERSHIP-9 hydration fix.

Each item should be reviewed: most are likely legitimate React patterns
that just need restructuring (e.g. derive state from props/URL instead of
syncing in an effect). Once a section is clean, raise that file's rule
back to error via a file-scoped override.

When all are clean, remove the repo-wide warn downgrade and the
apply/page.tsx purity override.

## react-hooks/purity (file-scoped off)

Single site. Override scoped to one file.

- [ ] `src/app/apply/page.tsx` — L1966: `Date.now()` in JSX (welcome-back banner)

## react-hooks/set-state-in-effect (repo-wide warn)

Line numbers are HEAD as of this TODO. Note: `src/app/apply/page.tsx` gains
one more violation (L373, the new restore effect from the hydration fix) —
that one is intentional and the canonical "restore from localStorage post-mount"
pattern; document it as an exemption when refactoring rather than rewriting it.

### Apply flow

- [ ] `src/app/apply/page.tsx` — L377 (review-missing-fields effect), L417 (resume-draft effect), and L373 once the hydration fix lands (intentional restore effect)
- [ ] `src/app/apply/resubmit/page.tsx` — L227
- [ ] `src/app/apply/status/page.tsx` — L703

### Member-facing pages

- [ ] `src/app/member/page.tsx` — L96, L1288, L1305, L1363, L1961
- [ ] `src/app/membership/page.tsx` — L42
- [ ] `src/app/page.tsx` — L192
- [ ] `src/app/profile/page.tsx` — L45

### Admin

- [ ] `src/app/admin/page.tsx` — L97
- [ ] `src/app/admin/api-keys/page.tsx` — L58 (security-sensitive; refactor with care)

### Other pages

- [ ] `src/app/incomplete/page.tsx` — L210
- [ ] `src/app/reports/page.tsx` — L241
- [ ] `src/app/search/page.tsx` — L721, L727, L806
- [ ] `src/app/support/feedback/page.tsx` — L33

### Components

- [ ] `src/components/command/command-palette.tsx` — L69, L79
- [ ] `src/components/dashboard/dashboard-header.tsx` — L84

### Providers (wrap the whole app — review carefully)

- [ ] `src/components/providers/focus-mode-provider.tsx` — L32
- [ ] `src/components/providers/sidebar-provider.tsx` — L23
- [ ] `src/components/providers/theme-provider.tsx` — L62

### Hooks

- [ ] `src/hooks/use-realtime-count.ts` — L19
- [ ] `src/hooks/use-recent-routes.ts` — L61, L69
