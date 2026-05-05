# AMASI Technology Systems Map

## 1. Purpose

This document is the single, plain-language map of all software AMASI runs or plans to run. It exists for two audiences: the Executive Committee, who need a clear picture of AMASI's digital infrastructure for governance and continuity decisions, and future technical maintainers, who need a starting point before touching any of these systems. It is a **living document** — every time a system is added, retired, or substantially changed, this file should be updated in the same change.

If any section becomes inaccurate, that is a bug in this document. Fix it.

## 2. Systems overview

| System | Purpose | Audience | Maintained by | Hosting | Status |
|---|---|---|---|---|---|
| **amasi-membership** | Member portal — applications, payments, digital membership card, support tickets | Surgeons (members + applicants), AMASI admins, partner event apps | Prabhu (Coordinator) | Vercel — `membership.amasi.org` | Production |
| **AMASI-management** | Internal faculty and conference operations for AMASI skill courses | AMASI staff and faculty | Prabhu (Coordinator) | Vercel — `collegeofmas.org.in` | Production |
| **AMASICON 2026 app** | Event app for AMASICON 2026 (Kolkata, 27–30 August 2026) | Conference delegates, organisers | External — Kolkata local organising committee | External | In development (single-event use) |
| **AMASI Members mobile app** | Member-facing iOS + Android app, three planned waves: members module → conference module → applications module | Members | TBD (not yet started) | iOS App Store + Google Play | Planned (not yet started); target completion AMASICON 2027 |

## 3. Architecture diagram

A simplified picture of how the systems and their users connect today, plus the planned mobile app:

```
                          Members & applicants
                                  |
                                  v
   External AMASICON   -->  amasi-membership   <-- AMASI staff
   event apps                (membership.amasi.org)        |
   (partner API)                   |                       v
                                   v               AMASI-management
                           +---------------------+ (collegeofmas.org.in)
                           | Shared Supabase     | <----------+
                           | Postgres + Storage  |
                           | (single source      |
                           |  of truth)          |
                           +---------------------+
                                   ^
                                   | (planned)
                       AMASI Members mobile app (iOS + Android)
```

The two web apps are separate codebases, but they read and write to the **same** Supabase database. Whatever is true in Supabase is true everywhere.

## 4. Shared infrastructure

These services are shared across more than one AMASI system. Where a service is currently used by only one system but could plausibly be shared in future, that is noted.

- **Supabase project** — one Postgres database + storage. Used by both `amasi-membership` and `AMASI-management`. The future mobile app will read from this same project. **This is the single source of truth for AMASI member and faculty data.**
- **Razorpay merchant account** — shared. Used by `amasi-membership` for membership fees today; `AMASI-management` uses it for skill-course payments.
- **Vercel team account** — hosts both web apps under a single Vercel team.
- **Sentry organisation `amasi`** — error monitoring for both `amasi-membership` and `AMASI-management`.
- **Resend (email)** — both apps send transactional email through Resend, but each app has its own configuration (sender address, API key, templates).
- **GitHub organisation** — both web app repositories live under `Prabhugems/` on GitHub. (See section 8 on visibility.)
- **Anthropic API account** — used by `amasi-membership` for AI document extraction. Available to `AMASI-management` if needed.
- **Domain registrations:**
  - `amasi.org` — root AMASI domain
  - `membership.amasi.org` — points to `amasi-membership`
  - `collegeofmas.org.in` — points to `AMASI-management`

## 5. Data ownership and flow

In plain terms:

- **Member data** (applicants, AMASI members, payments, documents, membership cards, support tickets) lives in the shared Supabase. It is *conceptually owned by* `amasi-membership` — that app is the system of record for everything membership-related — but `AMASI-management` reads from the same tables when it needs to know who a member is.
- **Faculty data** (faculty profiles, skill-course rosters, faculty assignments) lives in the same Supabase. It is conceptually owned by `AMASI-management`. `amasi-membership` does not normally write to faculty tables.
- **Event data** (skill courses, schedules, registrations for AMASI-run courses) also lives in the same Supabase, conceptually owned by `AMASI-management`.
- **Schema changes affect both apps.** Because the two apps share one database, any change to a table that both apps read or write must be coordinated across both repositories in the same release window. Skipping coordination is the most likely cause of a future outage.
- **Outbound data flow to third parties.** For specific operational workflows, limited data flows to external services where required to support that workflow (for example, payment records to the payment processor). These flows are limited to the data each workflow requires; they are not bulk exports of member data.

