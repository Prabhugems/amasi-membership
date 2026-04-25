# FMAS Certificate — Design Spec

**Date:** 2026-04-25
**Status:** Approved (pending spec review)
**Scope:** Surface the FMAS (Fellow of Minimal Access Surgery) credential in the member portal so each Fellow can download their certificate, mirroring the existing AMASI membership certificate flow.

---

## Background

AMASI awards FMAS to members who complete a Skill Course followed by a convocation. Today the registry of FMAS Fellows lives in Airtable (`appFOBQXh545T7zg0` → `FMASIANS` table, 8,820 records) and per-year certificate artwork lives in the `Skill Course` table as image attachments (e.g. `FMAS 2015.jpg`, `FMAS 2018.jpg`, `FMAS 2023.png`).

We want the member portal to show an FMAS credential — analogous to the existing membership credential — so Fellows can download their certificate as PNG/PDF/print, the same way they already download their membership cert.

The user has signaled that DipMAS, MMAS, and per-course completion certificates will follow. The data model is built to absorb those without rework, but only FMAS data is imported and exposed today.

---

## Out of scope (today)

- DipMAS, MMAS, course-completion certificate data ingestion and UI.
- Honorary FMAS (~42 honorees in a separate Airtable table).
- Public FMAS verification page (mirror of existing `/verify`).
- Automated Airtable → Supabase sync (cron / webhook). Manual re-run of seed script only.
- Admin form to issue/revoke FMAS records. Continue to manage in Airtable; re-run import after edits.
- Empty-state pages for non-Fellows. Non-Fellows simply do not see the FMAS entry in their dashboard.

---

## Data model

Two new Supabase tables.

### `member_credentials`

Every credential a member has earned. Generic across credential types so DipMAS/MMAS/course-cert rows slot in later with no schema change.

```sql
CREATE TABLE member_credentials (
  amasi_number       INTEGER NOT NULL,
  credential_type    TEXT    NOT NULL,    -- 'FMAS' today; 'DIPMAS' | 'MMAS' | 'COURSE_CERT' later
  year               INTEGER NOT NULL,    -- convocation year, e.g. 2019
  skill_course_id    INTEGER,             -- maps to Airtable "Skill course Number"
  awarded_at         DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (amasi_number, credential_type, year)
);

CREATE INDEX idx_member_credentials_amasi ON member_credentials (amasi_number);
CREATE INDEX idx_member_credentials_type_year ON member_credentials (credential_type, year);
```

The composite primary key allows a member to legitimately hold one of each type per year (FMAS 2019 + MMAS 2022) and makes the seed script idempotent (`ON CONFLICT DO UPDATE`).

### `credential_templates`

One row per credential-type × year. Holds the path to the artwork on disk plus printable metadata (signatories, place) for admin verification.

```sql
CREATE TABLE credential_templates (
  credential_type    TEXT    NOT NULL,
  year               INTEGER NOT NULL,
  template_path      TEXT    NOT NULL,    -- e.g. '/certificates/fmas/2019.jpg'
  president_name     TEXT,
  convocation_date   TEXT,                -- free text — Airtable stores 'Nov 5 2015-Mumbai'
  convocation_place  TEXT,
  PRIMARY KEY (credential_type, year)
);
```

Templates live at `public/certificates/fmas/{year}.jpg` to match the existing membership-cert pattern (`public/certificates/term-2024-2026.png`). One-time download from Airtable during seeding.

---

## Sync from Airtable

A one-shot Node script: `scripts/seed-fmas.ts`. Run with `npx tsx scripts/seed-fmas.ts`.

The codebase has no prior Airtable integration. The script reads `AIRTABLE_PAT` (Airtable Personal Access Token) from `.env.local` and hits the REST API directly with `fetch` — no SDK dependency. Base ID `appFOBQXh545T7zg0` and table IDs are hardcoded constants at the top of the file.

Steps:

1. Walk Skill Course records once.
   - For each unique `Year of FMAS` value, download the `FMAS Certificate` attachment to `public/certificates/fmas/{year}.{ext}` (preserve original `.jpg`/`.png` extension).
   - Upsert into `credential_templates` with `credential_type = 'FMAS'`, year, template path, `President Details`, `Convocation Date and Place`, and parsed `Place`.
