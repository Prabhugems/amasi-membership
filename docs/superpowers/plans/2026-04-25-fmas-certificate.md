# FMAS Certificate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the FMAS (Fellow of Minimal Access Surgery) credential in the member portal so each Fellow can download their certificate, mirroring the existing AMASI membership certificate flow. Backfill 8,820 FMAS records and per-year templates from Airtable to Supabase.

**Architecture:** Generic `member_credentials` and `credential_templates` tables (extensible to DipMAS / MMAS / course certs later). One-shot Node/tsx seed script reads Airtable PAT-authenticated REST API and downloads year-specific template artwork to `public/certificates/fmas/{year}.{ext}`. A new `/api/credential` route serves credential data; a new `/member/fmas-certificate` page clones the existing membership-cert UI with a name-only overlay; a new `/admin/fmas` page lets admins verify the import.

**Tech Stack:** Next.js 16 App Router · Supabase (postgres) · TypeScript · vitest (unit tests) · Playwright (smoke) · `tsx` for scripts · plain `fetch` for Airtable API.

**Spec:** `docs/superpowers/specs/2026-04-25-fmas-certificate-design.md`

---

## Pre-flight

Before starting, the implementer needs:

1. An **Airtable Personal Access Token (PAT)** with `data.records:read` scope on base `appFOBQXh545T7zg0`.
   - Add it to `.env.local` as `AIRTABLE_PAT=pat...`.
   - Don't commit `.env.local`.
2. A working `.env.local` with existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the codebase already requires these).
3. Node 24 LTS, the project's `node_modules` installed (`npm i`).

Verify:
```bash
node --version          # should print v24.x
grep -c AIRTABLE_PAT .env.local   # should print at least 1
grep -c SUPABASE_SERVICE_ROLE_KEY .env.local   # should print at least 1
```

---

## Task 1: Database schema

**Files:**
- Create: `sql/023_member_credentials.sql`
- Create: `sql/023_member_credentials_rollback.sql`

- [ ] **Step 1: Write the migration SQL**

Create `sql/023_member_credentials.sql`:

```sql
-- 023: Member credentials — generic table for FMAS, DipMAS, MMAS, course certs.
-- Today only FMAS rows are inserted (8,820 records imported from Airtable).
-- The composite primary key (amasi_number, credential_type, year) lets a member
-- legitimately hold one of each type per year, and makes the seed script
-- idempotent via ON CONFLICT.

CREATE TABLE IF NOT EXISTS member_credentials (
  amasi_number      integer NOT NULL,
  credential_type   text    NOT NULL,
  year              integer NOT NULL,
  skill_course_id   integer,
  awarded_at        date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (amasi_number, credential_type, year)
);

CREATE INDEX IF NOT EXISTS idx_member_credentials_amasi
  ON member_credentials (amasi_number);

CREATE INDEX IF NOT EXISTS idx_member_credentials_type_year
  ON member_credentials (credential_type, year);

CREATE TABLE IF NOT EXISTS credential_templates (
  credential_type    text NOT NULL,
  year               integer NOT NULL,
  template_path      text NOT NULL,
  president_name     text,
  convocation_date   text,
  convocation_place  text,
  PRIMARY KEY (credential_type, year)
);
```

- [ ] **Step 2: Write the rollback**

Create `sql/023_member_credentials_rollback.sql`:

```sql
-- Rollback for 023.
DROP TABLE IF EXISTS credential_templates;
DROP TABLE IF EXISTS member_credentials;
```

- [ ] **Step 3: Apply the migration**

Run via the Supabase SQL editor (or `psql`) in the project's database:

```bash
# If using psql with DATABASE_URL configured:
psql "$DATABASE_URL" -f sql/023_member_credentials.sql
```

If you don't have `DATABASE_URL`, copy the SQL into the Supabase SQL editor at `https://supabase.com/dashboard/project/{project_id}/sql` and run it.

Expected: 2 tables created, 2 indexes created. Re-running is idempotent (uses `IF NOT EXISTS`).

- [ ] **Step 4: Verify**

```bash
psql "$DATABASE_URL" -c "\d member_credentials"
psql "$DATABASE_URL" -c "\d credential_templates"
```

Expected: schema printed with the columns above.

- [ ] **Step 5: Commit**

```bash
git add sql/023_member_credentials.sql sql/023_member_credentials_rollback.sql
git commit -m "feat(sql): member_credentials + credential_templates tables"
```

---

## Task 2: TypeScript types

**Files:**
- Create: `src/lib/credentials/types.ts`

- [ ] **Step 1: Define types**

Create `src/lib/credentials/types.ts`:

```typescript
export type CredentialType = "FMAS" | "DIPMAS" | "MMAS" | "COURSE_CERT"

export interface MemberCredential {
  amasiNumber: number
  credentialType: CredentialType
  year: number
  skillCourseId: number | null
  awardedAt: string | null
  createdAt: string
}

export interface CredentialTemplate {
  credentialType: CredentialType
  year: number
  templatePath: string
  presidentName: string | null
  convocationDate: string | null
  convocationPlace: string | null
}

// Shape of an Airtable FMASIANS row (only the fields we care about).
// `skillCourseRecordId` is the Airtable record id (e.g. "recga0FTGLyZDigYd");
// the seed script resolves it to the numeric `Skill course Number` via the
// Skill Course table lookup.
export interface AirtableFmasianRow {
  id: string
  name: string
  amasiNumber: number | null
  yearOfConvocation: number | null
  skillCourseRecordId: string | null
}

// Shape of an Airtable Skill Course row.
export interface AirtableSkillCourseRow {
  id: string
  skillCourseNumber: number
  yearOfFmas: number | null
  presidentName: string | null
  convocationDateAndPlace: string | null
  fmasCertificateAttachmentUrl: string | null
  fmasCertificateFilename: string | null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/credentials/types.ts
git commit -m "feat(credentials): shared types for credentials module"
```

---

## Task 3: Airtable response parsing (TDD, pure functions)

This task isolates the parsing logic from network calls so it can be unit-tested.