## 6. Authentication

Different systems authenticate users in different ways, but they all eventually trust the same Supabase user records:

- **`amasi-membership`** uses two parallel mechanisms: cookie-based auth for AMASI admins (a signed session cookie issued at login), and one-time-password (OTP) login for members — they enter their email and/or phone, receive a code, and are signed in for that session. There are no passwords stored for members.
- **`AMASI-management`** uses Supabase's built-in authentication for AMASI staff and faculty.
- **Shared user records.** Both apps use the same Supabase auth users, so a single person is the same identity in both systems.
- **Future mobile app.** The planned iOS + Android app will use bearer-token (JWT) authentication against the same JWT secret as `amasi-membership`, so a member who logs in on the website and on the mobile app is the same account. The mobile app will read member data from the shared Supabase — it will **not** invent a parallel auth system.

## 7. External dependencies

The services AMASI relies on. Account ownership, billing arrangements, and access credentials are administered as AMASI organisational records and are not part of this public document. Where AMASI's standard payment process cannot accommodate a service quickly enough, the Coordinator may pay for a service personally and seek reimbursement against receipts; in such cases the underlying account is held in AMASI's name where the service permits it.

| Account / service | Purpose |
|---|---|
| Apple Developer Program | Future mobile app distribution on iOS App Store |
| Google Play Developer | Future mobile app distribution on Android |
| Vercel team | Hosts both web apps |
| Supabase project | Shared database and storage |
| Razorpay merchant | Payments — funds settle directly to AMASI's bank account |
| Domain registrations (amasi.org, membership.amasi.org, collegeofmas.org.in) | Public web addresses, registered to AMASI |
| Sentry organisation | Error monitoring for both web apps |
| Resend | Outbound email |
| Anthropic API | AI document extraction |
| Gallabox | WhatsApp messaging |
| MSG91 | SMS / OTP |
| Apple Wallet certificates | Digital membership card pass on iOS (held by amasi-membership) |
| Google Wallet credentials | Digital membership card pass on Android (held by amasi-membership) |

## 8. Repository visibility

As of this writing, both web app repositories are **public** on GitHub:

- `https://github.com/Prabhugems/amasi-membership` — public
- `https://github.com/Prabhugems/AMASI-management` — public

This is a factual statement, not a recommendation. Public repositories have practical benefits (transparency, easier collaboration, lower friction for contributors) and practical costs (anyone can read the code, including dependency lists, route names, and operational notes — though never any secrets, which are kept in environment variables outside the code).

The Executive Committee may want to review whether public is the right posture for AMASI's web apps going forward. That is the EC's decision; the purpose of this section is only to make the current state visible.

## 9. Known operational gaps

Honest, factual list of gaps in AMASI's current technology operations. Framed as **governance information for the EC**, not as criticism — every operating organisation has gaps, and the value of writing them down is that decisions can be made with clear eyes.

- **No automated tests on `AMASI-management`.** Verification before deployment is currently manual. `amasi-membership` has unit tests (Vitest) and end-to-end tests (Playwright) for its highest-value flows.
- **Documentation has historically been minimal.** This map and the new `README.md` files in each repository are the start of a deliberate effort to fix that. Future changes should keep documentation updated alongside the code.
- **Node.js runtime version under review.** `amasi-membership` is currently configured with a slight mismatch between the local development pin (Node 20) and the hosting platform's runtime (Node 24). This is being reviewed and is not currently causing user-visible issues, but it should be reconciled.

## 10. Planned systems

The **AMASI Members mobile app** (iOS + Android) is planned but **has not yet been started**. The current shape of the project:

