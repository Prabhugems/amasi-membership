# AI Decisions Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permanent observability for the AI approval system by creating an `ai_decisions` logging table and instrumenting the scoring pipeline to write a row for every scoring event, then tracking final outcomes when admin/AI acts on the application.

**Architecture:** New `ai_decisions` table stores one row per scoring event (multiple rows if rescored). `scoreApplication()` gets a thin wrapper `scoreAndLog()` that times the scoring, writes the row, and returns the same result. Each outcome route (approve, reject, clarification, auto-approval) updates the latest `ai_decisions` row with final status. A helper module `src/lib/ai-decision-log.ts` encapsulates all DB writes so routes stay clean.

**Tech Stack:** Supabase Postgres (JSONB), existing `createAdminClient()` pattern, no new dependencies.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `sql/019_ai_decisions.sql` | Create | Migration: table, indexes, RLS, comments |
| `src/lib/ai-decision-log.ts` | Create | Helper: `logAiDecision()` and `updateAiDecisionOutcome()` |
| `src/lib/ai-approval.ts` | Modify | Wrap scoring with timing + logging call |
| `src/app/api/applications/submit/route.ts` | Modify | Pass supabase + metadata to scoring |
| `src/app/api/applications/resubmit/route.ts` | Modify | Pass supabase + metadata to scoring |
| `src/lib/auto-approval.ts` | Modify | Update ai_decisions with final_status after auto-approve |
| `src/app/api/applications/approve/route.ts` | Modify | Update ai_decisions with final_status |
| `src/app/api/applications/reject/route.ts` | Modify | Update ai_decisions with final_status |
| `src/app/api/applications/clarification/route.ts` | Modify | Update ai_decisions with final_status |

---

### Task 1: Create Migration

**Files:**
- Create: `sql/019_ai_decisions.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 019_ai_decisions.sql
-- AI Decisions Observability Table
-- Records every AI scoring event for membership applications.
-- One row per scoring run — rescoring after clarification/resubmission
-- creates a NEW row (preserving history), not an update.
-- Outcome columns are populated later when admin/AI acts on the application.

CREATE TABLE IF NOT EXISTS ai_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES membership_applications(id) ON DELETE CASCADE,
  application_reference TEXT NOT NULL,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  membership_type TEXT NOT NULL,

  -- Scoring data
  total_score NUMERIC NOT NULL,
  threshold NUMERIC NOT NULL DEFAULT 80,
  decision TEXT NOT NULL CHECK (decision IN ('auto_approved', 'manual_review', 'auto_approve_failed')),
  blocking_reason TEXT,

  -- Per-check breakdown
  check_results JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- External system status
  nmc_api_status TEXT,
  nmc_api_response_time_ms INTEGER,

  -- Input snapshot
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Outcome tracking (populated later)
  final_status TEXT,
  final_status_by TEXT,
  final_status_at TIMESTAMPTZ,
  override_reason TEXT,

  -- Performance
  scoring_duration_ms INTEGER,
  error JSONB
);

COMMENT ON TABLE ai_decisions IS 'Observability log for AI approval scoring. One row per scoring event. Outcome columns updated when admin/AI acts on the application.';

-- Indexes
CREATE INDEX idx_ai_decisions_application_id ON ai_decisions(application_id);
CREATE INDEX idx_ai_decisions_scored_at ON ai_decisions(scored_at DESC);
CREATE INDEX idx_ai_decisions_decision ON ai_decisions(decision);
CREATE INDEX idx_ai_decisions_membership_type ON ai_decisions(membership_type);

-- RLS: only service_role and authenticated admins can read
ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON ai_decisions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Admin read access" ON ai_decisions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.email = auth.jwt() ->> 'email'
        AND admin_users.is_active = true
    )
  );

-- Down migration (in comment for reference):
-- DROP TABLE IF EXISTS ai_decisions CASCADE;
```

- [ ] **Step 2: Apply the migration**

Run via Supabase MCP `execute_sql` or:
```bash
# Copy the SQL and run against your Supabase project
```

