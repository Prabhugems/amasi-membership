/**
 * Persist a single upload entry into a draft application's
 * `step_data.uploads.<docKey>` server-side, from inside /api/ocr.
 *
 * Stage C of the upload-cure (2026-05-23 — design; build after Stage B bakes).
 * Stage A (commit 2579b78) plugged the client resume rehydrator. Stage B
 * (commit 413fe60) made the server-side merge per-key + null-fileUrl-safe.
 * Stage C (this module) removes the dependency on the client save-draft
 * round-trip for the uploads JSONB: when OCR succeeds, the entry is
 * written directly to the draft. The client's existing fire-and-forget
 * save-draft remains (additive — Stage B's rule 1 makes the duplicate
 * write a no-op).
 *
 * DESIGN DECISIONS BAKED IN
 *
 *   1. docKey is the RAW client-sent key, NOT the normalized canonical.
 *      The OCR route at ocr/route.ts:107 normalizes `rawDocType` for
 *      storage-path + OCR-routing purposes, but the apply page hard-codes
 *      "profile" everywhere in React state. Writing under the normalized
 *      "photo" would create a duplicate entry in step_data.uploads and
 *      corrupt the row.
 *
 *      ALLOWED_DOC_KEYS is the allowlist — any unrecognized key results
 *      in a silent no-op (return persisted:false, reason:"invalid_doc_key").
 *      This prevents garbage docTypes that the OCR route accepts via
 *      normalizeDocumentKey's permissive default from landing in JSONB.
 *
 *   2. Merge logic is the existing Stage B mergeDraftUploads helper.
 *      No new merge code lives here. The OCR-write incoming entry always
 *      has a truthy fileUrl (we don't call this helper unless storage
 *      succeeded), so rule 1 always installs the entry. Other keys in
 *      step_data.uploads are preserved by rule 3 (missing key = keep
 *      existing). This makes OCR-vs-client-save-draft writes additive.
 *
 *   3. Optimistic-lock on updated_at, mirroring save-draft/route.ts.
 *      Reads draft → captures `updated_at` as lockValue → updates with
 *      `.eq("updated_at", lockValue)` → if no row returned, retries ONCE
 *      with a fresh read. After two failed attempts, surfaces to Sentry
 *      (warning) and returns conflict_after_retry. The OCR route ignores
 *      the result on the response path — its contract to the client is
 *      unchanged in every case.
 *
 *   4. No-throw guarantee. Every error path returns a typed result. The
 *      caller (OCR route) MUST be able to ignore the return value
 *      without try/catch and still produce a normal OCR response.
 *
 *   5. No-draft is opportunistic. If the lookup returns no row (the
 *      client never created a draft, or the draft was deleted between
 *      OCR upload and now), we return persisted:false, reason:"no_draft"
 *      and do nothing else. The client's eventual save-draft will create
 *      the row + include this upload entry from React state.
 *
 *   6. Behavior on success / failure is symmetric for observability:
 *      both conflict_after_retry and db_error fire Sentry, both return
 *      ok:false, and the OCR response is unchanged either way.
 */

import * as Sentry from "@sentry/nextjs"
import { mergeDraftUploads, type MergeUploadEntry } from "./merge-draft-uploads"
import type { createAdminClient } from "./supabase"

/**
 * Keys the apply page actually uses in step_data.uploads. Writing under
 * any other key would either create a duplicate (profile vs photo) or
 * pollute the JSONB with arbitrary attacker- / client-bug-supplied keys.
 *
 * Kept in lockstep with the canonical set in document-keys.ts plus the
 * "profile" alias which is what the client hard-codes for the photo slot.
 * If the apply page introduces a new doc type, add it here AND to
 * document-keys.ts.
 */
const ALLOWED_DOC_KEYS: ReadonlySet<string> = new Set([
  "profile",                    // alias of "photo"; what apply/page.tsx uses everywhere
  "photo",                      // canonical; accepted defensively
  "mci_certificate",
  "pg_degree_certificate",
  "mbbs_degree_certificate",
  "asi_member_certificate",
  "letter_hod",
  "active_license",
])

