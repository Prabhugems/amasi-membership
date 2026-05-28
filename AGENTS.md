@.claude/CONTEXT.md

<!-- BEGIN:ui-work-rules -->
# UI work — read this BEFORE building any screen

We have a Tailwind Plus license. Every new admin or member screen starts from a Tailwind Plus block, not from imagination.

## 1. Reference workflow

- Before building or rewriting any screen, browse Tailwind Plus at https://tailwindcss.com/plus/ui-blocks/application-ui and find the closest matching block.
- When Prabhu pastes a Tailwind Plus React block, save the raw source under `design-references/tailwind-plus/<block-name>.tsx` (or `.html`) — this is **reference only**, never imported into production.
- Adapt the block into the screen file under `src/app/`, swapping Tailwind Plus' generic primitives for ours (see §2).
- Never design a screen from imagination. Always start from a Tailwind Plus reference or an existing component in `src/components/ui/`.

## 2. Adaptation rules (when adapting a Tailwind Plus block)

| Tailwind Plus uses                 | We use instead                                                    |
|------------------------------------|-------------------------------------------------------------------|
| Headless UI primitives (`@headlessui/react`) | shadcn primitives in `src/components/ui/` (Dialog, Button, Card, Badge, Input, Label, Textarea, Avatar) |
| Heroicons (`@heroicons/react/24/outline`) | `lucide-react` — already installed and used everywhere; pick the closest icon |
| Tailwind color classes (`bg-zinc-900`, `text-gray-500`) | CSS variables from `src/app/globals.css` (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-accent`, etc.) — never hardcode hex or zinc/gray scales |
| Hardcoded spacing in classes (`p-4`) | Tailwind spacing utilities are fine, but consistency: `gap-4` / `p-6` baselines; don't sprinkle one-off `p-[18px]` values |
| Tailwind `rounded-md` / `rounded-lg` | use `rounded-md` as the default for cards and inputs (matches our `--radius`); reserve `rounded-lg` for elevated dialogs |
| `bg-gradient-to-*` on cards        | **Forbidden** — solid `bg-card` + `border` only |

If a CSS variable doesn't exist for what you need, **add it to `src/app/globals.css` first**, then use it. Do not hardcode hex codes inline.

## 3. Design discipline

**Mood:** clinical-confident, like Linear or Stripe.
**Audience:** surgeons (admins) and AMASI administrators. Authoritative tool, not a consumer app.
**Brand consistency:** the mobile app (`~/amasi-admin`) follows the same Tailwind Plus reference workflow with an RN translation layer. Web and mobile should feel like the same product.

**Forbidden patterns (these scream "AI-generated"):**

- Gradient backgrounds on cards (use solid `bg-card` + 1px `border-border`)
- Purple/blue gradients anywhere
- Emoji as icons (use `lucide-react`)
- Generic "Welcome back, [User]!" hero greetings
- Centered hero text with two CTA buttons
- More than 2 font weights on one screen
- Borders thicker than 1px (`border` only, never `border-2`)
- Box shadows heavier than `shadow-sm` except on modals/popovers
- `rounded-full` pills for everything — use `rounded-md` for most things
- Stacking 3+ background colors on one screen
- "Inbox zero ✨" style cute copy or sparkle emoji

**Required patterns:**

- One accent color from CSS variables, used sparingly (focal numbers, primary buttons, key links)
- Hairline 1px borders (`border-border`) on every card
- Typography hierarchy: one display weight (e.g. `text-2xl font-bold`) + one body weight (`text-sm font-medium`). Stop there.
- Eyebrow + title pattern at the top of every page (`text-xs uppercase tracking-wider text-muted-foreground` above the title)
- Status shown as a small colored dot + lowercase text, not a filled chip
- Empty states: one icon in a `bg-muted border rounded-md` square + one dignified line of copy

## 4. Component sourcing (in order of preference)

1. Existing component in `src/components/ui/` — reuse, don't recreate.
2. Adapt a Tailwind Plus block per §2 — save the source to `design-references/tailwind-plus/`.
3. Adapt from shadcn blocks: https://ui.shadcn.com/blocks
4. Last resort: build from scratch following this skill, but justify why nothing matched.

## 5. Before committing UI work

- Run `npx tsc --noEmit` and `npx eslint` — both must pass.
- For any change that touches client-router hooks, run `npx next build` (see `build-check-rules` below).
- Open the screen in the browser and compare side-by-side against the Tailwind Plus block saved in `design-references/tailwind-plus/`. If it doesn't pass the "would Linear or Stripe ship this?" test, iterate before committing.

<!-- END:ui-work-rules -->

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

<!-- BEGIN:mobile-shim-known-gaps -->
# Mobile shim — known gaps (must close in future Flutter release)

The legacy mobile shim under `src/app/api/<legacy_name>/` answers the in-stores Flutter v1.0.4+2 binary's calls against both `application.amasi.org` (legacy hostname, restored via DNS 2026-05-27) and `membership.amasi.org`. It ships with one structural gap that cannot be closed by backend changes alone:

## `/api/final_step` cannot do Razorpay HMAC signature verification

**Why:** the binary's `_handlePaymentSuccess` callback (`lib/view/application/member_application.dart:52`, `:81`; `application_track_details.dart:170`, `:191`) does NOT forward `razorpay_signature` or `razorpay_order_id` as named form fields. The signature IS inside `payment_json` (the raw Razorpay event map), but Dio's `FormData.fromMap()` does not JSON-encode nested maps — it calls `.toString()` on them, producing a non-parseable Dart-Map-literal string. See `migration/MIGRATION_FINDINGS.md` §3 for the wire-shape proof.

**Current substitute:** `src/app/api/final_step/route.ts` calls `razorpay.orders.fetch(order_id)` + `razorpay.payments.fetch(payment_id)` server-side and verifies `order_id` / `amount` / `currency` / `status === "captured"` match the draft's expected values. The client-supplied `payment_status` field is IGNORED. This catches the legacy fraud surface (client claims "Success" when no payment captured), but it does NOT catch the replay attack where an attacker pays a different order on their own account and replays the resulting `payment_id` against someone else's draft — that requires the HMAC signature to bind payment ID to order ID cryptographically.

**Must-close-in:** the next Flutter release that touches the payment screen. Required Dart-side change:

```dart
// member_application.dart, application_track_details.dart — both call sites
void _handlePaymentSuccess(PaymentSuccessResponse response) async {
  bool success = await applicationController.getPaymentDetailsSend("final_step", {
    "id": applicationController.userId,
    "amount": applicationController.createOrderData.value.amount,
    "currency": applicationController.createOrderData.value.currency,
    "payment_status": "Success",
    "payment_id": response.paymentId,
    "payment_json": response.data,
    // ADD THESE TWO NAMED FIELDS:
    "razorpay_order_id": response.orderId,
    "razorpay_signature": response.signature,
    "application_id": applicationController.arguments,
  });
}
```

When that ships, update `src/app/api/final_step/route.ts` to read the two new fields and do the canonical HMAC verify (`crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(`${order_id}|${payment_id}`).digest("hex") === razorpay_signature`) — the existing server-side order-fetch logic can stay as defense in depth.

**Do not silently remove the substitute verify** when the HMAC path lands. Old binaries (v1.0.4+2 and earlier) will keep calling `/final_step` without the named fields until users update — keep both code paths and fall back to server-side fetch when `razorpay_signature` is absent.

**Out of scope for the mobile shim** but worth flagging to the same Flutter release:
- `lib/main.dart:31` hardcodes `certificateBaseUrl = "https://application.amasi.org/application/"`. The 4 PDF download URLs (`user-member-application-{certificate-mobile,fmas-certificate-mobile,receipt,invoice}/{id}`) are now covered by 307 redirect routes at `src/app/application/user-member-application-*/[id]/route.ts` (delegating to `/member/certificate`, `/member/fmas-certificate`, and `/api/payments/receipt`). Residual gap: the cert URL is hit with either the AMASI number OR an application id depending on call site, and the native page only resolves the AMASI-number shape today. Drop the legacy hostname entirely after a Flutter release replaces `certificateBaseUrl`.
- `lib/view/login_ext/login.dart:18` defaults the login screen to the "Login Password" tab. The new portal is OTP-only; `/api/check_common_login` is stubbed with a feature-updating response. Switch the default to the OTP tab in the next release.
<!-- END:mobile-shim-known-gaps -->