- [ ] **Step 3: Verify table exists**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'ai_decisions' ORDER BY ordinal_position;
```

- [ ] **Step 4: Commit**

```bash
git add sql/019_ai_decisions.sql
git commit -m "feat: add ai_decisions observability table (migration 019)"
```

---

### Task 2: Create AI Decision Log Helper

**Files:**
- Create: `src/lib/ai-decision-log.ts`

- [ ] **Step 1: Write the helper module**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ApprovalResult } from "./ai-approval"

export interface AiDecisionInput {
  applicationId: string
  applicationReference: string
  membershipType: string
  formData: Record<string, any>
  uploads: Record<string, any>
  paymentPaid: boolean
}

/**
 * Write a scoring event row to ai_decisions.
 * Called after scoreApplication() completes (success or error).
 * Errors are logged but never thrown — observability must not break scoring.
 */
export async function logAiDecision(
  supabase: SupabaseClient,
  input: AiDecisionInput,
  result: ApprovalResult | null,
  durationMs: number,
  scoringError: unknown | null,
): Promise<string | null> {
  try {
    // Build check_results JSONB from the checks array
    const checkResults: Record<string, any> = {}
    if (result) {
      for (const c of result.checks) {
        // Normalize check name to snake_case key
        const key = c.check
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
        checkResults[key] = {
          score: c.score,
          weight: c.weight,
          passed: c.passed,
          details: c.detail,
          flags: result.flags.filter(f =>
            f.toLowerCase().includes(c.check.toLowerCase().split(" ")[0])
          ),
        }
      }
      // Add skipped_reason for NMC if applicable
      if (checkResults.nmc_live_verification && result.nmcVerification) {
        checkResults.nmc_live_verification.skipped_reason =
          result.nmcVerification.status === "skipped" ? "api_unreachable" : null
      }
    }

    // Determine decision
    let decision: string
    if (scoringError) {
      decision = "manual_review"
    } else if (result?.autoApprove) {
      decision = "auto_approved"
    } else {
      decision = "manual_review"
    }

    // Determine blocking reason when score >= threshold but not auto-approved
    let blockingReason: string | null = null
    if (result && result.totalScore >= 80 && !result.autoApprove) {
      if (result.nmcVerification?.status === "name_mismatch") {
        blockingReason = "nmc_name_mismatch"
      } else if (!input.paymentPaid) {
        blockingReason = "payment_pending"
      } else {
        // Find which critical check failed
        const failedCritical = result.checks.find(c => c.weight >= 20 && !c.passed)
        blockingReason = failedCritical
          ? `critical_check_failed: ${failedCritical.check}`
          : "unknown"
      }
    }

    // NMC API status
    let nmcApiStatus: string | null = null
    if (input.membershipType === "ILM") {
      nmcApiStatus = "skipped_ilm"
    } else if (result?.nmcVerification) {
      const s = result.nmcVerification.status
      nmcApiStatus = s === "skipped" ? "unreachable" : s === "verified" ? "success" : s
    }

    // Input snapshot (redacted — no full form dump, just scoring-relevant fields)
    const inputSnapshot = {
      form_data: {
        name: [input.formData.firstName, input.formData.middleName, input.formData.lastName].filter(Boolean).join(" "),
        membership_type: input.formData.membershipType,
        mci_number: input.formData.mciCouncilNumber || null,
        mci_state: input.formData.mciCouncilState || null,
        pg_degree: input.formData.eduPostgradDegree || null,
        pg_college: input.formData.eduPostgradCollege || null,
        pg_university: input.formData.eduPostgradUniversity || null,
      },
      extracted_data: Object.fromEntries(
        Object.entries(input.uploads).map(([k, v]: [string, any]) => [
          k,
          { status: v.status, has_extracted: !!v.extracted && Object.keys(v.extracted).length > 0 },
        ])
      ),
      documents: Object.entries(input.uploads).map(([k, v]: [string, any]) => ({
        type: k,
        status: v.status,
      })),
      payment_status: input.paymentPaid ? "paid" : "unpaid",
    }

    const { data, error } = await supabase
      .from("ai_decisions")
      .insert({
        application_id: input.applicationId,
        application_reference: input.applicationReference,
        membership_type: input.membershipType,
        total_score: result?.totalScore ?? 0,
        threshold: 80,
        decision,
        blocking_reason: blockingReason,
        check_results: checkResults,
        nmc_api_status: nmcApiStatus,
        nmc_api_response_time_ms: null, // TODO: instrument NMC call timing separately
        input_snapshot: inputSnapshot,
        scoring_duration_ms: durationMs,
        error: scoringError
          ? { message: String(scoringError), stack: (scoringError as Error)?.stack?.slice(0, 500) }
          : null,
      })
      .select("id")
      .single()

    if (error) {
      console.error("[ai-decision-log] insert failed:", error.message)
      return null
    }

    return data?.id ?? null
  } catch (err) {
    console.error("[ai-decision-log] unexpected error:", err)
    return null
  }
}

/**
 * Update the latest ai_decisions row for an application with the final outcome.
 * Called from approve/reject/clarification routes and auto-approval.
 */
export async function updateAiDecisionOutcome(
  supabase: SupabaseClient,
  applicationId: string,
  outcome: {
    finalStatus: string
    finalStatusBy: string
    overrideReason?: string | null
  },
): Promise<void> {
  try {
    // Find the most recent ai_decisions row for this application
    const { data: latest, error: fetchError } = await supabase
      .from("ai_decisions")
      .select("id, decision")
      .eq("application_id", applicationId)
      .order("scored_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError || !latest) {
      console.error("[ai-decision-log] no ai_decisions row found for", applicationId)
      return
    }

    // Determine if this is an override (admin decision differs from AI recommendation)
    let overrideReason = outcome.overrideReason ?? null
    if (!overrideReason) {
      const aiRecommended = latest.decision === "auto_approved" ? "approved" : "manual_review"
      const adminDid = outcome.finalStatus
      // Admin approved something AI said needs review → override
      if (aiRecommended === "manual_review" && adminDid === "approved") {
        overrideReason = "admin_approved_despite_manual_review"
      }
      // Admin rejected something AI auto-approved → override
      if (aiRecommended === "approved" && adminDid === "rejected") {
        overrideReason = "admin_rejected_despite_auto_approve"
      }
    }

    const { error: updateError } = await supabase
      .from("ai_decisions")
      .update({
        final_status: outcome.finalStatus,
        final_status_by: outcome.finalStatusBy,
        final_status_at: new Date().toISOString(),
        override_reason: overrideReason,
      })
      .eq("id", latest.id)

    if (updateError) {
      console.error("[ai-decision-log] outcome update failed:", updateError.message)
    }
  } catch (err) {
    console.error("[ai-decision-log] outcome update error:", err)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai-decision-log.ts
git commit -m "feat: add ai-decision-log helper for observability writes"
```

