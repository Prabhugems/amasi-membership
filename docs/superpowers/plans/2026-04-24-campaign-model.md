# Campaign Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded, audit-log-backed "Email Campaigns" feature with a first-class campaign model (two tables + code-defined template registry) that supports multiple campaign types, honest attribution, resume-safe batched sending, marketing opt-out, and a correct rate limiter.

**Architecture:** Promote campaigns out of `membership_audit_log` JSONB into `campaigns` and `campaign_recipients` tables. Campaign creation materialises recipient rows up front from a code-defined segment; sending advances batches by updating `sent_at` on recipient rows; attribution writes `update_detected_at` when members change a campaign's target field for the first time (strictly after `sent_at`). A typed registry holds templates, segments, and target fields — no SQL-in-a-cell. Keep `logMembershipAuditEvent` writes as an audit trail, not the source of truth.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres 17), Resend, Vitest (new, for pure modules), Playwright (existing, for admin flow).

---

## Key Decisions (locked)

**Attribution rule (prose, authoritative):**
A `campaign_recipients` row is credited with a member update when, for some field `f` in the campaign's `target_fields`, the member's value of `f` transitioned from `NULL` to non-`NULL` at time `t`, **strictly after** the recipient's `sent_at`, and no newer campaign targeting the same `f` had `sent_at` in `(r.sent_at, t)` for that member (the most-recent-prior wins). Only the **first** `NULL → not-NULL` transition per field per recipient is credited; subsequent re-nullings and re-fills do not re-credit. Updates with `sent_at = t` exactly are ignored (require strict inequality) to avoid counting in-flight edits.

**Segment shape:** Each template exports `buildSegment(query) => query` that receives a base `supabase.from("members").select(...)` builder and returns it with filters applied. Segments are code, not stored SQL. No `eval`, no user-authored SQL fragments.

**Target fields live on both the registry entry and the campaign row.** The registry is the source of truth at send time; the `campaigns.target_fields` column is a frozen snapshot so attribution survives future registry changes.

**Opt-out categories:**
- `marketing_opt_out_at timestamptz NULL` on `members`.
- Every template declares `category: 'marketing' | 'statutory'`.
- Sender filters out `marketing_opt_out_at IS NOT NULL` for marketing campaigns. Statutory campaigns ignore it. This is enforced in `buildSegment`'s final wrapping, not in per-template code.
- Unsubscribe link appears only in marketing emails. Out of scope for this plan (separate follow-up), but the column + category are introduced now.

**Rate-limit fix:** Replace the `sent % 10` hack with a "next-allowed-time" pacer. Every iteration (success or failure) advances the clock. Default pace: 500 ms between sends (2 req/s; matches Resend free tier).

**No backfill.** Investigation confirmed zero `campaign_sent` rows in `membership_audit_log`. The migration is additive and rollback is trivial.

**Resume semantics.** Campaign creation materialises all recipient rows at once (`INSERT ... ON CONFLICT DO NOTHING`). "Send next batch" picks `N` rows where `sent_at IS NULL` ordered by recipient id. Re-invocation is safe; segments don't drift mid-campaign.

---

## File Structure

**Create:**
- `sql/022_campaigns.sql` — tables, indexes, members column.
- `sql/022_campaigns_rollback.sql` — emergency rollback.
- `src/lib/campaigns/types.ts` — shared types (`CampaignCategory`, `TemplateEntry`, `MemberSegmentRow`).
- `src/lib/campaigns/registry.ts` — `TEMPLATES` map + `getTemplate(key)`.
- `src/lib/campaigns/templates/profile-update-missing-pg-degree.ts` — first template entry (migrated from the existing route).
- `src/lib/campaigns/rate-limiter.ts` — `createPacer(minGapMs)` → `await pacer.wait()`.
- `src/lib/campaigns/sender.ts` — `sendNextBatch({ campaignId, limit })`.
- `src/lib/campaigns/create.ts` — `createCampaign({ templateKey, createdBy })` materialises recipients.
- `src/lib/campaigns/attribution.ts` — `creditUpdateIfRelevant({ memberId, changedFields, at }, supabase)`.
- `src/app/api/campaigns/[id]/send/route.ts` — `POST` advances one batch for a campaign.
- `src/lib/campaigns/__tests__/registry.test.ts`
- `src/lib/campaigns/__tests__/rate-limiter.test.ts`
- `src/lib/campaigns/__tests__/attribution.test.ts`
- `tests/campaigns-admin.spec.ts` — Playwright admin flow.
- `vitest.config.ts`

**Modify:**
- `package.json` — add `vitest`, `@vitest/ui`, `tsx` devDeps; add `test` and `test:watch` scripts.
- `src/app/api/campaigns/route.ts` — `GET` reads from new tables; `POST` creates a campaign + returns id.
- `src/app/campaigns/page.tsx` — template dropdown, per-campaign attribution count, "Send next batch" per campaign, pending count.
- `src/app/api/members/[id]/update/route.ts` — call `creditUpdateIfRelevant` after the audit insert.

---

## Task 0: Set up Vitest for pure-module tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install dev deps**

```bash
npm install -D vitest @vitest/ui tsx
```

- [ ] **Step 2: Add test scripts to `package.json`**

