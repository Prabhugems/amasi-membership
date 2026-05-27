// Envelope contract tests for the legacy mobile shim routes.
//
// Scope: verify the LEGACY response envelope shape — the literal-string
// messages ("New", "Application under review. ", etc.), the YES/NO
// application_status strings, member as a number not boolean, the no-secret
// /settings response. The Flutter v1.0.4+2 binary switches on these values;
// drift means a silent UX regression.
//
// We deliberately do NOT test routes that require real Resend/Razorpay/Supabase
// service calls in this initial harness — those need integration tests with
// mocked deps. See migration/SHIM_README.md "Testing" for the manual smoke
// path against a deployed environment.

import { describe, it, expect, beforeAll } from "vitest"

describe("Mobile shim — envelope contract", () => {
  beforeAll(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_fixture"
  })

  describe("GET /api/settings", () => {
    it("returns only razor_key_id (no secrets)", async () => {
      const { GET } = await import("@/app/api/settings/route")
      const res = await GET()
      const json = await res.json()
      expect(json.status).toBe(true)
      expect(json.message).toBe("Get setting data")
      expect(Array.isArray(json.data)).toBe(true)
      expect(json.data).toHaveLength(1)
      expect(json.data[0]).toEqual({ razor_key_id: "rzp_test_fixture" })
      // Critical: never leak secrets (legacy backend's settings returned
      // razor_key_secret + smtp_password — do not regress).
      expect(json.data[0]).not.toHaveProperty("razor_key_secret")
      expect(json.data[0]).not.toHaveProperty("smtp_password")
    })
  })

  describe("GET /api/get_country", () => {
    it("returns country list with id/country_name/country_code", async () => {
      const { GET } = await import("@/app/api/get_country/route")
      const res = await GET()
      const json = await res.json()
      expect(json.status).toBe(true)
      expect(json.message).toBe("Country list.")
      expect(json.data.length).toBeGreaterThanOrEqual(10)
      expect(json.data[0]).toHaveProperty("id")
      expect(json.data[0]).toHaveProperty("country_name")
      expect(json.data[0]).toHaveProperty("country_code")
      // India must be id=101 per legacy convention (Flutter defaults to 101
      // for the state dropdown if no country is selected yet).
      const india = json.data.find(
        (c: { country_name: string }) => c.country_name === "India"
      )
      expect(india).toBeDefined()
      expect(india!.id).toBe(101)
    })
  })

  describe("POST /api/get_state", () => {
    it("defaults to India (101) when no id is provided", async () => {
      const { POST } = await import("@/app/api/get_state/route")
      const fd = new FormData()
      const req = new Request("http://localhost/api/get_state", {
        method: "POST",
        body: fd,
      })
      const res = await POST(req as never)
      const json = await res.json()
      expect(json.status).toBe(true)
      expect(json.message).toBe("States list.")
      expect(json.data).toHaveLength(36) // 28 states + 8 UTs
      const tn = json.data.find((s: { name: string }) => s.name === "Tamil Nadu")
      expect(tn).toBeDefined()
      expect(tn.country_id).toBe(101)
    })

    it("returns empty list for unknown country", async () => {
      const { POST } = await import("@/app/api/get_state/route")
      const fd = new FormData()
      fd.append("id", "999")
      const req = new Request("http://localhost/api/get_state", {
        method: "POST",
        body: fd,
      })
      const res = await POST(req as never)
      const json = await res.json()
      expect(json.status).toBe(true)
      expect(json.data).toEqual([])
    })
  })

  describe("GET /api/get_application", () => {
    it("returns 6 membership types with totalPrice", async () => {
      const { GET } = await import("@/app/api/get_application/route")
      const res = await GET()
      const json = await res.json()
      expect(json.status).toBe(true)
      expect(json.message).toBe("Application list.")
      expect(json.data).toHaveLength(6)

      const lm = json.data.find(
        (t: { application_name: string }) => t.application_name === "Life Member"
      )
      expect(lm).toBeDefined()
      expect(lm.fee).toBe(4230)
      expect(lm.totalPrice).toBe(4230)
      expect(lm.currency_code).toBe("INR")

      const ilm = json.data.find(
        (t: { application_name: string }) =>
          t.application_name === "International Life Member"
      )
      expect(ilm).toBeDefined()
      expect(ilm.fee).toBe(300)
      expect(ilm.currency_code).toBe("USD")
    })
  })

  describe("Stub routes — feature updating envelope", () => {
    const stubs = [
      "device_token_update",
      "check_user_data",
      "check_common_login",
      "common_member_resend_otp",
      "memberforgotpassword",
      "mobile_notification_list",
      "mobile_notification_all_read",
      "mobile_notification_status_update",
      "enquiry_form",
      "know_membership",
      "send_details_toMail",
      "member_info",
      "track_application",
      "get_member_activity",
      "delete_clinic",
      "delete_work_exp",
      "delete_old_member_application",
      "member_conversion",
    ] as const

    // Use Vite's import.meta.glob (vitest at runtime) to enumerate stubs
    // without the dynamic-import-vars warning. ImportMeta isn't typed for
    // .glob by default — cast through a local interface. Vitest evaluates
    // this at module-load, not per-test, so the cost is paid once.
    const stubModules = (
      import.meta as unknown as {
        glob: (pattern: string) => Record<
          string,
          () => Promise<{ POST: () => Promise<Response> }>
        >
      }
    ).glob("/src/app/api/*/route.ts")

    it.each(stubs)("/%s returns the stub envelope", async (name) => {
      const path = Object.keys(stubModules).find((p) =>
        p.endsWith(`/api/${name}/route.ts`)
      )
      expect(path).toBeDefined()
      const mod = await stubModules[path!]()
      const res = await mod.POST()
      const json = (await res.json()) as { status: boolean; message: string; feature: string }
      expect(json.status).toBe(false)
      expect(typeof json.message).toBe("string")
      expect(json.message).toContain("temporarily unavailable")
      expect(json.feature).toBe(name)
    })
  })

  describe("Helpers (mobile-shim.ts)", () => {
    it("legacyOk emits {status:true, message, ...extra}", async () => {
      const { legacyOk } = await import("@/lib/mobile-shim")
      const res = legacyOk("hi", { userid: "abc", member: 1 })
      const json = await res.json()
      expect(json).toEqual({ status: true, message: "hi", userid: "abc", member: 1 })
    })

    it("legacyErr emits {status:false, message, ...extra}", async () => {
      const { legacyErr } = await import("@/lib/mobile-shim")
      const res = legacyErr("nope", { err_type: 1 })
      const json = await res.json()
      expect(json).toEqual({ status: false, message: "nope", err_type: 1 })
    })

    it("parseLegacyForm accepts multipart", async () => {
      const { parseLegacyForm, field } = await import("@/lib/mobile-shim")
      const fd = new FormData()
      fd.append("email", "x@y.com")
      fd.append("name", "Test")
      const req = new Request("http://localhost/x", { method: "POST", body: fd })
      const form = await parseLegacyForm(req as never)
      expect(field(form, "email")).toBe("x@y.com")
      expect(field(form, "name")).toBe("Test")
      expect(field(form, "missing")).toBe("")
    })

    it("parseLegacyForm accepts JSON and re-marshals", async () => {
      const { parseLegacyForm, field } = await import("@/lib/mobile-shim")
      const req = new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@y.com", code: 123456 }),
      })
      const form = await parseLegacyForm(req as never)
      expect(field(form, "email")).toBe("x@y.com")
      expect(field(form, "code")).toBe("123456")
    })

    it("arrayField handles both repeated and indexed shapes", async () => {
      const { arrayField } = await import("@/lib/mobile-shim")
      const fd1 = new FormData()
      fd1.append("clinic_name", "A")
      fd1.append("clinic_name", "B")
      expect(arrayField(fd1, "clinic_name")).toEqual(["A", "B"])

      const fd2 = new FormData()
      fd2.append("clinic_name[0]", "X")
      fd2.append("clinic_name[1]", "Y")
      fd2.append("clinic_name[2]", "Z")
      expect(arrayField(fd2, "clinic_name")).toEqual(["X", "Y", "Z"])
    })
  })
})