**Files:**
- Create: `src/lib/credentials/airtable-parser.ts`
- Test: `src/lib/credentials/__tests__/airtable-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/credentials/__tests__/airtable-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  parseFmasianRecord,
  parseSkillCourseRecord,
  extractConvocationPlace,
} from "../airtable-parser"

describe("parseFmasianRecord", () => {
  it("parses a complete FMASIAN record", () => {
    const raw = {
      id: "rec00XD9caopba2tD",
      fields: {
        Name: "Varsha Saboo",
        "AMASI Number": "9169",
        "YEAR OF CONVOCATION copy": "2019",
        "Skill Course Details": ["recga0FTGLyZDigYd"],
      },
    }
    expect(parseFmasianRecord(raw)).toEqual({
      id: "rec00XD9caopba2tD",
      name: "Varsha Saboo",
      amasiNumber: 9169,
      yearOfConvocation: 2019,
      skillCourseRecordId: "recga0FTGLyZDigYd",
    })
  })

  it("returns amasiNumber: null when AMASI Number is missing", () => {
    const raw = {
      id: "rec1",
      fields: { Name: "Foo", "YEAR OF CONVOCATION copy": "2020" },
    }
    expect(parseFmasianRecord(raw).amasiNumber).toBeNull()
  })

  it("returns yearOfConvocation: null when missing", () => {
    const raw = { id: "rec1", fields: { Name: "Foo", "AMASI Number": "100" } }
    expect(parseFmasianRecord(raw).yearOfConvocation).toBeNull()
  })

  it("coerces a numeric AMASI Number to int", () => {
    const raw = { id: "rec1", fields: { Name: "Foo", "AMASI Number": 8054 } }
    expect(parseFmasianRecord(raw).amasiNumber).toBe(8054)
  })

  it("returns skillCourseRecordId: null when no linked record", () => {
    const raw = { id: "rec1", fields: { Name: "Foo" } }
    expect(parseFmasianRecord(raw).skillCourseRecordId).toBeNull()
  })
})

describe("parseSkillCourseRecord", () => {
  it("parses a complete Skill Course record", () => {
    const raw = {
      id: "recga0FTGLyZDigYd",
      fields: {
        "Skill course Number": 62,
        "Year of FMAS": "2019",
        "President Details": "Suresh Chandra Hari",
        "Convocation Date and Place": "5th Nov 2015-Mumbai",
        "FMAS Certificate": [
          {
            id: "att1",
            url: "https://airtable.example/cert.jpg",
            filename: "FMAS 2019.jpg",
          },
        ],
      },
    }
    expect(parseSkillCourseRecord(raw)).toEqual({
      id: "recga0FTGLyZDigYd",
      skillCourseNumber: 62,
      yearOfFmas: 2019,
      presidentName: "Suresh Chandra Hari",
      convocationDateAndPlace: "5th Nov 2015-Mumbai",
      fmasCertificateAttachmentUrl: "https://airtable.example/cert.jpg",
      fmasCertificateFilename: "FMAS 2019.jpg",
    })
  })

  it("returns null attachment fields when no FMAS Certificate present", () => {
    const raw = {
      id: "rec1",
      fields: { "Skill course Number": 1, "Year of FMAS": "2010" },
    }
    const parsed = parseSkillCourseRecord(raw)
    expect(parsed.fmasCertificateAttachmentUrl).toBeNull()
    expect(parsed.fmasCertificateFilename).toBeNull()
  })

  it("coerces yearOfFmas as int", () => {
    const raw = {
      id: "rec1",
      fields: { "Skill course Number": 1, "Year of FMAS": 2018 },
    }
    expect(parseSkillCourseRecord(raw).yearOfFmas).toBe(2018)
  })
})

describe("extractConvocationPlace", () => {
  it("extracts place from 'Nov 5 2015-Mumbai'", () => {
    expect(extractConvocationPlace("5th Nov 2015-Mumbai")).toBe("Mumbai")
  })

  it("extracts place from '02nd November 2023 Raipur'", () => {
    expect(extractConvocationPlace("02nd November 2023 Raipur")).toBe("Raipur")
  })

  it("returns null when input is null", () => {
    expect(extractConvocationPlace(null)).toBeNull()
  })

  it("returns the whole string if no clear place delimiter", () => {
    expect(extractConvocationPlace("TBD")).toBe("TBD")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/credentials/__tests__/airtable-parser.test.ts`

Expected: All tests fail with "Cannot find module '../airtable-parser'".

- [ ] **Step 3: Implement the parser**

Create `src/lib/credentials/airtable-parser.ts`:

```typescript
import type { AirtableFmasianRow, AirtableSkillCourseRow } from "./types"

interface AirtableAttachment {
  id: string
  url: string
  filename: string
}

interface AirtableRaw {
  id: string
  fields: Record<string, unknown>
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

export function parseFmasianRecord(raw: AirtableRaw): AirtableFmasianRow {
  const f = raw.fields
  const linked = f["Skill Course Details"]
  const skillCourseRecordId =
    Array.isArray(linked) && linked.length > 0 && typeof linked[0] === "string"
      ? linked[0]
      : null
  return {
    id: raw.id,
    name: typeof f["Name"] === "string" ? (f["Name"] as string) : "",
    amasiNumber: toIntOrNull(f["AMASI Number"]),
    yearOfConvocation: toIntOrNull(f["YEAR OF CONVOCATION copy"]),
    skillCourseRecordId,
  }
}

export function parseSkillCourseRecord(raw: AirtableRaw): AirtableSkillCourseRow {
  const f = raw.fields
  const attachments = f["FMAS Certificate"] as AirtableAttachment[] | undefined
  const first = Array.isArray(attachments) && attachments.length > 0 ? attachments[0] : null
  return {
    id: raw.id,
    skillCourseNumber: toIntOrNull(f["Skill course Number"]) ?? 0,
    yearOfFmas: toIntOrNull(f["Year of FMAS"]),
    presidentName:
      typeof f["President Details"] === "string"
        ? (f["President Details"] as string)
        : null,
    convocationDateAndPlace:
      typeof f["Convocation Date and Place"] === "string"
        ? (f["Convocation Date and Place"] as string)
        : null,
    fmasCertificateAttachmentUrl: first?.url ?? null,
    fmasCertificateFilename: first?.filename ?? null,
  }
}

// Convocation date strings are free-form like:
//   "5th Nov 2015-Mumbai"
//   "02nd November 2023 Raipur"
// Strategy: take the substring after the last hyphen or, if none, after the last 4-digit year.
export function extractConvocationPlace(s: string | null): string | null {
  if (s === null || s === undefined) return null
  if (s.includes("-")) {
    const after = s.slice(s.lastIndexOf("-") + 1).trim()
    if (after) return after
  }
  const m = s.match(/\b\d{4}\b\s*(.+)$/)
  if (m && m[1]) return m[1].trim()
  return s.trim()
}
```

