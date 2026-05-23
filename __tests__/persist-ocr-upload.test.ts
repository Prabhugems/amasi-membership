/**
 * Stage C unit tests — persistOcrUploadToDraft must:
 *   - read the draft by lowercased email
 *   - merge via Stage B's mergeDraftUploads helper (no new merge code)
 *   - retry once on optimistic-lock conflict, fail safely after that
 *   - silently skip on unknown docKey (the §7.1 corruption guard)
 *   - return a typed result; NEVER throw
 *   - preserve non-uploads step_data keys verbatim
 *   - be idempotent: calling twice with same args ends at the same state
 *
 * Plus race tests: simulate two interleaved persists for different
 * docKeys against the same draft; both land via the conflict-retry path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { persistOcrUploadToDraft } from "@/lib/persist-ocr-upload"

// ── Supabase mock: in-memory single-draft store with optimistic-lock semantics ──
//
// The mock mirrors the .from("draft_applications").select(...)/.update(...)
// chain just enough to test the helper. Optimistic lock: .update().eq(
// "updated_at", X) returns data:null if X != store.draft.updated_at.
//
// Concurrency control hooks:
//   - bumpBeforeNextUpdate: one-shot — next update bumps the lock first,
//     forcing conflict. Clears after firing.
//   - bumpBeforeEveryUpdate: every update bumps. For the "conflict after
//     retry" test where both attempts must conflict.
//   - mutateOnNextBump: optional callback that runs alongside the bump,
//     letting the test inject ghost-writer state (e.g. another upload).

type DraftRow = {
  id: string
  email: string
  step_data: Record<string, unknown>
  updated_at: string
}

type Store = {
  draft: DraftRow | null
  readError: Error | null
  updateError: Error | null
  bumpBeforeNextUpdate?: boolean
  bumpBeforeEveryUpdate?: boolean
  mutateOnNextBump?: (s: Store) => void
}

let store: Store
let monotonicCounter = 0
function nextTimestamp(): string {
  // Strict-monotonic timestamps so the same-millisecond JS tick doesn't
  // accidentally make two writes look like they have the same updated_at.
  monotonicCounter += 1
  return new Date(Date.UTC(2026, 4, 23, 12, 0, 0, monotonicCounter)).toISOString()
}

function bumpDraft(s: Store) {
  if (!s.draft) return
  s.draft = { ...s.draft, updated_at: nextTimestamp() }
  if (s.mutateOnNextBump) {
    const fn = s.mutateOnNextBump
    s.mutateOnNextBump = undefined
    fn(s)
  }
}

function makeFromChain() {
  type State = {
    op: "select" | "update" | null
    updatePayload: Record<string, unknown> | null
    eqEmail: string | null
    eqId: string | null
    eqUpdatedAt: string | null
  }
  const state: State = {
    op: null,
    updatePayload: null,
    eqEmail: null,
    eqId: null,
    eqUpdatedAt: null,
  }

  const handler: ProxyHandler<object> = {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string") return undefined
      if (prop === "then") return undefined
      if (prop === "maybeSingle" || prop === "single") {
        return async () => {
          if (state.op === "select") {
            if (store.readError) return { data: null, error: store.readError }
            const match =
              store.draft &&
              (!state.eqEmail ||
                store.draft.email.toLowerCase() === state.eqEmail.toLowerCase())
                ? store.draft
                : null
            return { data: match, error: null }
          }
          if (state.op === "update") {
            if (store.updateError) return { data: null, error: store.updateError }
            // Concurrency hooks — fire BEFORE the lock-check, simulating
            // another writer landing between our read and our update.
            if (store.bumpBeforeEveryUpdate) bumpDraft(store)
            else if (store.bumpBeforeNextUpdate) {
              bumpDraft(store)
              store.bumpBeforeNextUpdate = false
            }
            const matches =
              store.draft &&
              store.draft.id === state.eqId &&
              store.draft.updated_at === state.eqUpdatedAt
            if (!matches) {
              // Conflict: no row returned
              return { data: null, error: null }
            }
            const payload = state.updatePayload || {}
            store.draft = {
              ...store.draft!,
              ...payload,
              updated_at: nextTimestamp(),
            }
            return { data: { id: store.draft.id }, error: null }
          }
          return { data: null, error: null }
        }
      }
      return (...args: unknown[]) => {
        if (prop === "select") {
          state.op = state.op ?? "select"
        } else if (prop === "update") {
          state.op = "update"
          state.updatePayload = args[0] as Record<string, unknown>
        } else if (prop === "eq") {
          const col = args[0] as string
          const val = args[1] as string | undefined
          if (col === "email") state.eqEmail = val ?? null
          else if (col === "id") state.eqId = val ?? null
          else if (col === "updated_at") state.eqUpdatedAt = val ?? null
        }
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}

function makeSupabase() {
  return { from: () => makeFromChain() } as unknown as Parameters<
    typeof persistOcrUploadToDraft
  >[0]["supabase"]
}

// Avoid real Sentry network in tests
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

function seedDraft(uploads: Record<string, unknown> = {}, otherStepData: Record<string, unknown> = {}) {
  store = {
    draft: {
      id: "draft-1",
      email: "applicant@test.local",
      step_data: { uploads, ...otherStepData },
      updated_at: nextTimestamp(),
    },
    readError: null,
    updateError: null,
  }
}

beforeEach(() => {
  monotonicCounter = 0
  store = { draft: null, readError: null, updateError: null }
  vi.clearAllMocks()
})

describe("persistOcrUploadToDraft — Stage C", () => {
  // ─── Happy paths ───
  it("writes the entry to step_data.uploads[docKey] for an existing draft", async () => {
    seedDraft({})
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf", extracted: { reg: "X" } },
    })
    expect(res).toEqual({ ok: true, persisted: true })
    const stepData = store.draft!.step_data as { uploads: Record<string, { fileUrl: string }> }
    expect(stepData.uploads.mci_certificate.fileUrl).toBe("https://s/mci.pdf")
  })

  it("merges via Stage B mergeDraftUploads — other uploads preserved", async () => {
    seedDraft({
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci_old.pdf" },
    })
    await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "pg_degree_certificate",
      entry: { status: "extracted", fileUrl: "https://s/pg.pdf", extracted: {} },
    })
    const u = (store.draft!.step_data as { uploads: Record<string, { fileUrl: string }> }).uploads
    expect(u.profile.fileUrl).toBe("https://s/photo.png")
    expect(u.mci_certificate.fileUrl).toBe("https://s/mci_old.pdf")
    expect(u.pg_degree_certificate.fileUrl).toBe("https://s/pg.pdf")
  })

  it("preserves non-uploads step_data keys verbatim", async () => {
    seedDraft({}, {
      formData: { firstName: "Vidhi", lastName: "Singh" },
      membership_type: "ALM",
      email_verified: true,
    })
    await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    const sd = store.draft!.step_data as Record<string, unknown>
    expect(sd.formData).toEqual({ firstName: "Vidhi", lastName: "Singh" })
    expect(sd.membership_type).toBe("ALM")
    expect(sd.email_verified).toBe(true)
  })

  it("uses lowercased email for lookup (defense vs. mixed-case session.email)", async () => {
    seedDraft({})
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "Applicant@Test.Local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    expect(res.persisted).toBe(true)
  })

  it("is idempotent: calling twice with same args leaves the same final state", async () => {
    seedDraft({})
    const entry = { status: "extracted", fileUrl: "https://s/mci.pdf", extracted: { reg: "Y" } }
    const r1 = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry,
    })
    const r2 = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry,
    })
    expect(r1.persisted).toBe(true)
    expect(r2.persisted).toBe(true)
    const u = (store.draft!.step_data as { uploads: Record<string, { fileUrl: string; extracted: unknown }> }).uploads
    expect(u.mci_certificate.fileUrl).toBe("https://s/mci.pdf")
    expect(u.mci_certificate.extracted).toEqual({ reg: "Y" })
  })

  // ─── no-draft path ───
  it("returns no_draft when no row exists for the email — does NOT throw or write", async () => {
    store = { draft: null, readError: null, updateError: null }
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "missing@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    expect(res).toEqual({ ok: true, persisted: false, reason: "no_draft" })
    expect(store.draft).toBeNull()
  })

  // ─── docKey allowlist (the §7.1 corruption guard) ───
  it("silently skips writes for unknown docKeys (the §7.1 guard)", async () => {
    seedDraft({})
    const before = JSON.stringify(store.draft!.step_data)
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "definitely_not_a_real_doc_type",
      entry: { status: "extracted", fileUrl: "https://s/x.pdf" },
    })
    expect(res).toEqual({ ok: true, persisted: false, reason: "invalid_doc_key" })
    expect(JSON.stringify(store.draft!.step_data)).toBe(before)
  })

  it("accepts 'profile' (alias of canonical 'photo') — the actual client key", async () => {
    seedDraft({})
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "profile",
      entry: { status: "uploaded", fileUrl: "https://s/photo.png", extracted: {} },
    })
    expect(res.persisted).toBe(true)
    const u = (store.draft!.step_data as { uploads: Record<string, { fileUrl: string }> }).uploads
    expect(u.profile?.fileUrl).toBe("https://s/photo.png")
    // CRUCIAL: nothing written under canonical 'photo' (would be the corruption shape)
    expect(u.photo).toBeUndefined()
  })

  it("accepts canonical 'photo' too (defensive — not what the client uses, but safe)", async () => {
    seedDraft({})
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "photo",
      entry: { status: "uploaded", fileUrl: "https://s/photo.png", extracted: {} },
    })
    expect(res.persisted).toBe(true)
  })

  // ─── Conflict + retry behavior ───
  it("retries once on optimistic-lock conflict and succeeds on the second attempt", async () => {
    seedDraft({})
    const initialUpdatedAt = store.draft!.updated_at
    // One-shot conflict: the FIRST update bumps the lock first → conflict.
    // The retry's update sees a fresh read with no bump → match → success.
    store.bumpBeforeNextUpdate = true

    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    expect(res).toEqual({ ok: true, persisted: true })
    expect(store.draft!.updated_at).not.toBe(initialUpdatedAt)
    const u = (store.draft!.step_data as { uploads: Record<string, { fileUrl: string }> }).uploads
    expect(u.mci_certificate.fileUrl).toBe("https://s/mci.pdf")
  })

  it("returns conflict_after_retry (ok:false) when BOTH attempts conflict — never throws", async () => {
    seedDraft({})
    // Every update bumps the lock first → both attempts conflict.
    store.bumpBeforeEveryUpdate = true

    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    expect(res).toEqual({ ok: false, persisted: false, reason: "conflict_after_retry" })
    expect(res).toBeTruthy()
  })

  // ─── DB error paths — also no-throw guarantee ───
  it("returns db_error (ok:false) when the read errors — never throws", async () => {
    store = {
      draft: null,
      readError: new Error("connection terminated"),
      updateError: null,
    }
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    expect(res.ok).toBe(false)
    if (!res.ok && res.reason === "db_error") {
      expect((res.error as Error).message).toBe("connection terminated")
    } else {
      throw new Error(`Expected db_error, got ${JSON.stringify(res)}`)
    }
  })

  it("returns db_error when the update errors — never throws", async () => {
    seedDraft({})
    store.updateError = new Error("write failed")
    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    expect(res.ok).toBe(false)
    expect((res as { reason: string }).reason).toBe("db_error")
  })
})

// ─── Race tests — two interleaved writes, different docKeys ───────────────
describe("persistOcrUploadToDraft — race", () => {
  it("sequential A then B (no conflict): both entries present, original keys preserved", async () => {
    seedDraft({})
    const sb = makeSupabase()
    const resA = await persistOcrUploadToDraft({
      supabase: sb,
      email: "applicant@test.local",
      docKey: "mci_certificate",
      entry: { status: "extracted", fileUrl: "https://s/mci.pdf" },
    })
    expect(resA.persisted).toBe(true)

    const resB = await persistOcrUploadToDraft({
      supabase: sb,
      email: "applicant@test.local",
      docKey: "pg_degree_certificate",
      entry: { status: "extracted", fileUrl: "https://s/pg.pdf" },
    })
    expect(resB.persisted).toBe(true)

    const u = (store.draft!.step_data as { uploads: Record<string, { fileUrl: string }> }).uploads
    expect(u.mci_certificate.fileUrl).toBe("https://s/mci.pdf")
    expect(u.pg_degree_certificate.fileUrl).toBe("https://s/pg.pdf")
  })

  it("conflict-retry race: first attempt loses to a ghost writer, retry merges all three entries", async () => {
    seedDraft({ mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" } })

    // One-shot ghost writer: between our read and our update, another
    // writer lands a profile entry. Our update's lock-check fails →
    // conflict → helper retries → retry reads fresh (now has profile) →
    // merges pg in → update succeeds.
    store.bumpBeforeNextUpdate = true
    store.mutateOnNextBump = (s) => {
      s.draft = {
        ...s.draft!,
        step_data: {
          ...s.draft!.step_data,
          uploads: {
            ...(s.draft!.step_data.uploads as Record<string, unknown>),
            profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
          },
        },
      }
    }

    const res = await persistOcrUploadToDraft({
      supabase: makeSupabase(),
      email: "applicant@test.local",
      docKey: "pg_degree_certificate",
      entry: { status: "extracted", fileUrl: "https://s/pg.pdf" },
    })
    expect(res).toEqual({ ok: true, persisted: true })

    const u = (store.draft!.step_data as { uploads: Record<string, { fileUrl: string }> }).uploads
    // All three must survive: original mci, ghost-writer's profile, AND our pg
    expect(u.mci_certificate.fileUrl).toBe("https://s/mci.pdf")
    expect(u.profile?.fileUrl).toBe("https://s/photo.png")
    expect(u.pg_degree_certificate.fileUrl).toBe("https://s/pg.pdf")
  })
})
