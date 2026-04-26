@.claude/CONTEXT.md

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:build-check-rules -->
# Local build after client-router hook changes

Always run `npx next build` locally before pushing any change that introduces, moves, or modifies a client-router hook call — `useSearchParams`, `usePathname`, `useRouter`, or any other hook that forces client-side rendering on a page that was previously static.

Why: in April 2026, a commit added `useSearchParams()` to `/incomplete` without wrapping the page in `<Suspense>`. The change typechecked and linted clean. Next 16's static prerender failed only at build time on Vercel, silently blocking four consecutive deploys for ~3 hours before anyone noticed the CDN was serving stale code. `npx tsc --noEmit` and `npx eslint` do not catch this class of bug; only `next build` does.

Rule: if your diff touches client-router hooks, run a local build before `git push`. Non-negotiable.
<!-- END:build-check-rules -->

<!-- BEGIN:silent-failure-rules -->
# Make invalid states crash loudly, not redirect silently

When state that "shouldn't happen" happens anyway, surface it. Don't paper over it with a fallback that routes the user somewhere harmless.

Two concrete incidents illustrate the cost:

1. The `/apply/page.tsx` `setPhase(selectedType ? "upload" : "landing")` fallback: someone knew a null `selectedType` could reach OTP-verify, chose a fallback instead of fixing the upstream cause. The fallback silently bounced users to a dead-end and created 22 zombie draft rows over 3 weeks before anyone noticed.
2. The missing `<Suspense>` boundary (see build-check-rules): "it'll probably work" without verifying. Didn't.

Pattern: when you reach a branch that represents impossible state, prefer `console.error` + user-facing toast + safe fallback route, not just a silent safe route. The error log gets seen in Sentry; silent redirects don't.
<!-- END:silent-failure-rules -->