The parsed `skillCourseRecordId` is the Airtable record id (e.g. `"recga0FTGLyZDigYd"`). The seed script (Task 6) resolves it to the integer `Skill course Number` by looking up the corresponding Skill Course record.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/credentials/__tests__/airtable-parser.test.ts`

Expected: All 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/credentials/airtable-parser.ts src/lib/credentials/__tests__/airtable-parser.test.ts
git commit -m "feat(credentials): pure parser for Airtable FMAS records with tests"
```

---

## Task 4: Airtable HTTP client

**Files:**
- Create: `src/lib/credentials/airtable.ts`

- [ ] **Step 1: Implement the client**

Create `src/lib/credentials/airtable.ts`:

```typescript
const BASE_URL = "https://api.airtable.com/v0"

export const AIRTABLE_BASE_ID = "appFOBQXh545T7zg0"
export const TABLE_FMASIANS = "tblf085EgnmIaG8sz"
export const TABLE_SKILL_COURSE = "tblBU1hkL7orELHsD"

interface AirtableRaw {
  id: string
  fields: Record<string, unknown>
}

interface AirtableListResponse {
  records: AirtableRaw[]
  offset?: string
}

function pat(): string {
  const p = process.env.AIRTABLE_PAT
  if (!p) throw new Error("AIRTABLE_PAT not set in environment")
  return p
}

// Generator that yields each record across all pages of a table.
// Airtable returns up to 100 records per page; pagination via 'offset'.
export async function* listAllRecords(
  tableId: string,
  opts: { fields?: string[]; pageSize?: number } = {}
): AsyncGenerator<AirtableRaw, void, unknown> {
  const url = new URL(`${BASE_URL}/${AIRTABLE_BASE_ID}/${tableId}`)
  url.searchParams.set("pageSize", String(opts.pageSize ?? 100))
  if (opts.fields) {
    for (const f of opts.fields) url.searchParams.append("fields[]", f)
  }
  let offset: string | undefined
  do {
    if (offset) url.searchParams.set("offset", offset)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat()}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Airtable ${tableId} ${res.status}: ${text}`)
    }
    const json = (await res.json()) as AirtableListResponse
    for (const rec of json.records) yield rec
    offset = json.offset
  } while (offset)
}

