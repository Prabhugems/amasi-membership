# AMASI Project Audit Report — 20 April 2026

10-agent comprehensive audit covering security, dead buttons, API error handling, forms, loading states, navigation, dead code, UX/accessibility, performance, and feature completeness.

---

## Priority 1: CRITICAL (Fix Immediately)

### Security: PII Exposed Without Auth
| # | Route | Issue | Impact |
|---|-------|-------|--------|
| S1 | `/api/card` | Returns email, phone, MCI number, profile photo for any sequential AMASI number — zero auth | Full member enumeration |
| S2 | `/api/certificate` | Same as above — full PII for any member number | Full member enumeration |
| S3 | `/api/applications/status` | Returns DOB, home address, father's name, document URLs — queryable by phone/email, no auth | Applicant PII exposure |

### Security: Auth Missing on Mutation Routes
| # | Route | Issue |
|---|-------|-------|
| S4 | `/api/applications/resubmit` | Zero auth — anyone with application UUID can overwrite applicant data and documents |
| S5 | `/api/notifications/send` | Email body not HTML-escaped via `escapeHtml()` — XSS risk in member email clients |

### Broken Routes (404s)
| # | File | Line(s) | Issue |
|---|------|---------|-------|
| B1 | `search/page.tsx` | 276, 530 | Certificate links go to `/certificate` — should be `/member/certificate`. 404 on every click |
| B2 | `recent-applications-table.tsx` | 447 | "Review" button links to `/pending/${id}` — no `[id]` route exists. 404 on every dashboard click |

### API: Silent Data Loss
| # | File | Issue |
|---|------|-------|
| A1 | `payments/verify/route.ts` | Payment insert + application update return values completely ignored — returns 200 even on failure |
| A2 | `dashboard/route.ts` | `membersByType` query silently capped at 1000 rows — dashboard KPIs are wrong for >1000 members |

---

## Priority 2: HIGH (Fix This Week)

### Security
| # | Issue | File(s) |
|---|-------|---------|
| S6 | No IP rate limiting on OTP verify endpoints | `otp/verify/route.ts`, `otp/verify-sms/route.ts` |
| S7 | `/api/nmc/verify` has no rate limit — could get AMASI IP blacklisted by NMC | `nmc/verify/route.ts` |
| S8 | File uploads on resubmit/upgrade skip magic byte validation | `applications/resubmit/route.ts`, `members/upgrade/route.ts` |
| S9 | No security headers (CSP, X-Frame-Options, HSTS) | `next.config.ts` |
| S10 | Upgrade documents use public URLs instead of signed URLs | `members/upgrade/route.ts` |
| S11 | Hardcoded Razorpay partner account ID + no amount validation | `payments/verify/route.ts:35` |

### Navigation
| # | Issue | File |
|---|-------|------|
| N1 | `/profile` blocked by middleware for members — redirects to admin login instead of OTP flow | `middleware.ts` |
| N2 | No custom 404 page — broken links show bare unstyled Next.js default | Missing `src/app/not-found.tsx` |

### Error Handling
| # | Issue | Files |
|---|-------|-------|
| E1 | 6 pages show "No data found" when API fails (isError destructured but never rendered) | `verify`, `members`, `pending`, `upgrades`, `card`, `member/certificate` |
| E2 | OTP insert not checked before sending SMS — OTP may never persist | `otp/send-sms/route.ts` |
| E3 | 6 API routes return 200 on failure | `payments/verify`, `upgrade/[id]`, `dashboard/heatmap`, `applications/resubmit`, `tickets/[id]/merge`, `members/upgrade` |
| E4 | Hardcoded URLs in email templates should use env var | `tickets/[id]/reply/route.ts`, `tickets/route.ts` |

### Performance
| # | Issue | File |
|---|-------|------|
| P1 | Sidebar fetches `/api/dashboard`, `/api/tickets`, `/api/upgrades` via raw fetch every 60s — duplicates react-query cache | `sidebar.tsx` |
| P2 | Zero usage of `next/image` anywhere — no image optimization, no lazy loading | Project-wide |
| P3 | Zero usage of `next/dynamic` — no code splitting; Recharts (~300KB) eagerly loaded | Project-wide |

---

## Priority 3: MEDIUM (Fix This Sprint)

### Dead Buttons & Stubs
| # | Element | File | Issue |
|---|---------|------|-------|
| D1 | "Notify Me" form | `apply/status/page.tsx:647` | Stub — collects email, shows success, never calls API |
| D2 | Apple/Google Wallet buttons | `card/page.tsx:638` | Permanently disabled stubs |
| D3 | "Scan QR Code" button | `verify/page.tsx:138` | Fires blocking `alert()` with instructions — no scanner |
| D4 | "Export PDF" button | `reports/page.tsx:287` | Just calls `window.print()` — not a real PDF export |
| D5 | Dashboard health checks | `dashboard/route.ts:623-627` | Email, Razorpay, Webhooks permanently hardcoded to "ok" |

### Forms & Validation
| # | Issue | File |
|---|-------|------|
| F1 | OTP inputs missing `autoComplete="one-time-code"` — SMS auto-fill broken on mobile | `profile-otp.tsx:142` |
| F2 | Profile "Review Changes" has no disabled state — double-submit risk | `profile-edit-form.tsx:391` |
| F3 | Resubmit form has zero client-side validation | `apply/resubmit/page.tsx:309` |
| F4 | Admin password creation has no complexity requirements (only length >= 6) | `admin/page.tsx:87` |
| F5 | No unsaved-changes warning in profile editing — edits silently lost on navigation | `profile-edit-form.tsx` |