In `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

- [ ] **Step 4: Smoke-test that Vitest runs**

```bash
npx vitest run --reporter=verbose
```

Expected: `No test files found` exit 0 (no crash). If Vitest picks up Playwright specs under `tests/`, tighten `include` — the config above already scopes to `src/**`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for pure-module unit tests"
```

---

## Task 1: SQL migration — tables, indexes, members column

**Files:**
- Create: `sql/022_campaigns.sql`
- Create: `sql/022_campaigns_rollback.sql`

- [ ] **Step 1: Write `sql/022_campaigns.sql`**

```sql
-- 022: Campaign model — promote campaigns out of membership_audit_log JSONB.
-- Zero existing campaign_sent rows (verified 2026-04-24), so no backfill.

CREATE TABLE IF NOT EXISTS campaigns (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key    text NOT NULL,
  name            text NOT NULL,
  category        text NOT NULL CHECK (category IN ('marketing','statutory')),
  target_fields   text[] NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sending','paused','completed')),
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status_created
  ON campaigns(status, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id          uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id            uuid NOT NULL,
  email                text NOT NULL,
  amasi_number         integer,
  name                 text,
  sent_at              timestamptz,
  send_error           text,
  update_detected_at   timestamptz,
  created_at           timestamptz DEFAULT now(),
  UNIQUE(campaign_id, member_id)
);
-- Sender picks next batch: sent_at IS NULL first, stable order.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_pending
  ON campaign_recipients(campaign_id, sent_at NULLS FIRST, id);
-- Attribution lookups from members-update handler.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_member_sent
  ON campaign_recipients(member_id, sent_at)
  WHERE sent_at IS NOT NULL AND update_detected_at IS NULL;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz;
```

- [ ] **Step 2: Write `sql/022_campaigns_rollback.sql`**

```sql
-- Rollback for 022_campaigns.sql. Safe because no production consumers
-- depend on these tables yet and no historical campaign rows exist.

DROP TABLE IF EXISTS campaign_recipients;
DROP TABLE IF EXISTS campaigns;
ALTER TABLE members DROP COLUMN IF EXISTS marketing_opt_out_at;
```

- [ ] **Step 3: Apply migration against dev database**

Use the Supabase MCP `apply_migration` tool (project `jmdwxymbgxwdsmcwbahp`) with the `022_campaigns.sql` contents, or paste into the Supabase SQL editor. Do **not** use `execute_sql` for DDL.

- [ ] **Step 4: Verify**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('campaigns','campaign_recipients');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'members' AND column_name = 'marketing_opt_out_at';

SELECT indexname FROM pg_indexes
WHERE tablename IN ('campaigns','campaign_recipients')
ORDER BY indexname;
```

Expected: two tables returned, one column returned, three non-PK indexes returned (`idx_campaigns_status_created`, `idx_campaign_recipients_campaign_pending`, `idx_campaign_recipients_member_sent`).

- [ ] **Step 5: Commit**

```bash
git add sql/022_campaigns.sql sql/022_campaigns_rollback.sql
git commit -m "feat(sql): campaigns + campaign_recipients tables, marketing opt-out column"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/lib/campaigns/types.ts`

- [ ] **Step 1: Write `src/lib/campaigns/types.ts`**

```ts
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js"

export type CampaignCategory = "marketing" | "statutory"

export type CampaignStatus = "draft" | "sending" | "paused" | "completed"

export interface MemberSegmentRow {
  id: string
  amasi_number: number
  name: string | null
  email: string
  pg_degree: string | null
  profile_photo: string | null
  date_of_birth: string | null
  membership_type: string | null
  marketing_opt_out_at: string | null
}

export const MEMBER_SEGMENT_COLUMNS =
  "id,amasi_number,name,email,pg_degree,profile_photo,date_of_birth,membership_type,marketing_opt_out_at"

export interface TemplateEntry {
  key: string
  name: string
  category: CampaignCategory
  targetFields: (keyof MemberSegmentRow)[]
  buildSegment: (
    query: PostgrestFilterBuilder<any, any, MemberSegmentRow[]>
  ) => PostgrestFilterBuilder<any, any, MemberSegmentRow[]>
  subject: (m: MemberSegmentRow) => string
  html: (m: MemberSegmentRow, ctx: { baseUrl: string }) => string
}

export interface CampaignRow {
  id: string
  template_key: string
  name: string
  category: CampaignCategory
  target_fields: string[]
  status: CampaignStatus
  created_by: string | null
  created_at: string
  completed_at: string | null
}

export interface CampaignRecipientRow {
  id: string
  campaign_id: string
  member_id: string
  email: string
  amasi_number: number | null
  name: string | null
  sent_at: string | null
  send_error: string | null
  update_detected_at: string | null
  created_at: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/campaigns/types.ts
git commit -m "feat(campaigns): shared types"
```

---

## Task 3: Rate limiter (TDD)

**Files:**
- Create: `src/lib/campaigns/rate-limiter.ts`
- Create: `src/lib/campaigns/__tests__/rate-limiter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/campaigns/__tests__/rate-limiter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createPacer } from "../rate-limiter"

describe("createPacer", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("first wait() resolves immediately", async () => {
    const pacer = createPacer(500)
    const p = pacer.wait()
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()
  })

  it("second wait() waits minGapMs from the first", async () => {
    const pacer = createPacer(500)
    await pacer.wait()
    let resolved = false
    pacer.wait().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(499)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })

  it("pace advances on every call, regardless of caller outcome", async () => {
    const pacer = createPacer(100)
    await pacer.wait()   // t=0
    await vi.advanceTimersByTimeAsync(100)
    await pacer.wait()   // t=100
    await vi.advanceTimersByTimeAsync(100)
    await pacer.wait()   // t=200 — three calls in 200ms is correct for 100ms gap
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run src/lib/campaigns/__tests__/rate-limiter.test.ts
```

Expected: FAIL, `Cannot find module '../rate-limiter'`.

- [ ] **Step 3: Implement `src/lib/campaigns/rate-limiter.ts`**

```ts
export interface Pacer {
  wait: () => Promise<void>
}

export function createPacer(minGapMs: number): Pacer {
  let nextAllowed = 0
  return {
    async wait() {
      const now = Date.now()
      const delay = Math.max(0, nextAllowed - now)
      nextAllowed = Math.max(now, nextAllowed) + minGapMs
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
      }
    },
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run src/lib/campaigns/__tests__/rate-limiter.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/rate-limiter.ts src/lib/campaigns/__tests__/rate-limiter.test.ts
git commit -m "feat(campaigns): pacer utility with tests"
```

---

## Task 4: Template registry + first template (TDD)

**Files:**
- Create: `src/lib/campaigns/templates/profile-update-missing-pg-degree.ts`
- Create: `src/lib/campaigns/registry.ts`
- Create: `src/lib/campaigns/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/campaigns/__tests__/registry.test.ts
import { describe, it, expect } from "vitest"
import { getTemplate, listTemplates } from "../registry"

describe("template registry", () => {
  it("returns the profile_update_missing_pg_degree template", () => {
    const t = getTemplate("profile_update_missing_pg_degree")
    expect(t.key).toBe("profile_update_missing_pg_degree")
    expect(t.category).toBe("marketing")
    expect(t.targetFields).toEqual(["pg_degree"])
  })

  it("throws for unknown keys", () => {
    expect(() => getTemplate("does_not_exist")).toThrow(/unknown template/i)
  })

  it("lists at least one template", () => {
    expect(listTemplates().length).toBeGreaterThan(0)
  })

  it("subject and html render with a sample member", () => {
    const t = getTemplate("profile_update_missing_pg_degree")
    const sample = {
      id: "m1", amasi_number: 1234, name: "Dr. Test",
      email: "t@example.com", pg_degree: null, profile_photo: null,
      date_of_birth: null, membership_type: "LM", marketing_opt_out_at: null,
    }
    expect(t.subject(sample)).toContain("1234")
    expect(t.html(sample, { baseUrl: "https://example.com" })).toContain("Dr. Test")
    expect(t.html(sample, { baseUrl: "https://example.com" })).toContain("example.com/member")
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run src/lib/campaigns/__tests__/registry.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/lib/campaigns/templates/profile-update-missing-pg-degree.ts`**

```ts
import type { TemplateEntry } from "../types"
import { escapeHtml } from "@/lib/html-escape"

export const profileUpdateMissingPgDegree: TemplateEntry = {
  key: "profile_update_missing_pg_degree",
  name: "Profile Update — Missing PG Degree",
  category: "marketing",
  targetFields: ["pg_degree"],

  buildSegment: (q) =>
    q.is("pg_degree", null)
      .not("email", "like", "noemail-%")
      .order("amasi_number", { ascending: false }),

  subject: (m) => `AMASI Member #${m.amasi_number} — Please Update Your Profile`,

  html: (m, { baseUrl }) => {
    const rawName = m.name || "Member"
    const firstName = escapeHtml(rawName.split(" ")[0])
    const safeEmail = escapeHtml(m.email)
    const amasi = escapeHtml(String(m.amasi_number))
    return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px;">Dear Dr. ${firstName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          We are updating our membership records and noticed that your profile is incomplete.
          Your AMASI membership number is <strong>#${amasi}</strong>.
        </p>
        <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="color: #92400e; font-weight: bold; margin: 0 0 8px;">Please update the following:</p>
          <ol style="color: #92400e; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>PG Degree &amp; Specialisation</li>
            <li>Profile Photo (passport-size)</li>
            <li>Date of Birth</li>
            <li>Contact Number</li>
            <li>Address Details</li>
          </ol>
        </div>
        <div style="text-align: center; margin: 28px 0 16px;">
          <a href="${baseUrl}/member" style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">Update My Profile</a>
        </div>
        <p style="color: #555; font-size: 13px;">Log in with your registered email <strong>${safeEmail}</strong> and verify via OTP.</p>
        <p style="color: #555; font-size: 13px;">If you have questions, contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
      </div>
    </div>`
  },
}
```

- [ ] **Step 4: Write `src/lib/campaigns/registry.ts`**

```ts
import type { TemplateEntry } from "./types"
import { profileUpdateMissingPgDegree } from "./templates/profile-update-missing-pg-degree"

const TEMPLATES: Record<string, TemplateEntry> = {
  [profileUpdateMissingPgDegree.key]: profileUpdateMissingPgDegree,
}

export function getTemplate(key: string): TemplateEntry {
  const t = TEMPLATES[key]
  if (!t) throw new Error(`unknown template: ${key}`)
  return t
}

export function listTemplates(): TemplateEntry[] {
  return Object.values(TEMPLATES)
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
npx vitest run src/lib/campaigns/__tests__/registry.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/campaigns/registry.ts src/lib/campaigns/templates/ src/lib/campaigns/__tests__/registry.test.ts
git commit -m "feat(campaigns): template registry + first profile-update template"
```

---

## Task 5: Create-campaign helper (materialise recipients)

**Files:**
- Create: `src/lib/campaigns/create.ts`

- [ ] **Step 1: Write `src/lib/campaigns/create.ts`**

```ts
import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getTemplate } from "./registry"
import { MEMBER_SEGMENT_COLUMNS, type MemberSegmentRow } from "./types"

export interface CreateCampaignResult {
  campaignId: string
  totalRecipients: number
}

export async function createCampaign(params: {
  templateKey: string
  createdBy: string
  supabase?: SupabaseClient
}): Promise<CreateCampaignResult> {
  const template = getTemplate(params.templateKey)
  const db = params.supabase ?? createAdminClient()

  // Insert campaign row.
  const { data: campaign, error: insErr } = await db
    .from("campaigns")
    .insert({
      template_key: template.key,
      name: template.name,
      category: template.category,
      target_fields: template.targetFields,
      status: "sending",
      created_by: params.createdBy,
    })
    .select("id")
    .single()
  if (insErr || !campaign) {
    throw new Error(`failed to create campaign: ${insErr?.message ?? "unknown"}`)
  }

  // Resolve segment. Wrap with marketing opt-out filter when category = 'marketing'.
  let query = db.from("members").select(MEMBER_SEGMENT_COLUMNS)
  query = template.buildSegment(query as any) as any
  if (template.category === "marketing") {
    query = (query as any).is("marketing_opt_out_at", null)
  }
  const { data: members, error: segErr } = await query
  if (segErr) {
    throw new Error(`segment query failed: ${segErr.message}`)
  }

  const rows = (members ?? []) as MemberSegmentRow[]
  if (rows.length === 0) {
    await db.from("campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
    return { campaignId: campaign.id, totalRecipients: 0 }
  }

  // Materialise recipients. ON CONFLICT DO NOTHING via upsert ignoreDuplicates.
  const recipientRows = rows.map((m) => ({
    campaign_id: campaign.id,
    member_id: m.id,
    email: m.email,
    amasi_number: m.amasi_number,
    name: m.name,
  }))

  // Chunk to avoid giant inserts. 500 rows per chunk is safe for Supabase.
  for (let i = 0; i < recipientRows.length; i += 500) {
    const chunk = recipientRows.slice(i, i + 500)
    const { error: recErr } = await db
      .from("campaign_recipients")
      .upsert(chunk, { onConflict: "campaign_id,member_id", ignoreDuplicates: true })
    if (recErr) throw new Error(`recipient insert failed: ${recErr.message}`)
  }

  return { campaignId: campaign.id, totalRecipients: recipientRows.length }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors in new files.

- [ ] **Step 3: Commit**

```bash
git add src/lib/campaigns/create.ts
git commit -m "feat(campaigns): create-campaign helper materialises recipient rows"
```

---

## Task 6: Sender (batch send with pacer + audit log trail)

**Files:**
- Create: `src/lib/campaigns/sender.ts`

- [ ] **Step 1: Write `src/lib/campaigns/sender.ts`**

```ts
import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { getTemplate } from "./registry"
import { createPacer } from "./rate-limiter"
import { logMembershipAuditEvent } from "@/lib/audit-log"
import type { CampaignRecipientRow, CampaignRow, MemberSegmentRow } from "./types"

const resend = new Resend(process.env.RESEND_API_KEY)
const fromEmail = process.env.RESEND_FROM_EMAIL || "AMASI <noreply@amasi.org>"
const baseUrl = "https://membership.amasi.org"

const DEFAULT_GAP_MS = 500 // 2 req/s, matches Resend free tier

export interface SendBatchResult {
  sent: number
  failed: number
  remaining: number
}

export async function sendNextBatch(params: {
  campaignId: string
  limit?: number
  supabase?: SupabaseClient
}): Promise<SendBatchResult> {
  const db = params.supabase ?? createAdminClient()
  const limit = params.limit ?? 100

  const { data: campaign, error: campErr } = await db
    .from("campaigns")
    .select("*")
    .eq("id", params.campaignId)
    .single<CampaignRow>()
  if (campErr || !campaign) {
    throw new Error(`campaign not found: ${params.campaignId}`)
  }
  if (campaign.status !== "sending") {
    return { sent: 0, failed: 0, remaining: 0 }
  }

  const template = getTemplate(campaign.template_key)

  const { data: recipients, error: recErr } = await db
    .from("campaign_recipients")
    .select("*")
    .eq("campaign_id", params.campaignId)
    .is("sent_at", null)
    .order("id", { ascending: true })
    .limit(limit)
    .returns<CampaignRecipientRow[]>()
  if (recErr) throw new Error(`recipient fetch failed: ${recErr.message}`)

  if (!recipients || recipients.length === 0) {
    await db.from("campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
    return { sent: 0, failed: 0, remaining: 0 }
  }

  const pacer = createPacer(DEFAULT_GAP_MS)
  let sent = 0
  let failed = 0

  for (const r of recipients) {
    await pacer.wait()
    const member: MemberSegmentRow = {
      id: r.member_id,
      amasi_number: r.amasi_number ?? 0,
      name: r.name,
      email: r.email,
      pg_degree: null, profile_photo: null, date_of_birth: null,
      membership_type: null, marketing_opt_out_at: null,
    }
    try {
      await resend.emails.send({
        from: fromEmail,
        to: r.email,
        subject: template.subject(member),
        html: template.html(member, { baseUrl }),
      })
      await db.from("campaign_recipients")
        .update({ sent_at: new Date().toISOString(), send_error: null })
        .eq("id", r.id)
      sent++
    } catch (e: any) {
      await db.from("campaign_recipients")
        .update({ send_error: e?.message ?? "send failed" })
        .eq("id", r.id)
      failed++
    }
  }

  // Remaining count — cheap count query.
  const { count: remaining } = await db
    .from("campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .is("sent_at", null)

  // Audit trail (non-authoritative; source of truth is campaigns tables).
  await logMembershipAuditEvent({
    action: "campaign_batch_sent",
    entityType: "campaign",
    entityId: campaign.id,
    newData: { sent, failed, remaining: remaining ?? 0, template_key: campaign.template_key },
    performedBy: "sender",
  }, db)

  if ((remaining ?? 0) === 0) {
    await db.from("campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
  }

  return { sent, failed, remaining: remaining ?? 0 }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/campaigns/sender.ts
git commit -m "feat(campaigns): batch sender with correct pacing, resume-safe"
```

---

## Task 7: Attribution helper (TDD)

**Files:**
- Create: `src/lib/campaigns/attribution.ts`
- Create: `src/lib/campaigns/__tests__/attribution.test.ts`

The function `creditUpdateIfRelevant` is called from the members-update handler. It looks up the most recent recipient row for this member where `sent_at < at`, `update_detected_at IS NULL`, and the campaign's `target_fields` overlap the changed fields. It updates that row's `update_detected_at`. Returns the updated recipient id or null.

- [ ] **Step 1: Write the failing test**

Only the pure decision (`pickRecipientToCredit`) is unit-tested here. The I/O wrapper (`creditUpdateIfRelevant`) is covered by the manual verification in Task 13 and the Playwright smoke in Task 12 — proportionate, since mocking Supabase's chainable builder adds more scaffold than it's worth.

```ts
// src/lib/campaigns/__tests__/attribution.test.ts
import { describe, it, expect } from "vitest"
import { pickRecipientToCredit } from "../attribution"

describe("pickRecipientToCredit", () => {
  it("picks the most recent recipient whose sent_at < at and target_fields overlap", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "r-old", sent_at: "2026-04-20T10:00:00Z", target_fields: ["pg_degree"] },
        { id: "r-mid", sent_at: "2026-04-22T10:00:00Z", target_fields: ["pg_degree", "profile_photo"] },
        { id: "r-new-future", sent_at: "2026-04-25T10:00:00Z", target_fields: ["pg_degree"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick?.id).toBe("r-mid")
  })

  it("returns null when no recipient's target_fields overlap", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "r1", sent_at: "2026-04-20T10:00:00Z", target_fields: ["profile_photo"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick).toBeNull()
  })

  it("strictly-after: sent_at equal to at is excluded", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "r1", sent_at: "2026-04-23T09:00:00Z", target_fields: ["pg_degree"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick).toBeNull()
  })

  it("tiebreak: identical sent_at picks the recipient with the lower id (ascending)", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "b-zzz", sent_at: "2026-04-22T10:00:00Z", target_fields: ["pg_degree"] },
        { id: "a-aaa", sent_at: "2026-04-22T10:00:00Z", target_fields: ["pg_degree"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick?.id).toBe("a-aaa")
  })
})
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run src/lib/campaigns/__tests__/attribution.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/campaigns/attribution.ts`**

```ts
import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"

export interface CreditCandidate {
  id: string
  sent_at: string
  target_fields: string[]
}

/**
 * Pure decision: among candidate recipient rows for one member, pick the one to
 * credit with the observed update. Rules (see plan — "Attribution rule"):
 *   - sent_at must be strictly before `at`.
 *   - target_fields must overlap changedFields (first match per field wins).
 *   - Among survivors, pick the most recent sent_at.
 */
