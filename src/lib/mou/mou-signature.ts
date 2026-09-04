import crypto from "crypto"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import type { MouSignature } from "./types"

// Server-side only. Never accept a client-supplied hash — see Global
// Constraints in the plan doc. Joining clauses with "\n" + the raw version
// number (not JSON-stringified) matches exactly what the design spec
// documents, so this function's output is reproducible from the same
// typeConfig.mouClauses/mouVersion inputs anywhere else in the codebase.
export function computeMouHash(clauses: string[], version: number): string {
  return crypto.createHash("sha256").update(clauses.join("\n") + String(version)).digest("hex")
}

export interface CreateSignatureInput {
  applicationId: string
  mouVersion: number
  mouSha256: string
  signatoryName: string
  signatoryEmail: string
  signatoryAmasiNumber: string | null
  otpVerifiedAt: string
  ipAddress: string
  userAgent: string | null
}

export async function createMouSignature(input: CreateSignatureInput): Promise<MouSignature> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("mou_signatures")
    .insert({
      application_id: input.applicationId,
      mou_version: input.mouVersion,
      mou_sha256: input.mouSha256,
      signatory_name: input.signatoryName,
      signatory_email: input.signatoryEmail,
      signatory_amasi_number: input.signatoryAmasiNumber,
      otp_verified_at: input.otpVerifiedAt,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
    })
    .select()
    .single()

  if (error || !data) {
    Sentry.captureException(error, {
      tags: { component: "mou-signature", op: "create" },
      extra: { applicationId: input.applicationId },
    })
    // Same reasoning as approval-token.ts's createApprovalToken: a caller
    // that doesn't know its signature row was never durably recorded is
    // worse than an explicit failure — the whole point of this table is a
    // legal record that actually exists. Callers (Task 5) must catch this
    // and return an error to the applicant rather than silently proceeding.
    throw new Error(error?.message || "Failed to record MOU signature")
  }
  return data as MouSignature
}

// The ONLY UPDATE this table ever receives, anywhere in the codebase — the
// Hon. Secretary's counter-signature on approval. Scoped to both
// application_id AND mou_version so it can never touch the wrong signature
// row if an application somehow had more than one (it shouldn't, given the
// unique(application_id, mou_version) constraint, but the extra scope costs
// nothing and documents intent). Also scoped to approved_at IS NULL so a
// retry (e.g. the Secretary re-submitting a decision after an earlier
// attempt partially failed downstream) can never re-stamp an
// already-counter-signed row — this function is idempotent under retry,
// even though the surrounding decide route is not fully reorder-proof
// (that's a separate, out-of-scope architectural question).
export async function markCounterSigned(
  applicationId: string,
  mouVersion: number,
  approvedBy: string
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("mou_signatures")
    .update({ approved_by: approvedBy, approved_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .eq("mou_version", mouVersion)
    .is("approved_at", null)

  if (error) {
    // Don't throw: by the time this runs (Task 9's decide route) the
    // decision is already persisted. Same pattern as markTokenUsed in
    // approval-token.ts.
    Sentry.captureException(error, {
      tags: { component: "mou-signature", op: "mark-counter-signed" },
      extra: { applicationId, mouVersion },
    })
  }
}
