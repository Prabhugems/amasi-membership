// Contract tests for the legacy mobile-shim routes that GRADUATED from the
// uniform "feature updating" stub to real implementations. The companion
// mobile-shim-contracts.test.ts pins the envelope helpers + the read-only
// reference routes; this file pins the behaviour of the routes that talk to
// Supabase, mocking the DB layer so we can assert each route's legacy-facing
// contract (the exact status/message the Flutter v1.0.4+2 binary switches on)
// without real service calls.
//
// Coverage strategy per route:
//   - fixed-response routes (no deps)       → assert exact envelope
//   - validation branches (missing field)   → assert the legacyErr message
//   - DB-backed business rules              → mock Supabase, assert the contract
//
// checkRateLimit fail-opens to an in-memory limiter when Upstash isn't
// configured (rate-limit.ts:65-66), so rate-limited routes pass their gate in
// tests without mocking — we stay well under the per-key limits.

import { describe, it, expect, beforeEach, vi } from "vitest"

// Mutable mock state, shared between the hoisted vi.mock factory and the tests.
const db = vi.hoisted(() => ({
  // table name → row returned by .maybeSingle()/.single() (null = not found)
  rows: {} as Record<string, unknown>,
  // error returned by insert/update/delete/upsert chains (null = success)
  writeError: null as { message: string } | null,
}))

vi.mock("@/lib/supabase", () => {
  // A chainable query proxy that is BOTH awaitable (write chains like
  // `await from(t).update(...).eq(...)`) AND terminable via maybeSingle/single
  // (read chains). Every builder method returns the same proxy; the terminal
  // resolves to { data, error } from the shared `db` state, keyed by table.
  const makeQuery = (table: string) => {
    const resolve = () => ({ data: db.rows[table] ?? null, error: db.writeError })
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === "then") {
          return (onFulfilled: (v: unknown) => unknown) => onFulfilled(resolve())
        }
        if (prop === "maybeSingle" || prop === "single") {
          return async () => resolve()
        }
        return () => new Proxy({}, handler)
      },
    }
    return new Proxy({}, handler)
  }
  return {
    createAdminClient: vi.fn(() => ({ from: (table: string) => makeQuery(table) })),
  }
})

