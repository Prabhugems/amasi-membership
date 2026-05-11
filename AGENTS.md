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

<!-- BEGIN:admin-ui-gating -->
# Admin UI gating

Any link, button, or nav element pointing to `/admin/*` or `/` (admin dashboard root), or labeled with admin terminology ("Admin Dashboard", "Admin Panel", admin route names like "Members"/"Search" when used as nav rather than feature labels), MUST be wrapped in a `useAdminRole()` null-gate before rendering.

Canonical hook: `src/hooks/use-admin-role.ts`. Module-level cache, fetches `/api/auth/me` once per session, shared across all subscribers.

Pattern:

```tsx
import { useAdminRole } from "@/hooks/use-admin-role"

function SomeComponent() {
  const adminRole = useAdminRole()
  // ...
  return (
    <>
      {/* always-visible UI */}
      {adminRole && (
        <Link href="/admin">Admin panel</Link>
      )}
    </>
  )
}
```

`adminRole === null` covers both "still resolving /api/auth/me" AND "not an admin." This gives non-admins zero flicker (the element is never rendered for them) and accepts a brief flicker for actual admins on first paint — same trade-off as the global Sidebar (`1ebc008`).

This is **info-leak hygiene, not security**. Middleware (`src/middleware.ts`) redirects non-admin requests to `/` to `/apply` and 401s `/admin/*` API calls. The point is to stop advertising the admin surface to members in their portal UI — labels and route names should not be visible to people who can't use them.

Incidents this prevents (recurrence pattern observed 3× in this codebase):
- Global Sidebar rendered admin nav on every public page until `1ebc008` (May 2026).
- `/member` portal sidebar showed "Admin Dashboard" link unconditionally to every Life Member until `ec3ec46`+follow-up (May 2026).
- A new commit adding any admin-route link in a member-facing or public page would silently regress this. Hence the convention.

Existing components that follow this pattern correctly (reference for new code):
- `src/components/layout/sidebar.tsx` — `if (adminRole === null) return null` at component top
- `src/components/ui/admin-back-link.tsx` — same shape, inline auth fetch (predates the shared hook; functionally equivalent)
- `src/app/member/page.tsx` footer — `{adminRole && <a href="/">...</a>}`
<!-- END:admin-ui-gating -->