2. Walk all 8,820 FMASIANS records, paginated (Airtable returns ≤100 per page).
   - For each row, read `Name`, `AMASI Number`, `YEAR OF CONVOCATION copy` (the singleSelect — more reliable than the lookup), and the linked `Skill Course Details` record's `Skill course Number`.
   - Match against `members.amasi_number`. **If no match, log to stdout and skip** — do not create new member rows. (See "Make invalid states crash loudly" rule in `AGENTS.md`.)
   - Upsert into `member_credentials` with `credential_type = 'FMAS'`.
3. Print a summary: total scanned, matched-and-upserted, unmatched (with AMASI numbers), templates downloaded.

The script is the single source of truth for re-running the import after Airtable edits. Subsequent runs are idempotent.

---

## Member-facing page

**Route:** `/member/fmas-certificate?id={amasi_number}`

**API:** `GET /api/credential?type=FMAS&id={amasi_number}`

Generic endpoint name (`credential`, not `fmas`) so DipMAS/MMAS reuse it with a different `type` query param.

Response shape:

```json
{
  "status": true,
  "credential": {
    "type": "FMAS",
    "year": 2019,
    "name": "Varsha Saboo",
    "amasiNumber": 9169,
    "templateUrl": "/certificates/fmas/2019.jpg",
    "presidentName": "Suresh Chandra Hari",
    "convocationPlace": "Mumbai"
  }
}
```

If the member has no FMAS credential, return 404 with `{ status: false, message: "FMAS credential not found" }`. The page renders a 404-style empty state — but this URL is only ever surfaced from the member dashboard, which itself only renders the entry point when the member is in `member_credentials` for `type=FMAS` (so the empty state is a defensive fallback, not a normal path).

**UI:** clone `src/app/member/certificate/page.tsx`, with the following changes:

- Header: "FMAS Certificate — Fellow of Minimal Access Surgery".
- Background: the per-year template at `templateUrl`.
- Overlay: **only the member's name** (`Dr. {cert.name}`) at fixed coordinates. Initial values: `top: 52%`, centered, Georgia 30pt — same as the membership cert. Templates already include year, place, president name, and signatures pre-printed.
- Same PNG (3× scale) / PDF (A4) / Print buttons.
- File names: `AMASI-FMAS-{amasiNumber}-{year}.{ext}`.

**Member dashboard wiring:** in `/member/page.tsx`, add an "FMAS Certificate" card next to the existing membership-certificate card, conditionally rendered only when the logged-in member has an FMAS row in `member_credentials`.

---

## Admin view

Two changes.

1. **`/members` list** — add a `Credentials` column showing badges per credential a member holds (today: only `FMAS 2019` etc.). Add a filter chip "Has FMAS" / "No FMAS". Click on a badge opens a small popover with year, skill course #, convocation place.

2. **`/admin/fmas` (new)** — a verification table of every FMAS holder. Columns: `AMASI #`, `Name`, `Year`, `Skill Course #`, `Convocation Place`, `Awarded At`. Sortable. Search by name or AMASI #. Read-only — its purpose is to spot-check the import results, not to edit. Linked from the admin sidebar under a new "Credentials" group.

---

## Open questions resolved

- **Per-template overlay coordinates?** Not for today. We assume year templates are consistent enough that one set of coordinates works. If a specific year's template needs adjustment, we add `name_top_pct`, `name_left_pct`, `font_size_px` columns to `credential_templates` — a backwards-compatible additive change.
- **Multiple convocations in the same year?** Treated as a single template. The data does not currently distinguish them.

---

## Build sequence

1. SQL migrations for `member_credentials` and `credential_templates` (in `sql/`).
2. `scripts/seed-fmas.ts` — write + dry-run + real run.
3. `GET /api/credential` route + DB query helper.
4. `/member/fmas-certificate` page (clone + adjust).
5. Conditional FMAS card on `/member` dashboard.
6. `/admin/fmas` verification page.
7. `/members` list — Credentials column + filter.

Each step is a separate commit. The implementation plan (next document) breaks these into TDD-friendly tasks.
