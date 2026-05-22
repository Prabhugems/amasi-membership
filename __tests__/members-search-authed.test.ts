/**
 * /api/members/search regression tests.
 *
 * Catches the schema-drift class that produced the `mobile` vs `phone`
 * bug in 49bbbfe: MEMBER_SELECT referenced a column that doesn't exist,
 * Supabase 42703'd, the route swallowed the error, and every Bearer-
 * authed mobile search silently returned "No data found."
 *
 * Two guards:
 *  1. Behaviour: a Bearer-authed name search resolves to data.length > 0
 *     against a mock that validates the SELECT list against the real schema.
 *  2. Static: every column in MEMBER_SELECT / PUBLIC_SELECT is in the
 *     known-good column set captured from information_schema.columns at
 *     the time of writing. If someone adds a new column here without
 *     updating the allowlist, the test fails loudly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// State shared between mock factories and tests has to live in vi.hoisted()
// because vi.mock(...) factory bodies run before any top-level declarations.
const h = vi.hoisted(() => {
  // Columns that actually exist on public.members, captured from
  // information_schema 2026-05-22 (see route-fix PR for the SQL).
  // Update this set when the migration adds/renames a column.
  const KNOWN_MEMBER_COLUMNS = new Set([
    "id", "amasi_number", "name", "email", "phone", "membership_type",
    "status", "voting_eligible", "created_at", "updated_at", "asi_member_id",
    "father_name", "date_of_birth", "nationality", "gender", "application_no",
    "application_date", "mobile_code", "landline", "std_code",
    "street_address_1", "street_address_2", "city", "state", "country",
    "postal_code", "ug_college", "ug_university", "ug_year", "pg_degree",
    "pg_college", "pg_university", "pg_year", "mci_council_number",
    "mci_council_state", "imr_registration_no", "asi_membership_no",
    "asi_state", "other_intl_org", "other_intl_org_value", "zone", "salutation",
    "edu_undergrad_degree", "edu_superspecialty_degree",
    "edu_superspecialty_college", "edu_superspecialty_university",
    "edu_superspecialty_year", "mci_certificate", "pg_degree_certificate",
    "asi_member_certificate", "active_license", "letter_hod",
    "mbbs_degree_certificate", "profile_photo", "application_status",
    "joining_date", "mysql_id", "marketing_opt_out_at", "first_name",
    "middle_name", "last_name",
  ])
  const FAKE_ROW = {
    id: "a394c4fc-3f27-4efd-b32d-87438a827103",
    name: "Prabhu B",
    amasi_number: 15632,
    membership_type: "LM",
    city: "Coimbatore",
    state: "Tamil Nadu",
    zone: "South Zone",
    pg_degree: "MS General Surgery",
    status: "active",
    profile_photo: "https://example.test/photo.png",
    email: "prabhu3693gems@gmail.com",
    phone: 8056536384,
    mobile_code: "+91",
  }
  const state = { lastSelect: "" }

  // `.select(cols)` records what was asked for and validates every column.
  // Terminal `.throwOnError()` either resolves with a synthetic row or rejects
  // the way real Supabase does on a missing column (42703), so the route's
  // new throwOnError-based error path is exercised end-to-end.
  function buildQuery(cols: string) {
    state.lastSelect = cols
    const requested = cols.split(",").map((c) => c.trim()).filter(Boolean)
    const invalid = requested.find((c) => c !== "*" && !KNOWN_MEMBER_COLUMNS.has(c))
    const terminal = {
      throwOnError() {
        if (invalid) {
          return Promise.reject(
            Object.assign(new Error(`column "${invalid}" does not exist`), { code: "42703" })
          )
        }
        return Promise.resolve({ data: [FAKE_ROW], error: null })
      },
    }
    const chain: Record<string, unknown> = {
      ilike: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => terminal,
    }
    return chain
  }

  return {
    KNOWN_MEMBER_COLUMNS,
    FAKE_ROW,
    state,
    buildQuery,
    captureExceptionSpy: vi.fn(),
    // Typed return is the union of "authed" and null so a per-test
    // mockResolvedValueOnce(null) can demote to the anonymous tier.
    getMemberSessionImpl: vi.fn<
      () => Promise<{ sub: string; email: string; role: string } | null>
    >(async () => ({
      sub: "auth0|test",
      email: "prabhu3693gems@gmail.com",
      role: "member",
    })),
  }
})

// ── Auth: simulate a Bearer-authed member (the mobile-client path) ──────────
vi.mock("@/lib/auth", () => ({
  getAdminSession: vi.fn(async () => null),
  getMemberSession: h.getMemberSessionImpl,
}))

// ── Rate limit: always allow ────────────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 999 })),
}))

// ── Sentry spy ──────────────────────────────────────────────────────────────
vi.mock("@sentry/nextjs", () => ({
  captureException: h.captureExceptionSpy,
  captureMessage: vi.fn(),
}))

// ── Supabase mock: validates the SELECT list against the real schema ────────
vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "members") throw new Error(`Unmocked Supabase table: ${table}`)
      return { select: (cols: string) => h.buildQuery(cols) }
    },
  })),
}))

// Import AFTER mocks
import { GET } from "@/app/api/members/search/route"
import { MEMBER_SELECT, PUBLIC_SELECT } from "@/lib/member-search-fields"
import { NextRequest } from "next/server"

function buildRequest(query: string, opts?: { bearer?: string }): NextRequest {
  return new NextRequest(
    `https://test.local/api/members/search?q=${encodeURIComponent(query)}`,
    {
      method: "GET",
      headers: opts?.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {},
    }
  )
}

beforeEach(() => {
  h.state.lastSelect = ""
  h.captureExceptionSpy.mockClear()
  h.getMemberSessionImpl.mockResolvedValue({
    sub: "auth0|test",
    email: "prabhu3693gems@gmail.com",
    role: "member",
  })
})

describe("/api/members/search — column-drift regression (49bbbfe)", () => {
  it("Bearer-authed name search returns data.length > 0 for a known member", async () => {
    const res = await GET(buildRequest("Prabhu", { bearer: "test-token" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0].name).toBe("Prabhu B")
    expect(body.data[0].amasi_number).toBe(15632)
    // Mapper preserves the phone-as-mobile compatibility shim.
    expect(body.data[0].mobile).toBe("8056536384")

    // Sanity: the authed branch picked MEMBER_SELECT, not PUBLIC_SELECT or "*".
    expect(h.state.lastSelect).toBe(MEMBER_SELECT)
    expect(h.captureExceptionSpy).not.toHaveBeenCalled()
  })

  it("every column in MEMBER_SELECT and PUBLIC_SELECT exists on the members table", () => {
    const all = [
      ...MEMBER_SELECT.split(",").map((c) => c.trim()),
      ...PUBLIC_SELECT.split(",").map((c) => c.trim()),
    ]
    for (const col of all) {
      expect(h.KNOWN_MEMBER_COLUMNS.has(col), `unknown members column: ${col}`).toBe(true)
    }
  })

  it("a schema error surfaces as 500 + Sentry capture (no silent No-data-found)", async () => {
    // Public-tier this time so the mock builds a known-bad select via override.
    h.getMemberSessionImpl.mockResolvedValueOnce(null)

    const supabase = await import("@/lib/supabase")
    vi.mocked(supabase.createAdminClient).mockReturnValueOnce({
      from: () => ({ select: () => h.buildQuery("id, name, made_up_column") }),
    } as unknown as ReturnType<typeof supabase.createAdminClient>)

    const res = await GET(buildRequest("Prabhu"))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.status).toBe(false)
    expect(body.message).toBe("Search failed")
    expect(h.captureExceptionSpy).toHaveBeenCalledTimes(1)
    const [err, ctx] = h.captureExceptionSpy.mock.calls[0]
    expect((err as Error).message).toMatch(/made_up_column/)
    expect((ctx as { tags: Record<string, string> }).tags.flow).toBe("members_search")
  })
})