---

### Task 3: Instrument scoreApplication()

**Files:**
- Modify: `src/lib/ai-approval.ts:167-453` — add a new exported wrapper `scoreAndLogApplication()`

The key constraint: **do NOT modify the scoring logic itself**. Add a wrapper that times it, calls `logAiDecision`, and returns the same result.

- [ ] **Step 1: Add the wrapper function at the end of `src/lib/ai-approval.ts`**

After the existing `scoreApplication` function (after line 453), add:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import { logAiDecision, type AiDecisionInput } from "./ai-decision-log"

/**
 * Wrapper around scoreApplication that logs the result to ai_decisions.
 * Returns the same ApprovalResult — callers see no difference.
 * If scoring throws, the error is logged to ai_decisions and re-thrown.
 */
export async function scoreAndLogApplication(
  supabase: SupabaseClient,
  meta: { applicationId: string; applicationReference: string; membershipType: string },
  formData: Record<string, any>,
  uploads: Record<string, { status: string; extracted: Record<string, any>; message?: string }>,
  paymentPaid: boolean,
): Promise<ApprovalResult> {
  const start = performance.now()
  let result: ApprovalResult | null = null
  let scoringError: unknown | null = null

  try {
    result = await scoreApplication(formData, uploads, paymentPaid)
    return result
  } catch (err) {
    scoringError = err
    throw err
  } finally {
    const durationMs = Math.round(performance.now() - start)
    const input: AiDecisionInput = {
      applicationId: meta.applicationId,
      applicationReference: meta.applicationReference,
      membershipType: meta.membershipType,
      formData,
      uploads,
      paymentPaid,
    }
    // Fire-and-forget but awaited — log errors but don't fail scoring
    await logAiDecision(supabase, input, result, durationMs, scoringError).catch((err) =>
      console.error("[ai-approval] decision log write failed:", err)
    )
  }
}
```

Note: The `import` for `SupabaseClient` should go at the top of the file. The `import` for `logAiDecision` and `AiDecisionInput` should also go at the top.

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai-approval.ts
git commit -m "feat: add scoreAndLogApplication wrapper for observability"
```