// Build a legacy POST request. parseLegacyForm accepts application/json and
// converts it to FormData, so JSON bodies exercise the same field() path.
function postJson(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/shim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

type Envelope = { status: boolean; message: string; [k: string]: unknown }

beforeEach(() => {
  db.rows = {}
  db.writeError = null
})

describe("Mobile shim routes — graduated contracts", () => {
  // ── Fixed-response routes (no deps) ──────────────────────────────────────
  describe("fixed-response routes", () => {
    it("check_common_login points users to the OTP tab", async () => {
      const { POST } = await import("@/app/api/check_common_login/route")
      const json = (await (await POST()).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Password login is no longer supported")
      expect(json.message).toContain("OTP")
    })

    it("memberforgotpassword points users to the OTP tab", async () => {
      const { POST } = await import("@/app/api/memberforgotpassword/route")
      const json = (await (await POST()).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Login with OTP")
    })

    it("delete_clinic redirects to the web portal", async () => {
      const { POST } = await import("@/app/api/delete_clinic/route")
      const json = (await (await POST()).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("membership.amasi.org")
    })

    it("delete_work_exp redirects to the web portal", async () => {
      const { POST } = await import("@/app/api/delete_work_exp/route")
      const json = (await (await POST()).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("membership.amasi.org")
    })
  })

  // ── device_token_update: always succeeds; skips DB when no token ─────────
  describe("device_token_update", () => {
    it("returns OK even with no device_id (Flutter ignores the body)", async () => {
      const { POST } = await import("@/app/api/device_token_update/route")
      const res = await POST(postJson({}) as never)
      const json = (await res.json()) as Envelope
      expect(json.status).toBe(true)
      expect(json.message).toBe("OK")
    })
  })

  // ── Required-field validation contracts ──────────────────────────────────
  describe("required-field validation", () => {
    it("check_user_data requires username", async () => {
      const { POST } = await import("@/app/api/check_user_data/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Username is required")
    })

    it("mobile_notification_all_read requires member_id", async () => {
      const { POST } = await import("@/app/api/mobile_notification_all_read/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("member_id is required")
    })

    it("mobile_notification_status_update requires id", async () => {
      const { POST } = await import("@/app/api/mobile_notification_status_update/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("id is required")
    })

    it("enquiry_form requires email, subject and message", async () => {
      const { POST } = await import("@/app/api/enquiry_form/route")
      const json = (await (await POST(postJson({ email_id: "a@b.com" }) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("subject and message are required")
    })

    it("delete_old_member_application requires id", async () => {
      const { POST } = await import("@/app/api/delete_old_member_application/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Id is required")
    })

    it("common_member_resend_otp requires id and email", async () => {
      const { POST } = await import("@/app/api/common_member_resend_otp/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Id and email are required")
    })

    it("mobile_notification_list requires member_id", async () => {
      const { POST } = await import("@/app/api/mobile_notification_list/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("member_id is required")
    })

    it("know_membership requires email or mobile", async () => {
      const { POST } = await import("@/app/api/know_membership/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Email or mobile is required")
    })

    it("member_conversion requires a member id", async () => {
      const { POST } = await import("@/app/api/member_conversion/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Member id is required")
    })

    it("member_info requires id", async () => {
      const { POST } = await import("@/app/api/member_info/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Id is required")
    })

    it("track_application requires email and application number", async () => {
      const { POST } = await import("@/app/api/track_application/route")
      const json = (await (await POST(postJson({ email: "a@b.com" }) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("application number are required")
    })

    it("get_member_activity requires member_id", async () => {
      const { POST } = await import("@/app/api/get_member_activity/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("member_id is required")
    })

    it("send_details_toMail requires id", async () => {
      const { POST } = await import("@/app/api/send_details_toMail/route")
      const json = (await (await POST(postJson({}) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("Id is required")
    })
  })

  // ── DB-backed business rules ─────────────────────────────────────────────
  describe("check_user_data member flag (Flutter switches on this)", () => {
    it("returns member:1 for an active member", async () => {
      db.rows.members = { id: "m1", status: "active" }
      const { POST } = await import("@/app/api/check_user_data/route")
      const json = (await (await POST(postJson({ username: "doc@amasi.org" }) as never)).json()) as Envelope
      expect(json.status).toBe(true)
      expect(json.member).toBe(1)
      expect(json.event).toBe(0)
    })

    it("returns member:0 when no member exists", async () => {
      db.rows.members = null
      const { POST } = await import("@/app/api/check_user_data/route")
      const json = (await (await POST(postJson({ username: "nobody@amasi.org" }) as never)).json()) as Envelope
      expect(json.status).toBe(true)
      expect(json.member).toBe(0)
    })

    it("returns member:0 for an inactive member", async () => {
      db.rows.members = { id: "m2", status: "inactive" }
      const { POST } = await import("@/app/api/check_user_data/route")
      const json = (await (await POST(postJson({ username: "lapsed@amasi.org" }) as never)).json()) as Envelope
      expect(json.member).toBe(0)
    })
  })

  describe("delete_old_member_application status gating", () => {
    it("refuses to delete a processed (approved) application", async () => {
      db.rows.membership_applications = { id: "app1", status: "approved" }
      const { POST } = await import("@/app/api/delete_old_member_application/route")
      const json = (await (await POST(postJson({ id: "app1" }) as never)).json()) as Envelope
      expect(json.status).toBe(false)
      expect(json.message).toContain("already been processed")
    })

    it("is idempotent (OK) when the application no longer exists", async () => {
      db.rows.membership_applications = null
      const { POST } = await import("@/app/api/delete_old_member_application/route")
      const json = (await (await POST(postJson({ id: "gone" }) as never)).json()) as Envelope
      expect(json.status).toBe(true)
      expect(json.message).toBe("OK")
    })

    it("deletes a discardable (pending_review) draft", async () => {
      db.rows.membership_applications = { id: "app2", status: "pending_review" }
      db.writeError = null
      const { POST } = await import("@/app/api/delete_old_member_application/route")
      const json = (await (await POST(postJson({ id: "app2" }) as never)).json()) as Envelope
      expect(json.status).toBe(true)
      expect(json.message).toBe("OK")
    })
  })
})