### UX States
| # | Issue | File |
|---|-------|------|
| U1 | 3 fetch effects have no AbortController — race conditions on rapid input | `reports/page.tsx`, `profile/page.tsx`, `support/[ticketNumber]/page.tsx` |
| U2 | Dashboard heatmap query error leaves skeleton spinning forever | `page.tsx` |
| U3 | Members CSV export silently swallows errors — no toast on failure | `members/page.tsx:375` |
| U4 | `verify/page.tsx` share fallback uses `alert()` instead of toast | `verify/page.tsx:74` |

### Security (Medium)
| # | Issue | File |
|---|-------|------|
| S12 | No CORS policy — any website can make requests to public API routes | All public routes |
| S13 | `/api/tickets` GET — email/phone enumeration without rate limit | `tickets/route.ts` |
| S14 | `/api/members/search` — name/photo enumeration without rate limit | `members/search/route.ts` |
| S15 | CSAT token leaked into redirect URL — reusable by anyone with URL | `tickets/csat/route.ts` |
| S16 | `CRON_SECRET` missing degrades silently instead of hard-failing | `cron/sla-breach/route.ts` |

### Performance (Medium)
| # | Issue | File |
|---|-------|------|
| P4 | Pending page: 100 cards rendered without virtualization, filter recomputes every keystroke (no useMemo) | `pending/page.tsx` |
| P5 | Reports page: all chart datasets recomputed on every render (no useMemo) | `reports/page.tsx:308-334` |
| P6 | `SortableHeader` defined inside render body — causes remounts | `members/page.tsx:382` |

---

## Priority 4: LOW (Backlog)

### Dead Code to Remove
| # | Item | File |
|---|------|------|
| DC1 | 7 orphaned `src/components/apply/step-*.tsx` files + `wizard-progress.tsx` (~400+ lines) — never imported | `src/components/apply/` |
| DC2 | `src/lib/client-ocr.ts` — never imported | `src/lib/` |
| DC3 | `formatPhone`, `getStatusColor` exported but never used | `src/lib/utils.ts` |
| DC4 | `ArrowRight` unused import | `pending/page.tsx:18` |
| DC5 | 17 dead CSS classes in `globals.css` (~120 lines) | `globals.css` |
| DC6 | 3x `timeAgo`, 3x `relativeTime`, 3x `membershipTypeLabel`, 3x `statusLabel`, 2x `extractAttachment` — duplicate utilities across files | Multiple files |

### Accessibility
| # | Issue | Scope |
|---|-------|-------|
| A11 | Password toggle `tabIndex={-1}` — keyboard users can't toggle | `login/page.tsx:104` |
| A12 | Many `<label>` elements lack `htmlFor`/`id` pairing | `admin/page.tsx`, all step-*.tsx, `profile-edit-form.tsx` |
| A13 | All `<th>` elements missing `scope="col"` across 6 tables | `admin`, `members`, `pending`, `audit`, `dashboard` |
| A14 | Table row actions hidden via `opacity-0 group-hover` — invisible to keyboard users | `members/page.tsx:562` |
| A15 | Multiple icon-only buttons use `title` instead of `aria-label` | `members`, `tickets`, `pending` |
| A16 | File upload drop zone not keyboard-focusable | `file-upload.tsx:48` |
| A17 | Sidebar collapse button 24x24px, filter dismiss buttons 12x12px — below 44px touch target | `sidebar.tsx:243`, `members/page.tsx:500` |
| A18 | Error toasts use `aria-live="polite"` — should be `assertive` | `layout.tsx:93` |
| A19 | Color contrast: amber text on amber-50 bg (~3.5:1), hero card white/80 on teal (~3.8:1) | `members/page.tsx`, `stat-card.tsx` |

### Feature Gaps
| # | Issue | File |
|---|-------|------|
| FG1 | Member portal Documents tab can't upload in-place — redirects to profile editor | `member/page.tsx:877` |
| FG2 | Apply "existing member" phase has no link to resubmit page | `apply/page.tsx` |
| FG3 | Experience/Clinic saves fire-and-forget with `.catch(() => {})` — errors silently swallowed | `profile-edit-form.tsx:197` |
| FG4 | Middleware login redirect drops query params (`/search?q=foo` → `/search`) | `middleware.ts:121` |
| FG5 | WhatsApp template list hardcoded in frontend — no admin management | `notifications/page.tsx` |
| FG6 | 10 API routes have 1000-row Supabase truncation risk | Multiple |

---

## Counts by Category

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 5 | 6 | 5 | 4 | 20 |
| Broken Routes | 2 | 2 | — | — | 4 |
| API Error Handling | 2 | 3 | — | — | 5 |
| Dead Buttons/Stubs | — | — | 5 | — | 5 |
| Forms/Validation | — | — | 5 | — | 5 |
| UX States | — | — | 4 | — | 4 |
| Performance | — | 3 | 3 | — | 6 |
| Dead Code | — | — | — | 6 | 6 |
| Accessibility | — | — | — | 9 | 9 |
| Feature Gaps | — | — | — | 6 | 6 |
| **Total** | **9** | **14** | **22** | **25** | **70** |