---

### Task 4: Update Submit Route to Use scoreAndLogApplication

**Files:**
- Modify: `src/app/api/applications/submit/route.ts`

The submit route currently calls `scoreApplication()` at line 149 BEFORE the application is inserted (so no `applicationId` yet). We need to restructure slightly:

1. Insert the application first (to get `applicationId`)
2. Then call `scoreAndLogApplication()` with the `applicationId`
3. Then update the application with AI results

BUT — looking at the current code, the AI results are included IN the insert (lines 156-219). So we have two options:
- (A) Insert first without AI fields, score, then update — requires 2 DB calls
- (B) Keep insert as-is with `scoreApplication()`, then log separately after insert

**Option B is safer** — minimal changes, no risk of breaking the insert. The `logAiDecision` call happens right after the insert when we have the `applicationId`.

- [ ] **Step 1: Add import at top of submit/route.ts**

Replace the existing import line:
```typescript
import { scoreApplication } from "@/lib/ai-approval"
```
with:
```typescript
import { scoreApplication } from "@/lib/ai-approval"
import { logAiDecision, type AiDecisionInput } from "@/lib/ai-decision-log"
```

- [ ] **Step 2: Add logging after the application insert succeeds**

After line 228 (after `const applicationId: string | undefined = app?.id`), add:

```typescript
    // --- Log AI decision for observability ---
    if (applicationId) {
      const decisionStart = performance.now()
      const decisionInput: AiDecisionInput = {
        applicationId,
        applicationReference: referenceNumber,
        membershipType: formData.membershipType,
        formData,
        uploads: uploads || {},
        paymentPaid: !!paymentId,
      }
      await logAiDecision(
        supabase,
        decisionInput,
        approval,
        Math.round(performance.now() - decisionStart), // approximate — real timing captured below
        null,
      ).catch(err => console.error("[submit] ai decision log failed:", err))
    }
```

BUT we also need to capture the actual scoring duration. Add a timer around the existing `scoreApplication` call.

At line 148 (before `const approval = await scoreApplication(...)`), add:
```typescript
    const scoringStart = performance.now()
```

At line 149 (after the call), add:
```typescript
    const scoringDurationMs = Math.round(performance.now() - scoringStart)
```

Then in the logging block, replace the duration calculation:
```typescript
      await logAiDecision(
        supabase,
        decisionInput,
        approval,
        scoringDurationMs,
        null,
      ).catch(err => console.error("[submit] ai decision log failed:", err))
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/applications/submit/route.ts
git commit -m "feat: instrument submit route with ai_decisions logging"
```

---

### Task 5: Update Resubmit Route to Log a New AI Decision Row

**Files:**
- Modify: `src/app/api/applications/resubmit/route.ts:172-186`

The resubmit route calls `scoreApplication()` at line 175. This should write a NEW row (not update), preserving scoring history.

- [ ] **Step 1: Add import at top of resubmit/route.ts**

```typescript
import { logAiDecision, type AiDecisionInput } from "@/lib/ai-decision-log"
```

- [ ] **Step 2: Wrap the scoring call with timing and logging**

