# Academic Event Application & MOU Workflow — Design

Status: **approved 2026-09-04** — 9 event types (added Meet the Master), zonal notify = 1 Chairperson + AMASI President/Secretary, AMASICON hosting bids stay out of scope, Phase 1 kept lean (no revision path/fee step/post-event report yet)
Replaces: `https://amasi.org/application-forms-mous-for-academic-events/` (7 static docs + 4 Fillout forms)
Lives in: `amasi-membership` (reasons in §1)

This is a plan, not code. Nothing below is built yet.

---

## 1. Codebase findings — what exists, and where your brief's assumptions don't match reality

I had a background agent read both `amasi-membership` and `amasi-faculty-management` end to end for this. Findings, plainly:

| Assumption in your brief | What's actually true |
|---|---|
| Event type "drives tenant" (College vs AMASI) — implying per-application database routing | `tenant` is a **build-time setting per Vercel deployment**, not a runtime choice. AMASI and College of AMASI already **share one Supabase database** (`jmdwxymbgxwdsmcwbahp`). There is no database to "route to" — College vs AMASI is just a label on who owns/brands the event, not a system decision. This makes things *simpler* than the brief assumed. |
| ZeptoMail for transactional email | Not actually wired up anywhere (one UI label only). **Resend** is the real, working provider in both apps — it's what sent this session's 1,910 FMAS/MMAS certificate emails. I'll use Resend. |
| Publish to amasi.org is one automated step | No app has ever talked to WordPress programmatically. The only working path today is Claude's own interactive session (what I've been using all session). Automating this needs new infrastructure — see §4. |
| GallaBox for WhatsApp | Real, and wired up **twice**, once in each app. I'll reuse amasi-membership's own copy since that's where this module lives. |
| — | **AMASI's 5 geographic zones (North/South/East/West/Central) don't exist as data anywhere yet** — not in either app's database. The only place zone data lives is the Airtable base and the WordPress EC page I rebuilt this session. This module will be the first place zones become real, structured data. |
| — | amasi-faculty-management already has a working "create event" flow (`POST /api/events`) with fields: name, short_name, description, start_date, end_date, venue, city, state, country, timezone. Because it's the same database, **approval can insert directly into this table** — the event shows up in that dashboard automatically. This is more achievable than I first thought, and I'm putting it in Phase 1. |

**Why amasi-membership, not amasi-faculty-management:** it already has member lookup, the OTP flow, Resend, GallaBox, and Razorpay all working — the intake form's first step (membership number/email lookup) is basically free here. amasi-faculty-management has none of that member-facing infrastructure.

---

## 2. Data model

Five new tables, all in the existing Supabase project, RLS enabled with no policies (default-deny, admin-client-only) — the same convention both apps already use everywhere.

**`academic_event_types`** — config, not hardcoded enum (per your brief). Admin-editable; adding "DMAS" later is a data insert, not a deploy.
`id` (e.g. `fmas`, `mmas`, `dmas`, `workshop`, `rural_program`, `slcp`, `nextgen`, `zonal_event`), `label`, `owning_entity` (`amasi` | `college_of_amasi` — for MOU letterhead only, not routing), `requires_zone` (bool), `mou_template_key`, `approver_role` (default `hon_secretary`), `notify_roles` (array), `active`.

**`academic_event_role_assignments`** — resolves a role to whoever currently holds it, date-ranged. **This is the exact same pattern as `certificate_signatories`**, which we just built and proved works for President/Secretary this session — same idea, reused.
`role`, `name`, `email`, `phone`, `active_from`, `active_to`.

**`academic_event_applications`** — the application itself.
Identity: `applicant_amasi_number`, `applicant_member_id` (nullable fk to `members`), `organizer_name`, `email`, `phone`, `otp_verified_at`.
Event: `application_type_id`, `event_name`, `primary_institution`, `preferred_date_1/2`, `finalized_date`, venue fields, `zone` (nullable), `expected_participants`, `live_surgery_demo`, facility checkboxes, the 3 agreement checkboxes, photo/upload URLs.
Workflow: `status` (draft/submitted/under_review/changes_requested/approved/rejected/published), `reviewed_by`, `reviewed_at`, `rejection_reason`, `mou_generated_url`, `mou_version`, `created_event_id` (fk into the shared `events` table once created), `published_at`.

**`academic_event_remarks`** — non-blocking comments. `application_id`, `author_name`, `author_role`, `body`, `created_at`. New pattern, doesn't exist anywhere yet, simple to build.

**`academic_event_approval_tokens`** — magic links. `application_id`, `token` (hashed), `role`, `action_taken`, `expires_at`, `used_at`.

---

## 3. The applicant + approval flow (incorporating what you've already decided)