export function pickRecipientToCredit(params: {
  candidates: CreditCandidate[]
  changedFields: string[]
  at: string
}): CreditCandidate | null {
  const atMs = Date.parse(params.at)
  const eligible = params.candidates.filter((c) => {
    if (Date.parse(c.sent_at) >= atMs) return false
    return c.target_fields.some((f) => params.changedFields.includes(f))
  })
  if (eligible.length === 0) return null
  // Most recent sent_at wins; tiebreak on id ascending for determinism.
  eligible.sort((a, b) => {
    const diff = Date.parse(b.sent_at) - Date.parse(a.sent_at)
    if (diff !== 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return eligible[0]
}

/**
 * Side-effectful wrapper: fetches candidates for this member, runs the decision,
 * and writes update_detected_at. Called from the members-update handler.
 */
export async function creditUpdateIfRelevant(params: {
  memberId: string
  changedFields: string[]
  at: string
  supabase?: SupabaseClient
}): Promise<string | null> {
  const db = params.supabase ?? createAdminClient()

  // Pull recipient + campaign join in two queries (Supabase doesn't do real joins via PostgREST
  // without configured foreign keys; two small queries are fine at our scale).
  const { data: recips, error: recErr } = await db
    .from("campaign_recipients")
    .select("id, campaign_id, sent_at, update_detected_at")
    .eq("member_id", params.memberId)
    .is("update_detected_at", null)
    .not("sent_at", "is", null)
    .lt("sent_at", params.at)
    .order("sent_at", { ascending: false })
    .limit(20)
  if (recErr || !recips || recips.length === 0) return null

  const { data: camps, error: campErr } = await db
    .from("campaigns")
    .select("id, target_fields")
    .in("id", recips.map((r: any) => r.campaign_id))
  if (campErr || !camps) return null

  const byId = new Map(camps.map((c: any) => [c.id, c.target_fields as string[]]))
  const candidates: CreditCandidate[] = recips.map((r: any) => ({
    id: r.id,
    sent_at: r.sent_at,
    target_fields: byId.get(r.campaign_id) ?? [],
  }))

  const pick = pickRecipientToCredit({
    candidates,
    changedFields: params.changedFields,
    at: params.at,
  })
  if (!pick) return null

  await db.from("campaign_recipients")
    .update({ update_detected_at: params.at })
    .eq("id", pick.id)

  return pick.id
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run src/lib/campaigns/__tests__/attribution.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/attribution.ts src/lib/campaigns/__tests__/attribution.test.ts
git commit -m "feat(campaigns): attribution pure decision + supabase wrapper"
```

---

## Task 8: Wire attribution into members-update handler

**Files:**
- Modify: `src/app/api/members/[id]/update/route.ts:124-144`

- [ ] **Step 1: Read existing audit-log block**

Confirm lines 124-144 match the snippet shown below (adjust if they've drifted):

```ts
    // Write audit log
    const oldData: Record<string, any> = {}
    const newData: Record<string, any> = {}
    for (const entry of auditChanges) {
      oldData[entry.field] = entry.old
      newData[entry.field] = entry.new
    }
    ...
    await supabase.from("membership_audit_log").insert({ ... })
    ...
```

- [ ] **Step 2: Add attribution call after the audit insert**

Insert this block immediately after the `await supabase.from("membership_audit_log").insert(...)` chain and before `return Response.json(...)`:

```ts
    // Campaign attribution: credit the most recent relevant recipient row.
    // Only NULL → not-NULL transitions are counted (per the attribution rule).
    try {
      const nullToValue = auditChanges
        .filter((e) => (e.old === null || e.old === undefined || e.old === "") && e.new)
        .map((e) => e.field)
      if (nullToValue.length > 0) {
        const { creditUpdateIfRelevant } = await import("@/lib/campaigns/attribution")
        await creditUpdateIfRelevant({
          memberId: id,
          changedFields: nullToValue,
          at: new Date().toISOString(),
          supabase,
        })
      }
    } catch (err) {
      console.error("campaign attribution error:", err)
    }
```

Only NULL → not-NULL transitions are passed in (per the attribution rule). Errors are swallowed — attribution is best-effort, it must never fail a profile update.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/members/[id]/update/route.ts
git commit -m "feat(campaigns): credit attribution on member profile update"
```

---

## Task 9: Rewrite `/api/campaigns` GET + POST

**Files:**
- Modify: `src/app/api/campaigns/route.ts` (full rewrite)

- [ ] **Step 1: Replace file contents**

```ts
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { listTemplates } from "@/lib/campaigns/registry"
import { createCampaign } from "@/lib/campaigns/create"
import type { CampaignRow } from "@/lib/campaigns/types"

interface CampaignSummary extends CampaignRow {
  total: number
  sent: number
  failed: number
  pending: number
  credited: number
}

export async function GET() {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const db = createAdminClient()

  const { data: campaigns, error } = await db
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<CampaignRow[]>()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const summaries: CampaignSummary[] = []
  let totalEmailsSent = 0
  let membersCredited = 0

  // NOTE: N+1 — five count queries per campaign. Fine at LIMIT 20; replace with
  // a SQL view / RPC before we remove the limit. See out-of-scope section.
  for (const c of campaigns ?? []) {
    const [totalQ, sentQ, failedQ, pendingQ, creditedQ] = await Promise.all([
      db.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id),
      db.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("sent_at", "is", null),
      db.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("send_error", "is", null),
      db.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).is("sent_at", null),
      db.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("update_detected_at", "is", null),
    ])
    const total = totalQ.count ?? 0
    const sent = sentQ.count ?? 0
    const failed = failedQ.count ?? 0
    const pending = pendingQ.count ?? 0
    const credited = creditedQ.count ?? 0
    summaries.push({ ...c, total, sent, failed, pending, credited })
    totalEmailsSent += sent
    membersCredited += credited
  }

  return Response.json({
    campaigns: summaries,
    stats: {
      totalCampaigns: summaries.length,
      totalEmailsSent,
      membersUpdated: membersCredited,
    },
    templates: listTemplates().map((t) => ({
      key: t.key, name: t.name, category: t.category, targetFields: t.targetFields,
    })),
  })
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const templateKey = typeof body?.templateKey === "string" ? body.templateKey : null
  if (!templateKey) return Response.json({ error: "templateKey required" }, { status: 400 })

  try {
    const result = await createCampaign({
      templateKey,
      createdBy: (session as any).email || "admin",
    })
    return Response.json(result)
  } catch (e: any) {
    return Response.json({ error: e.message ?? "create failed" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/campaigns/route.ts
git commit -m "refactor(api/campaigns): read/write against campaigns + campaign_recipients"
```

---

## Task 10: New endpoint `/api/campaigns/[id]/send`

**Files:**
- Create: `src/app/api/campaigns/[id]/send/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { sendNextBatch } from "@/lib/campaigns/sender"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const limit = typeof body?.limit === "number" && body.limit > 0 && body.limit <= 500
    ? body.limit
    : 100

  try {
    const result = await sendNextBatch({ campaignId: id, limit })
    return Response.json(result)
  } catch (e: any) {
    return Response.json({ error: e.message ?? "send failed" }, { status: 500 })
  }
}
```

Next 16 passes `params` as a Promise — follow the existing App Router convention in this repo (see AGENTS.md).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/campaigns/[id]/send/route.ts
git commit -m "feat(api/campaigns): POST /api/campaigns/:id/send advances one batch"
```

---

## Task 11: Update the admin campaigns page

**Files:**
- Modify: `src/app/campaigns/page.tsx` (full rewrite recommended — see below)

The new page needs: template dropdown, "Create campaign" button (calls `POST /api/campaigns`), per-campaign "Send next batch" button (calls `POST /api/campaigns/:id/send`), columns for pending/sent/failed/credited, refresh after each mutation.

- [ ] **Step 1: Rewrite `src/app/campaigns/page.tsx`**

Replace the existing file entirely. Preserve the visual style (teal header, StatCard, CampaignCard) but swap the data shape and buttons:

```tsx
"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Send, Mail, UserCheck, Loader2, AlertCircle, CheckCircle2, XCircle,
  Calendar, RefreshCw, Play,
} from "lucide-react"

interface TemplateOption {
  key: string
  name: string
  category: "marketing" | "statutory"
  targetFields: string[]
}

interface CampaignSummary {
  id: string
  name: string
  template_key: string
  category: string
  status: string
  created_at: string
  completed_at: string | null
  total: number
  sent: number
  failed: number
  pending: number
  credited: number
}

interface CampaignsResponse {
  campaigns: CampaignSummary[]
  templates: TemplateOption[]
  stats: { totalCampaigns: number; totalEmailsSent: number; membersUpdated: number }
}

function formatDate(s: string) {
  const d = new Date(s)
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
}

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: typeof Mail; color: string
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card><CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
          </div>
          <div className={`h-12 w-12 rounded-xl ${color} flex items-center justify-center`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent></Card>
    </motion.div>
  )
}

export default function CampaignsPage() {
  const qc = useQueryClient()
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [sendingId, setSendingId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery<CampaignsResponse>({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const res = await fetch("/api/campaigns")
      if (!res.ok) throw new Error("Failed to load campaigns")
      return res.json()
    },
  })

  const createMut = useMutation({
    mutationFn: async (templateKey: string) => {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Create failed")
      return res.json()
    },
    onSuccess: (r) => {
      toast.success(`Campaign created: ${r.totalRecipients} recipients`)
      qc.invalidateQueries({ queryKey: ["campaigns"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sendMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Send failed")
      return res.json()
    },
    onMutate: (id: string) => { setSendingId(id) },
    onSettled: () => { setSendingId(null) },
    onSuccess: (r) => {
      toast.success(`Batch: ${r.sent} sent, ${r.failed} failed, ${r.remaining} remaining`)
      qc.invalidateQueries({ queryKey: ["campaigns"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const campaigns = data?.campaigns ?? []
  const templates = data?.templates ?? []
  const stats = data?.stats ?? { totalCampaigns: 0, totalEmailsSent: 0, membersUpdated: 0 }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Send className="h-6 w-6 text-teal-600" />
            Email Campaigns
          </h1>
          <p className="text-muted-foreground mt-1">Track sent campaigns and member responses</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border rounded-md px-3 py-2 text-sm bg-background"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
          >
            <option value="">Select template…</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>{t.name} ({t.category})</option>
            ))}
          </select>
          <Button
            onClick={() => selectedTemplate && createMut.mutate(selectedTemplate)}
            disabled={!selectedTemplate || createMut.isPending}
            className="bg-teal-600 hover:bg-teal-700 gap-2"
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Create campaign
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Campaigns" value={stats.totalCampaigns} icon={Send} color="bg-teal-600" />
        <StatCard label="Emails Sent" value={stats.totalEmailsSent} icon={Mail} color="bg-blue-600" />
        <StatCard label="Members Updated (credited)" value={stats.membersUpdated} icon={UserCheck} color="bg-emerald-600" />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>Failed to load campaigns.</p>
          </div>
        </CardContent></Card>
      )}

      {!isLoading && campaigns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Campaign History</h2>
            <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["campaigns"] })}
                    className="gap-1 text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
          {campaigns.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: i * 0.05 }}>
              <Card><CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Send className="h-4 w-4 text-teal-600 shrink-0" />
                      <h3 className="font-semibold text-base truncate">{c.name}</h3>
                      <Badge variant="outline" className="text-xs">{c.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDate(c.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{c.total} total</Badge>
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" />{c.sent} sent
                    </Badge>
                    {c.failed > 0 && (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                        <XCircle className="h-3 w-3 mr-1" />{c.failed} failed
                      </Badge>
                    )}
                    <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">{c.pending} pending</Badge>
                    <Badge variant="outline" className="bg-indigo-50 text-indigo-800 border-indigo-200">{c.credited} credited</Badge>
                    {c.status !== "completed" && c.pending > 0 && (
                      <Button size="sm" variant="outline" className="gap-1"
                              onClick={() => sendMut.mutate(c.id)}
                              disabled={sendingId === c.id}>
                        {sendingId === c.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Play className="h-3.5 w-3.5" />}
                        Send next batch
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent></Card>
            </motion.div>
          ))}
        </div>
      )}

      {!isLoading && !error && campaigns.length === 0 && (
        <Card><CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No campaigns yet</p>
            <p className="text-sm mt-1">Pick a template and create one above.</p>
          </div>
        </CardContent></Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint src/app/campaigns src/app/api/campaigns src/lib/campaigns
```

- [ ] **Step 3: Build locally (MANDATORY — page uses React Query hooks on a client-rendered page)**

Per `AGENTS.md`: any diff that moves client-router hooks requires a local `next build`. This page is already `"use client"`, but we're introducing a new dynamic server route — run the build to be sure.

```bash
npx next build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/campaigns/page.tsx
git commit -m "feat(campaigns): admin page with template picker, per-campaign batch send, attribution"
```

---

## Task 12: Playwright smoke test for admin flow

**Files:**
- Create: `tests/campaigns-admin.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test"

// Smoke: admin can load the campaigns page, see the template picker, and the
// stats cards render. Does not perform an actual send (would email real members).

test("admin campaigns page renders with template picker", async ({ page }) => {
  // Prereq: admin auth fixture. If this repo has one (see other specs),
  // use the same pattern; otherwise stub with cookies.
  await page.goto("/campaigns")

  await expect(page.getByRole("heading", { name: /email campaigns/i })).toBeVisible()
  await expect(page.getByText(/total campaigns/i)).toBeVisible()
  await expect(page.getByText(/emails sent/i)).toBeVisible()
  await expect(page.getByText(/members updated/i)).toBeVisible()

  const select = page.locator("select")
  await expect(select).toBeVisible()
  const options = await select.locator("option").allTextContents()
  expect(options.some((o) => /profile update/i.test(o))).toBe(true)
})
```

- [ ] **Step 2: Run spec against local dev**

Start `npm run dev` in one terminal; in another:

```bash
npx playwright test tests/campaigns-admin.spec.ts
```

Expected: PASS. If the repo's existing Playwright specs require an auth fixture, replicate it before running.

- [ ] **Step 3: Commit**

```bash
git add tests/campaigns-admin.spec.ts
git commit -m "test: playwright smoke for campaigns admin page"
```

---

## Task 13: End-to-end manual verification (before merge)

Do not skip. The new sender hits Resend in production.

- [ ] **Step 1: Create a campaign against a test-only template**

Temporarily add a `test_ping` template to the registry with `buildSegment` filtering to your own admin email only, category `statutory` to bypass opt-out. Commit to a separate branch.

Belt-and-suspenders: the template's `buildSegment` must start with a production guard so that even if the commit slips into a deploy, it can't fire:

```ts
buildSegment: (q) => {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_TEST_PING) {
    throw new Error("test_ping template refuses to run in production without ALLOW_TEST_PING")
  }
  return q.eq("email", "your-admin-email@amasi.org")
},
```

- [ ] **Step 2: Exercise the flow**

1. `POST /api/campaigns` with `templateKey: "test_ping"` — expect `totalRecipients = 1`.
2. `POST /api/campaigns/<id>/send` with `limit: 1` — expect `sent: 1, failed: 0, remaining: 0` and an email in your inbox.
3. `GET /api/campaigns` — expect the campaign shows `status: completed`, `sent: 1`.
4. Trigger a profile update on your admin member record that transitions a field the test template targets from `NULL` → value. Expect the recipient row's `update_detected_at` populated and `credited: 1` in the GET response.

- [ ] **Step 2: Delete the test template commit** before merging to main.

- [ ] **Step 3: Final commit / PR**

```bash
git push
# open PR, reference this plan
```

---

## Out of scope (follow-up tickets)

- Unsubscribe page + token link in marketing email bodies.
- Scheduling / cron-driven auto-advance (defer until volume justifies).
- Audit-log index on `(action, created_at)` (separate tech-debt ticket; unrelated to campaigns once we're off the table).
- Helper consolidation for the direct `membership_audit_log` insert at `src/app/api/members/[id]/update/route.ts:134` — should use `logMembershipAuditEvent`. Separate hygiene PR.
- Preview / test-send buttons per template.
- Additional templates (missing photo, missing DOB, membership-type-specific).
- **N+1 count queries in GET `/api/campaigns`.** The list is capped at `LIMIT 20` so current load is bounded, but before we raise the limit (pagination, filters) these should collapse into a single SQL view or RPC that returns `total / sent / failed / pending / credited` per campaign in one round trip.
- **Sender only sees recipient-row fields when rendering.** Current template rendering receives a `MemberSegmentRow` constructed from the recipient row (`name`, `email`, `amasi_number`); all other fields are nulled. Fine for the first template. Before adding a template that references `membership_type`, `pg_degree`, etc. in subject/body, either (a) snapshot the full member columns into `campaign_recipients` at materialisation, or (b) have the sender batch-fetch members by id inside `sendNextBatch`.

---

## Self-review checklist (done before handoff)

- [x] Attribution rule stated in prose (Key Decisions) and encoded as pure function with tests.
- [x] Registry shape with concrete example (Task 2 types + Task 4 template).
- [x] Opt-out category decision baked into schema, registry, and sender.
- [x] Migration + rollback as explicit tasks.
- [x] Rate-limit fix in the same PR (Task 3 + Task 6).
- [x] No placeholders / TBDs.
- [x] Type consistency: `MemberSegmentRow`, `CampaignRow`, `CampaignRecipientRow`, `TemplateEntry` used the same way across tasks.
- [x] Every code step shows the actual code.