// Download a binary attachment. Airtable attachment URLs are signed and expire,
// so this must be called within the same run as the listing.
export async function downloadAttachment(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Attachment fetch ${res.status}`)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/credentials/airtable.ts
git commit -m "feat(credentials): Airtable PAT client with paginated record generator"
```

---

## Task 5: Supabase queries (TDD where pure, otherwise typed wrappers)

**Files:**
- Create: `src/lib/credentials/queries.ts`

- [ ] **Step 1: Implement the queries**

Create `src/lib/credentials/queries.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CredentialType, MemberCredential, CredentialTemplate } from "./types"

export async function getCredentialForMember(
  db: SupabaseClient,
  amasiNumber: number,
  type: CredentialType
): Promise<MemberCredential | null> {
  const { data, error } = await db
    .from("member_credentials")
    .select("*")
    .eq("amasi_number", amasiNumber)
    .eq("credential_type", type)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    amasiNumber: data.amasi_number,
    credentialType: data.credential_type,
    year: data.year,
    skillCourseId: data.skill_course_id,
    awardedAt: data.awarded_at,
    createdAt: data.created_at,
  }
}

export async function getTemplate(
  db: SupabaseClient,
  type: CredentialType,
  year: number
): Promise<CredentialTemplate | null> {
  const { data, error } = await db
    .from("credential_templates")
    .select("*")
    .eq("credential_type", type)
    .eq("year", year)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    credentialType: data.credential_type,
    year: data.year,
    templatePath: data.template_path,
    presidentName: data.president_name,
    convocationDate: data.convocation_date,
    convocationPlace: data.convocation_place,
  }
}

export async function listAllCredentials(
  db: SupabaseClient,
  type: CredentialType
): Promise<MemberCredential[]> {
  const { data, error } = await db
    .from("member_credentials")
    .select("*")
    .eq("credential_type", type)
    .order("year", { ascending: false })
    .order("amasi_number", { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => ({
    amasiNumber: r.amasi_number,
    credentialType: r.credential_type,
    year: r.year,
    skillCourseId: r.skill_course_id,
    awardedAt: r.awarded_at,
    createdAt: r.created_at,
  }))
}

export async function upsertCredential(
  db: SupabaseClient,
  c: Omit<MemberCredential, "createdAt">
): Promise<void> {
  const { error } = await db.from("member_credentials").upsert(
    {
      amasi_number: c.amasiNumber,
      credential_type: c.credentialType,
      year: c.year,
      skill_course_id: c.skillCourseId,
      awarded_at: c.awardedAt,
    },
    { onConflict: "amasi_number,credential_type,year" }
  )
  if (error) throw error
}

export async function upsertTemplate(
  db: SupabaseClient,
  t: CredentialTemplate
): Promise<void> {
  const { error } = await db.from("credential_templates").upsert(
    {
      credential_type: t.credentialType,
      year: t.year,
      template_path: t.templatePath,
      president_name: t.presidentName,
      convocation_date: t.convocationDate,
      convocation_place: t.convocationPlace,
    },
    { onConflict: "credential_type,year" }
  )
  if (error) throw error
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/credentials/queries.ts
git commit -m "feat(credentials): Supabase query wrappers for credentials"
```

---

## Task 6: Seed script

This script is the one-shot importer that pulls 8,820 FMASIANS rows + per-year templates from Airtable into Supabase.

**Files:**
- Create: `scripts/seed-fmas.ts`
- Create: `public/certificates/fmas/.gitkeep`

- [ ] **Step 1: Create the empty templates directory**

```bash
mkdir -p public/certificates/fmas
touch public/certificates/fmas/.gitkeep
```

- [ ] **Step 2: Write the seed script**

Create `scripts/seed-fmas.ts`:

```typescript
import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { createAdminClient } from "../src/lib/supabase"
import {
  listAllRecords,
  downloadAttachment,
  TABLE_FMASIANS,
  TABLE_SKILL_COURSE,
} from "../src/lib/credentials/airtable"
import {
  parseFmasianRecord,
  parseSkillCourseRecord,
  extractConvocationPlace,
} from "../src/lib/credentials/airtable-parser"
import { upsertCredential, upsertTemplate } from "../src/lib/credentials/queries"

const TEMPLATE_DIR = path.resolve(process.cwd(), "public/certificates/fmas")
const DRY_RUN = process.argv.includes("--dry-run")

async function main() {
  console.log(`[seed-fmas] starting (dryRun=${DRY_RUN})`)
  const db = createAdminClient()

  // 1) Walk all Skill Course records and build a record-id → resolved data map.
  console.log("[seed-fmas] fetching Skill Course records ...")
  const courseById = new Map<string, ReturnType<typeof parseSkillCourseRecord>>()
  let courseCount = 0
  for await (const raw of listAllRecords(TABLE_SKILL_COURSE)) {
    courseById.set(raw.id, parseSkillCourseRecord(raw))
    courseCount++
  }
  console.log(`[seed-fmas] fetched ${courseCount} Skill Course records`)

  // 2) Pick one canonical course per year (the first one we see with an attachment),
  //    download the template, and upsert credential_templates.
  await mkdir(TEMPLATE_DIR, { recursive: true })
  const templateByYear = new Map<number, ReturnType<typeof parseSkillCourseRecord>>()
  for (const c of courseById.values()) {
    if (c.yearOfFmas !== null && c.fmasCertificateAttachmentUrl && !templateByYear.has(c.yearOfFmas)) {
      templateByYear.set(c.yearOfFmas, c)
    }
  }
  console.log(`[seed-fmas] ${templateByYear.size} unique years with templates`)

  for (const [year, course] of templateByYear) {
    const url = course.fmasCertificateAttachmentUrl!
    const filename = course.fmasCertificateFilename ?? `${year}.jpg`
    const ext = path.extname(filename).toLowerCase() || ".jpg"
    const localFile = `${year}${ext}`
    const localPath = path.join(TEMPLATE_DIR, localFile)
    const publicPath = `/certificates/fmas/${localFile}`
    console.log(`[seed-fmas]   year=${year} downloading ${url.slice(0, 60)}...`)
    if (!DRY_RUN) {
      const buf = await downloadAttachment(url)
      await writeFile(localPath, buf)
      await upsertTemplate(db, {
        credentialType: "FMAS",
        year,
        templatePath: publicPath,
        presidentName: course.presidentName,
        convocationDate: course.convocationDateAndPlace,
        convocationPlace: extractConvocationPlace(course.convocationDateAndPlace),
      })
    }
  }

  // 3) Walk FMASIANS records and upsert one credential row per matched member.
  console.log("[seed-fmas] fetching FMASIANS records ...")
  const memberAmasiSet = await loadAmasiNumbers(db)
  console.log(`[seed-fmas] members table has ${memberAmasiSet.size} amasi_number values`)

  let scanned = 0
  let matched = 0
  const skippedNoAmasi: string[] = []
  const skippedNoYear: string[] = []
  const skippedNotInMembers: number[] = []

  for await (const raw of listAllRecords(TABLE_FMASIANS)) {
    scanned++
    const f = parseFmasianRecord(raw)
    if (f.amasiNumber === null) {
      skippedNoAmasi.push(f.id)
      continue
    }
    if (f.yearOfConvocation === null) {
      skippedNoYear.push(`${f.id}/${f.amasiNumber}`)
      continue
    }
    if (!memberAmasiSet.has(f.amasiNumber)) {
      skippedNotInMembers.push(f.amasiNumber)
      continue
    }
    const course = f.skillCourseRecordId ? courseById.get(f.skillCourseRecordId) ?? null : null
    if (!DRY_RUN) {
      await upsertCredential(db, {
        amasiNumber: f.amasiNumber,
        credentialType: "FMAS",
        year: f.yearOfConvocation,
        skillCourseId: course?.skillCourseNumber ?? null,
        awardedAt: null,
      })
    }
    matched++
    if (scanned % 500 === 0) console.log(`[seed-fmas]   scanned=${scanned} matched=${matched}`)
  }

  console.log("[seed-fmas] summary:")
  console.log(`  scanned:                 ${scanned}`)
  console.log(`  matched + upserted:      ${matched}`)
  console.log(`  skipped (no AMASI #):    ${skippedNoAmasi.length}`)
  console.log(`  skipped (no year):       ${skippedNoYear.length}`)
  console.log(`  skipped (not a member):  ${skippedNotInMembers.length}`)
  if (skippedNotInMembers.length && skippedNotInMembers.length <= 50) {
    console.log(`    AMASI #s: ${skippedNotInMembers.join(", ")}`)
  }
}

async function loadAmasiNumbers(db: ReturnType<typeof createAdminClient>): Promise<Set<number>> {
  const set = new Set<number>()
  let from = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await db
      .from("members")
      .select("amasi_number")
      .not("amasi_number", "is", null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) {
      if (typeof r.amasi_number === "number") set.add(r.amasi_number)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return set
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 3: Dry-run**

```bash
npx tsx scripts/seed-fmas.ts --dry-run
```

Expected output (numbers will vary slightly):

```
[seed-fmas] starting (dryRun=true)
[seed-fmas] fetching Skill Course records ...
[seed-fmas] fetched 116 Skill Course records
[seed-fmas] N unique years with templates
[seed-fmas]   year=2015 downloading https://v5.airtableus...
...
[seed-fmas] members table has ~9000 amasi_number values
[seed-fmas]   scanned=500 matched=...
...
[seed-fmas] summary:
  scanned:                 8820
  matched + upserted:      ~7000-8000
  skipped (no AMASI #):    some
  skipped (no year):       some
  skipped (not a member):  some
```

If the dry-run errors out, fix it before proceeding. Common failures:
- `AIRTABLE_PAT not set` — add it to `.env.local`.
- Airtable 401 — PAT lacks scope.
- Supabase error — `members` table has different column names; adjust `loadAmasiNumbers`.

- [ ] **Step 4: Commit (before the real run, in case it lands an idempotent insert that we want to capture)**

```bash
git add scripts/seed-fmas.ts public/certificates/fmas/.gitkeep
git commit -m "feat(scripts): seed-fmas imports FMASIANS + per-year templates from Airtable"
```

- [ ] **Step 5: Real run**

```bash
npx tsx scripts/seed-fmas.ts
```

This downloads ~10-15 template images (1-2 MB each, ~20 MB total) and inserts/upserts ~8,000 credential rows. Should take 1-3 minutes.

- [ ] **Step 6: Spot-check the data**

```bash
# Count of FMAS rows
psql "$DATABASE_URL" -c "SELECT count(*) FROM member_credentials WHERE credential_type='FMAS';"

# Templates per year
psql "$DATABASE_URL" -c "SELECT year, template_path, president_name FROM credential_templates WHERE credential_type='FMAS' ORDER BY year;"

# Sample a row
psql "$DATABASE_URL" -c "SELECT * FROM member_credentials WHERE credential_type='FMAS' LIMIT 5;"
```

- [ ] **Step 7: Commit the downloaded templates**

```bash
git add public/certificates/fmas/
git commit -m "feat(certificates): per-year FMAS template artwork (15 images)"
```

(Templates committed to repo to keep them version-controlled. Total ~20 MB; acceptable for a public Next.js app where image-fetch latency matters.)

---

## Task 7: API route — `/api/credential`

**Files:**
- Create: `src/app/api/credential/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/credential/route.ts`:

```typescript
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getCredentialForMember, getTemplate } from "@/lib/credentials/queries"
import type { CredentialType } from "@/lib/credentials/types"

const VALID_TYPES: CredentialType[] = ["FMAS", "DIPMAS", "MMAS", "COURSE_CERT"]

export async function GET(request: NextRequest) {
  const idParam = request.nextUrl.searchParams.get("id")
  const typeParam = (request.nextUrl.searchParams.get("type") || "").toUpperCase()

  if (!idParam) {
    return Response.json({ status: false, message: "id required" }, { status: 400 })
  }
  if (!VALID_TYPES.includes(typeParam as CredentialType)) {
    return Response.json({ status: false, message: "invalid type" }, { status: 400 })
  }
  const amasiNumber = parseInt(idParam, 10)
  if (!Number.isFinite(amasiNumber)) {
    return Response.json({ status: false, message: "id must be numeric" }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`credential:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
  }

  try {
    const db = createAdminClient()
    const credential = await getCredentialForMember(db, amasiNumber, typeParam as CredentialType)
    if (!credential) {
      return Response.json(
        { status: false, message: "Credential not found" },
        { status: 404 }
      )
    }

    const template = await getTemplate(db, credential.credentialType, credential.year)
    if (!template) {
      console.error(
        `[api/credential] member ${amasiNumber} has ${typeParam} ${credential.year} but no template`
      )
      return Response.json(
        { status: false, message: "Template missing for this credential year" },
        { status: 500 }
      )
    }

    const { data: member, error: mErr } = await db
      .from("members")
      .select("name, amasi_number, email")
      .eq("amasi_number", amasiNumber)
      .single()
    if (mErr || !member) {
      return Response.json({ status: false, message: "Member not found" }, { status: 404 })
    }

    return Response.json({
      status: true,
      credential: {
        type: credential.credentialType,
        year: credential.year,
        skillCourseId: credential.skillCourseId,
        amasiNumber: member.amasi_number,
        name: member.name,
        email: member.email,
        templateUrl: template.templatePath,
        presidentName: template.presidentName,
        convocationPlace: template.convocationPlace,
        convocationDate: template.convocationDate,
      },
    })
  } catch (e) {
    console.error("[api/credential] error", e)
    return Response.json({ status: false, message: "Server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify the endpoint manually**

Start the dev server in one terminal:

```bash
npm run dev
```

In another terminal, hit the endpoint with a known FMAS-holder AMASI number (look one up from the spot-check in Task 6 step 6, e.g. 9169):

```bash
curl -s 'http://localhost:3000/api/credential?type=FMAS&id=9169' | jq .
```

Expected: a JSON body with `status: true` and `credential.type === "FMAS"`.

For a non-Fellow AMASI number (e.g. 1):

```bash
curl -s 'http://localhost:3000/api/credential?type=FMAS&id=1' -w '\n%{http_code}\n'
```

Expected: HTTP 404 with `{ "status": false, "message": "Credential not found" }`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/credential/route.ts
git commit -m "feat(api): GET /api/credential serves typed credential lookup"
```

---

## Task 8: Member-facing FMAS certificate page

This page mirrors `src/app/member/certificate/page.tsx` with three differences: type=FMAS, name-only overlay, FMAS-themed header.

**Files:**
- Create: `src/app/member/fmas-certificate/page.tsx`

- [ ] **Step 1: Implement the page**

Create `src/app/member/fmas-certificate/page.tsx`:

```typescript
"use client"

import { useRef, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  Printer, Loader2, FileImage, FileText,
  Award, CheckCircle2, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { AdminBackLink } from "@/components/ui/admin-back-link"

const certificateCSS = `
@keyframes certFadeIn {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.cert-frame {
  animation: certFadeIn 0.6s ease-out;
  background: linear-gradient(145deg, #fafafa 0%, #f5f5f5 100%);
  box-shadow:
    0 1px 0 rgba(0,0,0,0.03),
    0 4px 8px rgba(0,0,0,0.04),
    0 16px 48px rgba(0,0,0,0.08),
    0 32px 80px rgba(0,0,0,0.06);
}
.cert-inner-shadow {
  box-shadow:
    inset 0 0 0 1px rgba(0,0,0,0.06),
    inset 0 2px 4px rgba(0,0,0,0.02);
}
.verified-glow {
  box-shadow: 0 0 0 3px rgba(34,197,94,0.15), 0 2px 8px rgba(34,197,94,0.1);
}
`

function FmasCertificateContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id")
  const certRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["fmas-certificate", id],
    queryFn: async () => {
      if (!id) return null
      const res = await fetch(`/api/credential?type=FMAS&id=${id}`)
      if (res.status === 404) return { credential: null }
      return res.json()
    },
    enabled: !!id,
    retry: false,
  })

  const cert = data?.credential

  const captureCanvas = async (scale = 2) => {
    if (!certRef.current) return null
    const html2canvas = (await import("html2canvas")).default
    return html2canvas(certRef.current, { scale, backgroundColor: "#fff", useCORS: true })
  }

  const handleDownloadPNG = async () => {
    setDownloading("png")
    try {
      const canvas = await captureCanvas(3)
      if (!canvas) return
      const link = document.createElement("a")
      link.download = `AMASI-FMAS-${cert.amasiNumber}-${cert.year}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
      toast.success("FMAS certificate downloaded as PNG")
    } catch {
      toast.error("Download failed")
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadPDF = async () => {
    setDownloading("pdf")
    try {
      const canvas = await captureCanvas(2)
      if (!canvas) return
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const imgData = canvas.toDataURL("image/png")
      const pageW = 210, pageH = 297, margin = 15
      const availW = pageW - margin * 2, availH = pageH - margin * 2
      const ratio = canvas.width / canvas.height
      let drawW = availW, drawH = drawW / ratio
      if (drawH > availH) { drawH = availH; drawW = drawH * ratio }
      pdf.addImage(imgData, "PNG", (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH)
      pdf.save(`AMASI-FMAS-${cert.amasiNumber}-${cert.year}.pdf`)
      toast.success("FMAS certificate downloaded as PDF (A4)")
    } catch {
      toast.error("PDF generation failed")
    } finally {
      setDownloading(null)
    }
  }

  const handlePrint = async () => {
    if (!certRef.current) return
    try {
      const canvas = await captureCanvas(2)
      if (!canvas) return
      const win = window.open("")
      if (!win) return
      win.document.write(`<html><head><title>FMAS Certificate - ${cert.amasiNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          @media print { body { margin: 0; } }
          body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: white; }
          img { max-width: 100%; max-height: 100vh; }
        </style></head>
        <body><img src="${canvas.toDataURL("image/png")}" /></body></html>`)
      win.document.close()
      setTimeout(() => win.print(), 500)
    } catch {
      toast.error("Print failed")
    }
  }

  if (!id) return (
    <div className="text-center py-16 space-y-3">
      <Award className="h-12 w-12 mx-auto text-muted-foreground/30" />
      <p className="text-muted-foreground">No membership number provided.</p>
    </div>
  )

  if (isLoading) return (
    <div className="text-center py-16">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      <p className="text-muted-foreground mt-3">Loading your FMAS certificate...</p>
    </div>
  )

  if (isError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertCircle className="h-10 w-10 text-destructive mb-3" />
      <p className="text-lg font-medium">Failed to load certificate</p>
    </div>
  )

  if (!cert) return (
    <div className="text-center py-16 space-y-3">
      <Award className="h-12 w-12 mx-auto text-muted-foreground/30" />
      <p className="text-muted-foreground">No FMAS credential on record for this AMASI number.</p>
      <p className="text-xs text-muted-foreground/70">If you believe this is incorrect, please contact AMASI office.</p>
    </div>
  )

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <style dangerouslySetInnerHTML={{ __html: certificateCSS }} />

      <div className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
          <Award className="h-7 w-7 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">FMAS Certificate</h1>
          <p className="text-muted-foreground text-sm">Fellow of Minimal Access Surgery &mdash; Dr. {cert.name}</p>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="verified-glow inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-50 border border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800">Awarded {cert.year}</span>
        </div>
      </div>

      <div className="cert-frame rounded-2xl p-4 sm:p-6">
        <div className="cert-inner-shadow rounded-xl overflow-hidden bg-white">
          <div className="overflow-auto flex justify-center">
            <div
              ref={certRef}
              style={{ width: "707px", height: "1000px", position: "relative", background: "#fff" }}
            >
              <img
                src={cert.templateUrl}
                alt="FMAS certificate"
                crossOrigin="anonymous"
                style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
              />
              <div style={{
                position: "absolute",
                top: "52%",
                left: 0,
                right: 0,
                textAlign: "center",
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}>
                <p style={{
                  fontSize: "30px",
                  fontWeight: "bold",
                  color: "#111",
                  margin: 0,
                }}>
                  Dr. {cert.name}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Button onClick={handleDownloadPNG} size="lg" className="gap-2" disabled={downloading === "png"}>
            {downloading === "png" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
            PNG
          </Button>
          <Button onClick={handleDownloadPDF} size="lg" variant="outline" className="gap-2" disabled={downloading === "pdf"}>
            {downloading === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            PDF (A4)
          </Button>
          <Button variant="outline" onClick={handlePrint} size="lg" className="gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {(cert.presidentName || cert.convocationPlace) && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-1 text-xs text-muted-foreground">
          {cert.year && <p>Year of convocation: <strong>{cert.year}</strong></p>}
          {cert.convocationPlace && <p>Convocation: <strong>{cert.convocationPlace}</strong></p>}
          {cert.presidentName && <p>President: <strong>{cert.presidentName}</strong></p>}
        </div>
      )}
    </div>
  )
}

export default function FmasCertificatePage() {
  return (
    <>
      <AdminBackLink />
      <Suspense fallback={
        <div className="p-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      }>
        <FmasCertificateContent />
      </Suspense>
    </>
  )
}
```

This is a client-router-hook page (`useSearchParams`) wrapped in `<Suspense>` per the rule in `AGENTS.md`.

- [ ] **Step 2: Local build check**

Per `AGENTS.md`: any change touching `useSearchParams` requires a local `next build` before pushing.

```bash
npx next build
```

Expected: build succeeds, the new page is listed in the route output.

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
# In a browser:
open 'http://localhost:3000/member/fmas-certificate?id=9169'
```

Expected: page renders the FMAS template with "Dr. Varsha Saboo" overlaid centrally, PNG/PDF/Print buttons work.

```bash
open 'http://localhost:3000/member/fmas-certificate?id=1'
```

Expected: empty state "No FMAS credential on record".

- [ ] **Step 4: Commit**

```bash
git add src/app/member/fmas-certificate/
git commit -m "feat(member): /member/fmas-certificate page with name overlay"
```

---

## Task 9: Conditional FMAS card on `/member` dashboard

**Files:**
- Modify: `src/app/member/page.tsx`

- [ ] **Step 1: Find the existing certificate card**

Open `src/app/member/page.tsx` and locate where the existing membership-certificate card is rendered. Search for the string `"certificate"` (the existing tab name) and find the card where the Certificate icon appears next to the membership-cert link.

The exact location varies; the card is in the dashboard `overview` tab section, typically near the membership-card and profile cards.

- [ ] **Step 2: Add the FMAS query and card**

Above the dashboard JSX, add the credentials query (alongside other queries):

```typescript
const fmasQuery = useQuery({
  queryKey: ["fmas-credential", member?.amasi_number],
  queryFn: async () => {
    if (!member?.amasi_number) return { credential: null }
    const res = await fetch(`/api/credential?type=FMAS&id=${member.amasi_number}`)
    if (res.status === 404) return { credential: null }
    return res.json()
  },
  enabled: !!member?.amasi_number && phase === "dashboard",
  retry: false,
})

const hasFmas = !!fmasQuery.data?.credential
```

Then add a new card next to the existing membership-certificate card. Use the same `<Card>` shape as the membership-cert card but link to `/member/fmas-certificate?id={member.amasi_number}`. The card is conditional:

```tsx
{hasFmas && (
  <Link href={`/member/fmas-certificate?id=${member.amasi_number}`}>
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-5 space-y-2">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-600" />
          <h3 className="font-semibold">FMAS Certificate</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Fellow of Minimal Access Surgery &mdash; awarded {fmasQuery.data?.credential?.year}
        </p>
        <div className="flex items-center text-xs text-primary">
          View &amp; download <ChevronRight className="h-3 w-3 ml-0.5" />
        </div>
      </CardContent>
    </Card>
  </Link>
)}
```

(The exact JSX structure should match the surrounding cards in the file. Adjust class names to match existing cards' styles.)

- [ ] **Step 3: Local build check (touches `useQuery`, not a router hook, but still safer)**

```bash
npx next build
```

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

- Log in as an AMASI member who is a Fellow (e.g. AMASI #9169) → the FMAS card appears.
- Log in as a non-Fellow → the FMAS card does NOT appear.

- [ ] **Step 5: Commit**

```bash
git add src/app/member/page.tsx
git commit -m "feat(member): conditional FMAS card on dashboard for Fellows"
```

---

## Task 10: Admin verification page `/admin/fmas`

**Files:**
- Create: `src/app/admin/fmas/page.tsx`

- [ ] **Step 1: Implement the admin page**

Create `src/app/admin/fmas/page.tsx`:

```typescript
"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Loader2, Award } from "lucide-react"
import { Input } from "@/components/ui/input"
import Link from "next/link"

interface FmasRow {
  amasi_number: number
  name: string | null
  year: number
  skill_course_id: number | null
  convocation_place: string | null
}

export default function AdminFmasPage() {
  const [q, setQ] = useState("")

  const { data, isLoading } = useQuery<{ rows: FmasRow[] }>({
    queryKey: ["admin-fmas-list"],
    queryFn: async () => {
      const res = await fetch("/api/admin/fmas")
      return res.json()
    },
  })

  const filtered = useMemo(() => {
    const rows = data?.rows ?? []
    if (!q) return rows
    const needle = q.toLowerCase()
    return rows.filter(
      (r) =>
        String(r.amasi_number).includes(needle) ||
        (r.name ?? "").toLowerCase().includes(needle)
    )
  }, [data, q])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Award className="h-6 w-6 text-amber-600" />
        <h1 className="text-2xl font-bold">FMAS Holders</h1>
        <span className="text-sm text-muted-foreground">
          {data ? `${data.rows.length} total` : "..."}
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or AMASI #"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">AMASI #</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-4 py-2 font-medium">Skill Course #</th>
                <th className="px-4 py-2 font-medium">Convocation</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.amasi_number}-${r.year}`} className="border-t">
                  <td className="px-4 py-2 font-mono">{r.amasi_number}</td>
                  <td className="px-4 py-2">{r.name ?? "—"}</td>
                  <td className="px-4 py-2">{r.year}</td>
                  <td className="px-4 py-2">{r.skill_course_id ?? "—"}</td>
                  <td className="px-4 py-2">{r.convocation_place ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Link
                      className="text-primary hover:underline"
                      href={`/member/fmas-certificate?id=${r.amasi_number}`}
                      target="_blank"
                    >
                      View cert
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the admin API route**

Create `src/app/api/admin/fmas/route.ts`:

```typescript
import { createAdminClient } from "@/lib/supabase"

export async function GET() {
  const db = createAdminClient()

  // Join member_credentials → members → credential_templates to get convocation_place.
  // Supabase doesn't do raw joins via select; use two queries and merge in JS.
  const { data: creds, error } = await db
    .from("member_credentials")
    .select("amasi_number, year, skill_course_id")
    .eq("credential_type", "FMAS")
    .order("year", { ascending: false })
    .order("amasi_number", { ascending: true })
  if (error) {
    return Response.json({ rows: [], error: error.message }, { status: 500 })
  }

  const amasiNumbers = (creds ?? []).map((c) => c.amasi_number)
  const { data: members } = amasiNumbers.length
    ? await db.from("members").select("amasi_number, name").in("amasi_number", amasiNumbers)
    : { data: [] }
  const nameByAmasi = new Map<number, string>()
  for (const m of members ?? []) {
    if (typeof m.amasi_number === "number" && typeof m.name === "string") {
      nameByAmasi.set(m.amasi_number, m.name)
    }
  }

  const years = Array.from(new Set((creds ?? []).map((c) => c.year)))
  const { data: templates } = years.length
    ? await db
        .from("credential_templates")
        .select("year, convocation_place")
        .eq("credential_type", "FMAS")
        .in("year", years)
    : { data: [] }
  const placeByYear = new Map<number, string | null>()
  for (const t of templates ?? []) {
    placeByYear.set(t.year, t.convocation_place ?? null)
  }

  const rows = (creds ?? []).map((c) => ({
    amasi_number: c.amasi_number,
    name: nameByAmasi.get(c.amasi_number) ?? null,
    year: c.year,
    skill_course_id: c.skill_course_id,
    convocation_place: placeByYear.get(c.year) ?? null,
  }))

  return Response.json({ rows })
}
```

This route is admin-only by file path (`/admin/*`). If the project's `middleware.ts` already enforces admin auth on `/admin/*` and `/api/admin/*`, no extra check is needed; otherwise add a guard inline.

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
open 'http://localhost:3000/admin/fmas'
```

Expected: a table with ~8,000 rows. Search "varsha" → finds Dr. Varsha Saboo. Click "View cert" → opens her FMAS certificate.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/fmas/page.tsx src/app/api/admin/fmas/route.ts
git commit -m "feat(admin): /admin/fmas verification table for FMAS holders"
```

---

## Task 11: Members admin list — Credentials column

**Files:**
- Modify: `src/app/members/page.tsx`
- Modify: `src/app/api/members/route.ts` (or whichever route serves the admin members list — confirm by reading the file)

- [ ] **Step 1: Identify the members-list API route**

```bash
ls src/app/api/members/
```

Open the GET handler that serves the admin /members list (likely `src/app/api/members/route.ts`). Read it to confirm the response shape.

- [ ] **Step 2: Extend the API to include credentials**

In the members-list API response, after fetching the page of members, fetch their credentials in one batch:

```typescript
// After: const { data: members } = ...
const amasiNumbers = (members ?? []).map((m) => m.amasi_number).filter((n): n is number => typeof n === "number")
let credentialsByAmasi: Record<number, { type: string; year: number }[]> = {}
if (amasiNumbers.length) {
  const { data: creds } = await db
    .from("member_credentials")
    .select("amasi_number, credential_type, year")
    .in("amasi_number", amasiNumbers)
  for (const c of creds ?? []) {
    const list = credentialsByAmasi[c.amasi_number] ?? []
    list.push({ type: c.credential_type, year: c.year })
    credentialsByAmasi[c.amasi_number] = list
  }
}

// In the response, attach credentials per member:
const enrichedMembers = (members ?? []).map((m) => ({
  ...m,
  credentials: credentialsByAmasi[m.amasi_number] ?? [],
}))
```

- [ ] **Step 3: Render a Credentials column in `/members` page**

In `src/app/members/page.tsx`, within the table view, add a new column header "Credentials" next to the existing columns. In each row, render badges:

```tsx
<td className="px-4 py-2">
  {member.credentials?.length ? (
    member.credentials.map((c: { type: string; year: number }) => (
      <Badge
        key={`${c.type}-${c.year}`}
        className="mr-1 bg-amber-50 text-amber-700 border border-amber-200"
      >
        {c.type} {c.year}
      </Badge>
    ))
  ) : (
    <span className="text-muted-foreground/40 text-xs">—</span>
  )}
</td>
```

(For grid view, attach a smaller indicator next to the membership-type badge, e.g. a small `Award` icon if `credentials.length > 0`.)

- [ ] **Step 4: Add a "Has FMAS" filter chip**

In the existing filter bar, add a toggle/chip for "Has FMAS". On the server, when the query param `hasFmas=1` is present, restrict the query:

```typescript
let amasiInList: number[] | null = null
if (url.searchParams.get("hasFmas") === "1") {
  const { data: fmasRows } = await db
    .from("member_credentials")
    .select("amasi_number")
    .eq("credential_type", "FMAS")
  amasiInList = (fmasRows ?? []).map((r) => r.amasi_number)
}

// Then in the members query:
let q = db.from("members").select(...)
if (amasiInList) q = q.in("amasi_number", amasiInList)
```

(For ~8,000 IDs this is fine via Supabase `in()`; if it ever balloons, switch to a SQL view.)

In the client, wire the filter to a state variable and append `&hasFmas=1` to the fetch URL.

- [ ] **Step 5: Local build check**

```bash
npx next build
```

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
open 'http://localhost:3000/members'
```

Expected: each row shows credential badges if any. Click "Has FMAS" filter → list narrows to ~8,000 Fellows.

- [ ] **Step 7: Commit**

```bash
git add src/app/members/page.tsx src/app/api/members/route.ts
git commit -m "feat(admin): credentials column + Has FMAS filter on /members"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, including the new `airtable-parser.test.ts`.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Run a final local build**

```bash
npx next build
```

Expected: build succeeds; new routes listed:
- `/api/admin/fmas`
- `/api/credential`
- `/admin/fmas`
- `/member/fmas-certificate`

- [ ] **Step 4: Push**

```bash
git push
```

---

## Spec coverage check

Verify each spec section has a corresponding task:

| Spec section | Task |
|---|---|
| Data model — `member_credentials` | Task 1 |
| Data model — `credential_templates` | Task 1 |
| Sync from Airtable | Tasks 3-6 |
| `/api/credential` endpoint | Task 7 |
| `/member/fmas-certificate` page | Task 8 |
| Conditional FMAS card on `/member` | Task 9 |
| `/admin/fmas` verification page | Task 10 |
| `/members` Credentials column + filter | Task 11 |
| Out-of-scope items | (intentionally not implemented) |

All sections covered. The implementation is complete after Task 12 passes.