export type PersistOcrUploadInput = {
  supabase: ReturnType<typeof createAdminClient>
  email: string
  docKey: string
  entry: MergeUploadEntry
}

export type PersistOcrUploadResult =
  | { ok: true;  persisted: true  }
  | { ok: true;  persisted: false; reason: "no_draft" }
  | { ok: true;  persisted: false; reason: "invalid_doc_key" }
  | { ok: false; persisted: false; reason: "conflict_after_retry" }
  | { ok: false; persisted: false; reason: "db_error"; error: unknown }

/** Number of additional attempts after the first. 1 = first try + one retry. */
const MAX_RETRIES = 1

export async function persistOcrUploadToDraft(
  input: PersistOcrUploadInput,
): Promise<PersistOcrUploadResult> {
  const { supabase, email, docKey, entry } = input

  // ── Decision 1 (docKey allowlist) ──
  // Refuse to write under unrecognized keys. Silent no-op — not paged.
  if (!ALLOWED_DOC_KEYS.has(docKey)) {
    return { ok: true, persisted: false, reason: "invalid_doc_key" }
  }

  const normalizedEmail = email.toLowerCase().trim()

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // ── 1. Read current draft + capture optimistic-lock value ──
    const { data: draft, error: readError } = await supabase
      .from("draft_applications")
      .select("id, step_data, updated_at")
      .eq("email", normalizedEmail)
      .limit(1)
      .maybeSingle()

    if (readError) {
      Sentry.captureException(readError, {
        level: "warning",
        fingerprint: ["ocr-draft-persist-db-error"],
        tags: { component: "persist-ocr-upload", op: "read", doc_key: docKey },
        extra: { email: normalizedEmail, attempt },
      })
      return { ok: false, persisted: false, reason: "db_error", error: readError }
    }

    if (!draft) {
      // Opportunistic write: no draft exists for this email yet. The
      // client's eventual save-draft will create the row + include this
      // upload entry from React state. We do nothing here.
      return { ok: true, persisted: false, reason: "no_draft" }
    }

    // ── 2. Compute merged step_data via Stage B helper ──
    const existingStepData = (draft.step_data || {}) as Record<string, unknown>
    const existingUploads =
      (existingStepData.uploads as Record<string, unknown> | undefined) ?? null
    const mergedUploads = mergeDraftUploads(
      existingUploads,
      { [docKey]: entry } as Record<string, unknown>,
    )
    const mergedStepData = {
      ...existingStepData,
      uploads: mergedUploads,
    }

    // ── 3. Optimistic-lock update ──
    const { data: updated, error: updateError } = await supabase
      .from("draft_applications")
      .update({
        step_data: mergedStepData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
      .eq("updated_at", draft.updated_at)
      .select("id")
      .maybeSingle()

    if (updateError) {
      Sentry.captureException(updateError, {
        level: "warning",
        fingerprint: ["ocr-draft-persist-db-error"],
        tags: { component: "persist-ocr-upload", op: "update", doc_key: docKey },
        extra: { email: normalizedEmail, draft_id: draft.id, attempt },
      })
      return { ok: false, persisted: false, reason: "db_error", error: updateError }
    }

    if (updated) {
      // Success
      return { ok: true, persisted: true }
    }

    // No row returned → optimistic-lock conflict. Loop retries up to MAX_RETRIES.
  }

  // Both attempts conflicted on the lock.
  Sentry.captureMessage(
    "persist-ocr-upload: optimistic-lock conflict after retry; OCR-side draft write dropped",
    {
      level: "warning",
      fingerprint: ["ocr-draft-persist-conflict"],
      tags: {
        component: "persist-ocr-upload",
        reason: "conflict_after_retry",
        doc_key: docKey,
      },
      extra: { email: normalizedEmail },
    },
  )
  return { ok: false, persisted: false, reason: "conflict_after_retry" }
}