- Three planned waves, in order: a members module first, then a conference module, then an applications module.
- Targeted completion: AMASICON 2027.
- It will read from the shared Supabase database — no parallel data store.
- It will reuse `amasi-membership`'s authentication (JWT) so members have one account across web and mobile.

A detailed specification will be created when the project formally begins. This section exists only so the systems map shows what is on the horizon.

## 11. Maintenance and continuity

- **Who maintains what today.** Both production web apps (`amasi-membership` and `AMASI-management`) are maintained by Prabhu (Coordinator). The AMASICON 2026 app is being built and will be maintained by the Kolkata local organising committee for the duration of that event.
- **How changes reach production.** Both web apps deploy automatically when changes are pushed to the `main` branch on GitHub — Vercel rebuilds and serves the new version with no manual deployment step. Other branches deploy as preview environments that don't replace production.
- **Scheduled jobs (cron).** Both apps have scheduled background jobs declared in each repository's `vercel.json` file. In `amasi-membership` these include support-ticket SLA checks (every 10 minutes), a weekly digest, periodic member sync, and daily reminders for incomplete applications. The current list and schedules can always be read from `vercel.json` directly.
- **Bug-fix history.** Each repository keeps a running record of fixed bugs, root causes, and the file(s) that were affected. In `amasi-membership` this lives in `CHANGELOG.md` and `.claude/CONTEXT.md`. Future maintainers should read those before changing fragile areas.
- **Operating model.** The current Coordinator is the active builder and maintainer of the AMASI web applications. The intended longer-term operating model is for routine operations, AMASICON-related deployments, and ongoing maintenance to be handled by designated AMASI staff or external partners after each system is fully built and documented. The Coordinator continues as a technical advisor and check-in resource. The READMEs in each repository, this systems map, and the `.claude/CONTEXT.md` operational notes exist so that handover is practical rather than aspirational.

## 12. Glossary

Brief definitions of terms used in this document.

- **AMASICON** — AMASI's annual conference. AMASICON 2026 is in Kolkata (27–30 August 2026).
- **EC** — Executive Committee of AMASI.
- **FMAS** — Fellowship of Minimal Access Surgery, AMASI's flagship skill credential.
- **MS / DNB** — Postgraduate medical qualifications (Master of Surgery / Diplomate of National Board).
- **RFID check-in** — using radio-frequency ID cards to mark attendance at events. Mentioned as a possible future feature; not currently implemented.
- **RLS (Row-Level Security)** — a Postgres feature that restricts which rows a given user can read or write, enforced inside the database itself.
- **PWA (Progressive Web App)** — a website that can install on a phone like an app. Mentioned for completeness; not the current plan for the AMASI mobile app.
- **API (Application Programming Interface)** — a defined set of URLs that one piece of software calls to request data or actions from another.
- **Supabase** — a hosted database service (Postgres) plus file storage and authentication. AMASI's shared database.
- **Vercel** — the hosting platform that runs both AMASI web apps.
- **Sentry** — an error-monitoring service that records crashes and exceptions in production.
- **Razorpay** — Indian payment gateway used for membership and course fees.
- **Resend** — a transactional email service used to send OTPs, receipts, and notifications.
- **Cron job** — a task that runs on a fixed schedule (e.g. "every Monday at 4 a.m.") with no human triggering it.

## 13. Document maintenance

- **When to update.** Whenever a system is added or retired, an external service is added or removed, or any account holder changes. Also whenever any unresolved item in the document is resolved.
- **Who updates.** The current technical maintainer (Prabhu) is responsible for keeping this document accurate. As routine operations transition to designated staff or partners (see section 11), responsibility for keeping this map current should transition with them.
- **Adding a new external service or system.** It must be added to this map in the same change set as the system or service is introduced. Undocumented systems are how organisations lose track of what they own.

## See also

- `README.md` — `amasi-membership` repository overview, environment variables, critical paths.
- `../README.md` in the `AMASI-management` repository — sibling system overview (when written).
- `.claude/CONTEXT.md` — operational notes and recent bug-fix history for `amasi-membership`.
- `CHANGELOG.md` — every bug fix shipped to `amasi-membership`, newest first.