1. **Applicant lookup, not blank form**: first screen asks for AMASI membership number or email. If matched, we pull name/institution/contact from `members` and pre-fill everything. If not matched (non-member organizer), they fill it manually.
2. **OTP as the signature**: before final submit, an OTP goes to their registered (or entered) email/phone. Entering it correctly is recorded as `otp_verified_at` — this is the acknowledgment, replacing both the blank-PDF-to-sign process and any e-sign product. See the one trade-off worth flagging below.
3. **One approver, magic link**: the Hon. Secretary (resolved via `academic_event_role_assignments`, not hardcoded) gets an email with the full application and a one-click **Approve / Reject / Request Changes** link — no login, no OTP for them. Clicking records the decision via the token.
4. **FYI-only notification, non-blocking**: President always CC'd; for zonal events, the zone's officers are added (open question below). They get a "view application + leave a remark" link — remarks append to the record and notify the Secretary, but never gate the decision.
5. **On approval**: MOU PDF generated from the application data, event record created directly in the shared `events` table (visible in the amasi-faculty-management dashboard immediately), confirmation + MOU emailed to the applicant, outcome FYI to everyone else, WhatsApp nudge via GallaBox.
6. **Applicant status page**: membership number/email + OTP gets them a read-only status view — no more phoning the office.

**One trade-off to flag on the OTP-as-signature decision**, plainly: this is a solid, defensible record that a real member consented (tied to their verified registered contact) — appropriate for an internal association MOU. It is *not* a legally-recognized digital signature under India's IT Act (that requires a licensed Certifying Authority like eMudhra, via a paid e-sign product such as Digio/Leegality, roughly ₹10–30/document). If AMASI ever needs these MOUs to hold up independently in a dispute, that's the upgrade path. You've already chosen OTP over that cost/friction — noting it once, then proceeding with your call.

---

## 4. Integration design

| Step | Phase 1 | Phase 2 |
|---|---|---|
| Create event record | ✅ Direct DB insert into shared `events` table on approval | — |
| Confirmation + MOU email | ✅ Resend | — |
| Secretary/notify emails | ✅ Resend | — |
| WhatsApp nudge | ✅ amasi-membership's existing GallaBox client | — |
| Publish to amasi.org (Upcoming/Zonal Events) | ⚠️ Flagged "ready to publish," pre-filled copy for a human (or me, via my WordPress tools) to post manually | Full automation, once we solve how the site's existing `[upcoming_events_only]`/`[zonal_events]` widgets actually source their data — that's still an open mystery from earlier this session, not something I can promise a timeline on yet |
| eventz360 calendar | ⚠️ Manual flag only | Needs eventz360's own team — no API exists today |

**Retry/observability**: each post-approval step writes a row to a small `academic_event_publish_steps` table (step, status, attempts, last_error). Admins see a per-application checklist with manual retry buttons; failures also go to Sentry (already the standard error channel in this stack). A failed WordPress step never blocks or loses the approval itself.

---

## 5. Phased build order

**Phase 0 — foundation**: the 5 tables above, seed `academic_event_types`, seed `academic_event_role_assignments` (Secretary + President — same people already in `certificate_signatories`, direct reuse).

**Phase 1 — smallest useful release**: intake form (lookup → OTP → type-specific fields) → Secretary magic-link decision → applicant status page → FYI notifications + remarks → MOU PDF + email → event auto-created in the shared dashboard → admin `/admin/mou-applications` as a record/audit view. No WordPress/eventz360 automation.

**Phase 2**: WordPress auto-publish (once the data-source question is resolved), eventz360 integration, resubmission path for rejected/changes-requested applications, fee/revenue-share step (Razorpay already available to plug in).

**Phase 3**: post-event report / attendance return for CME credit tracking.

---

## 6. Open questions — all resolved

1. ~~**Zone officers**~~ — **Resolved**: for zonal events, notify that zone's one Chairperson (the 5 Zonal Vice Chairpersons already on the EC page) plus the AMASI-wide President and Secretary (already in the base flow as approver/CC). No separate Zone President/Secretary roles.
2. ~~**"Meet the Master"**~~ — **Resolved: included.** Event types in scope are now **9**: FMAS, MMAS, DMAS, Workshop/CME/Conference, Rural Surgery Camp, SLCP, NextGen Organizer, Zonal event, Meet the Master.
3. ~~**AMASICON hosting bids**~~ — **Resolved: out of scope**, stays as the two static docx/pdf downloads with a note that bids go through the EC.
4. ~~**Revision path / fee step / post-event report**~~ — **Resolved: Phase 2/3, not Phase 1.** Phase 1 stays lean as originally scoped in §5.

Note on scope vs. sequencing: the 9 event types, intake form, OTP, magic-link approval, remarks, MOU generation, notifications, and direct event creation in the shared dashboard are all being built **together as one release** (not staggered per type). WordPress auto-publish and eventz360 integration remain Phase 2 regardless — that's a technical gap (no server-to-server path exists to either today), not a scope choice.

---

## 7. Next step

Spec is approved. Next I write the concrete implementation plan (exact files, migration SQL, routes, in build order) and hand it back before writing any code.