Replace lines 172-186:
```typescript
    // Re-run AI scoring on resubmitted application
    try {
      const { scoreApplication } = await import("@/lib/ai-approval")
      const updatedApp = { ...app, ...updateFields }
      const approval = await scoreApplication(updatedApp, updatedApp.documents || {}, true)
      const aiConfidence = `${approval.totalScore}% — ${approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"}`
      await supabase.from("membership_applications").update({
        ai_confidence: aiConfidence,
        ai_verified: approval.autoApprove,
        needs_manual_review: !approval.autoApprove,
        ai_flags: [...approval.flags, ...approval.checks.map(c => `${c.check}: ${c.score}% ${c.passed ? "✓" : "✗"} — ${c.detail}`)],
      }).eq("id", applicationId)
    } catch (aiErr) {
      console.error("AI re-scoring error:", aiErr)
    }
```

with:

```typescript
    // Re-run AI scoring on resubmitted application — writes a NEW ai_decisions row
    try {
      const { scoreApplication } = await import("@/lib/ai-approval")
      const updatedApp = { ...app, ...updateFields }
      const scoringStart = performance.now()
      const approval = await scoreApplication(updatedApp, updatedApp.documents || {}, true)
      const scoringDurationMs = Math.round(performance.now() - scoringStart)
      const aiConfidence = `${approval.totalScore}% — ${approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"}`
      await supabase.from("membership_applications").update({
        ai_confidence: aiConfidence,
        ai_verified: approval.autoApprove,
        needs_manual_review: !approval.autoApprove,
        ai_flags: [...approval.flags, ...approval.checks.map(c => `${c.check}: ${c.score}% ${c.passed ? "✓" : "✗"} — ${c.detail}`)],
      }).eq("id", applicationId)

      // Log new AI decision row (preserves history — does not update old row)
      await logAiDecision(
        supabase,
        {
          applicationId,
          applicationReference: app.reference_number,
          membershipType: app.membership_type,
          formData: updatedApp,
          uploads: updatedApp.documents || {},
          paymentPaid: true,
        },
        approval,
        scoringDurationMs,
        null,
      ).catch(err => console.error("[resubmit] ai decision log failed:", err))
    } catch (aiErr) {
      console.error("AI re-scoring error:", aiErr)
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/applications/resubmit/route.ts
git commit -m "feat: instrument resubmit route with ai_decisions logging (new row per rescore)"
```

---

### Task 6: Update Auto-Approval with Outcome Tracking

**Files:**
- Modify: `src/lib/auto-approval.ts`

When auto-approval succeeds, update the ai_decisions row with `final_status = 'approved'`, `final_status_by = 'ai'`.

- [ ] **Step 1: Add import at top of auto-approval.ts**

```typescript
import { updateAiDecisionOutcome } from "@/lib/ai-decision-log"
```

- [ ] **Step 2: Add outcome update after successful auto-approval**

After line 197 (after the application update block, before the notifications section comment on line 199), add:

```typescript
    // Update AI decision log with outcome
    await updateAiDecisionOutcome(supabase, input.applicationId, {
      finalStatus: "approved",
      finalStatusBy: "ai",
    }).catch(err => console.error("[auto-approval] decision outcome update failed:", err))
```

- [ ] **Step 3: Also handle the failure case**

When auto-approval fails at `member_insert` stage (the application gets downgraded to `pending_review`), we should update the decision too. After the `member_insert` failure return block — but before the return — the submit route handles this (line 322-336 of submit/route.ts). We should add the outcome update there instead. BUT since submit route calls `autoApproveApplication()` and handles the failure, the outcome update for `auto_approve_failed` belongs in the submit route.

In `src/app/api/applications/submit/route.ts`, after line 329 (the `pending_review` update for failed auto-approval), add:

```typescript
        // Log that auto-approval was attempted but failed
        await updateAiDecisionOutcome(supabase, applicationId, {
          finalStatus: "auto_approve_failed",
          finalStatusBy: "ai",
          overrideReason: `member creation failed: ${result.reason}`,
        }).catch(err => console.error("[submit] decision outcome update failed:", err))
```

And add the import for `updateAiDecisionOutcome` to the submit route imports (same line as logAiDecision import):
```typescript
import { logAiDecision, updateAiDecisionOutcome, type AiDecisionInput } from "@/lib/ai-decision-log"
```

For the success path in submit route, after line 339 (the successful auto-approve return), add BEFORE the return:
```typescript
      // Update AI decision with auto-approve outcome
      await updateAiDecisionOutcome(supabase, applicationId, {
        finalStatus: "approved",
        finalStatusBy: "ai",
      }).catch(err => console.error("[submit] decision outcome update failed:", err))
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/auto-approval.ts src/app/api/applications/submit/route.ts
git commit -m "feat: track auto-approval outcomes in ai_decisions"
```

---

### Task 7: Update Manual Approve Route with Outcome Tracking

**Files:**
- Modify: `src/app/api/applications/approve/route.ts`

- [ ] **Step 1: Add import**

After the existing imports at top of file, add:
```typescript
import { updateAiDecisionOutcome } from "@/lib/ai-decision-log"
```

- [ ] **Step 2: Add outcome update after successful approval**

After line 198 (after the audit log block, before the final return), add:

```typescript
    // Update AI decision log with manual approval outcome
    await updateAiDecisionOutcome(supabase, applicationId, {
      finalStatus: "approved",
      finalStatusBy: (session?.email as string) || "admin",
    }).catch(err => console.error("[approve] decision outcome update failed:", err))
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/applications/approve/route.ts
git commit -m "feat: track manual approval outcomes in ai_decisions"
```

---

### Task 8: Update Reject Route with Outcome Tracking

**Files:**
- Modify: `src/app/api/applications/reject/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { updateAiDecisionOutcome } from "@/lib/ai-decision-log"
```

- [ ] **Step 2: Add outcome update after successful rejection**

After line 93 (after the audit log block, before the final return), add:

```typescript
    // Update AI decision log with rejection outcome
    await updateAiDecisionOutcome(supabase, applicationId, {
      finalStatus: "rejected",
      finalStatusBy: (session?.email as string) || "admin",
    }).catch(err => console.error("[reject] decision outcome update failed:", err))
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/applications/reject/route.ts
git commit -m "feat: track rejection outcomes in ai_decisions"
```

---

### Task 9: Update Clarification Route with Outcome Tracking

**Files:**
- Modify: `src/app/api/applications/clarification/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { updateAiDecisionOutcome } from "@/lib/ai-decision-log"
```

- [ ] **Step 2: Add outcome update after clarification/resubmit request**

After line 145 (after the audit log block, before `const actionLabel`), add:

```typescript
    // Update AI decision log with clarification outcome
    const clarificationStatus = action === "need_clarification" ? "clarification_requested" : "resubmit_requested"
    await updateAiDecisionOutcome(supabase, applicationId, {
      finalStatus: clarificationStatus,
      finalStatusBy: (session?.email as string) || "admin",
    }).catch(err => console.error("[clarification] decision outcome update failed:", err))
```

Note: Do NOT add this for `internal_note` action — internal notes don't change the decision status.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/applications/clarification/route.ts
git commit -m "feat: track clarification outcomes in ai_decisions"
```

---

### Task 10: Verify with Existing Application

- [ ] **Step 1: Run the migration against Supabase**

Apply `sql/019_ai_decisions.sql` via Supabase SQL editor or MCP tool.

- [ ] **Step 2: Build check — ensure no TypeScript errors**

```bash
npx next build 2>&1 | head -50
```

Expected: Build succeeds with no type errors in modified files.

- [ ] **Step 3: Verify by querying ai_decisions table**

After a new application submission or by manually triggering the submit endpoint, verify:

```sql
SELECT id, application_reference, total_score, decision, blocking_reason,
       check_results, nmc_api_status, scoring_duration_ms,
       final_status, final_status_by
FROM ai_decisions
ORDER BY scored_at DESC
LIMIT 5;
```

Expected: Row exists with populated scoring data. `final_status` is null until admin acts.

- [ ] **Step 4: Final commit with all changes**

```bash
git add -A
git status
git commit -m "feat: complete ai_decisions observability — scoring + outcome tracking"
```
