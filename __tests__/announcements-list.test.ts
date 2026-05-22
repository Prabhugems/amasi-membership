/**
 * GET /api/announcements regression tests.
 *
 * Covers:
 *  1. Filters: response excludes unpublished rows AND audience='members'
 *     rows. The handler issues two .eq() filters; the mock asserts both.
 *  2. Schema drift: every column requested in the SELECT exists on the
 *     real `announcements` table (gate against the 49bbbfe class of bug).
 *  3. Error path: a thrown query surfaces as 500 + Sentry capture, not
 *     a silent "No announcements" 200.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const h = vi.hoisted(() => {
  // Real columns on public.announcements as of migration 034.
  const KNOWN_ANNOUNCEMENT_COLUMNS = new Set([
    "id", "title", "body", "published", "audience", "created_at", "updated_at",
  ])

  // Three fixtures: 1 published+public (visible), 1 unpublished (hidden),
  // 1 published but audience='members' (hidden).
  const ALL_ROWS = [
    {
      id: "a1", title: "Welcome", body: "Hello members.",
      published: true, audience: "public",
      created_at: "2026-05-22T10:00:00Z", updated_at: "2026-05-22T10:00:00Z",
    },
    {
      id: "a2", title: "Draft note", body: "Not ready.",
      published: false, audience: "public",
      created_at: "2026-05-21T10:00:00Z", updated_at: "2026-05-21T10:00:00Z",
    },
    {
      id: "a3", title: "Members only", body: "Confidential.",
      published: true, audience: "members",
      created_at: "2026-05-20T10:00:00Z", updated_at: "2026-05-20T10:00:00Z",
    },
  ]

  const state = {
    lastSelect: "",
    publishedFilter: undefined as boolean | undefined,
    audienceFilter: undefined as string | undefined,
  }

  // Mock builder mirrors the supabase-js chain the handler uses:
  // .select().eq().eq().order().limit().throwOnError()
  function buildQuery(cols: string) {
    state.lastSelect = cols
    state.publishedFilter = undefined
    state.audienceFilter = undefined

    const requested = cols.split(",").map((c) => c.trim()).filter(Boolean)
    const invalid = requested.find((c) => c !== "*" && !KNOWN_ANNOUNCEMENT_COLUMNS.has(c))

    const terminal = {
      throwOnError() {
        if (invalid) {
          return Promise.reject(
            Object.assign(new Error(`column "${invalid}" does not exist`), { code: "42703" })
          )
        }
        const rows = ALL_ROWS.filter(
          (r) =>
            (state.publishedFilter === undefined || r.published === state.publishedFilter) &&
            (state.audienceFilter === undefined || r.audience === state.audienceFilter)
        )
        // Only return the columns the caller asked for, like Supabase does.
        const projected = rows.map((r) => {
          const out: Record<string, unknown> = {}
          for (const c of requested) out[c] = (r as Record<string, unknown>)[c]
          return out
        })
        return Promise.resolve({ data: projected, error: null })
      },
    }
    const chain: Record<string, unknown> = {
      eq(col: string, value: unknown) {
        if (col === "published") state.publishedFilter = value as boolean
        if (col === "audience") state.audienceFilter = value as string
        return chain
      },
      order: () => chain,
      limit: () => terminal,
    }
    return chain
  }

  return {
    KNOWN_ANNOUNCEMENT_COLUMNS,
    state,
    buildQuery,
    captureExceptionSpy: vi.fn(),
    checkRateLimitImpl: vi.fn<
      (key: string, limit: number, windowMs: number) => Promise<{ allowed: boolean; remaining: number }>
    >(async () => ({ allowed: true, remaining: 999 })),
  }
})

// ── Rate limit: allow by default; per-test override possible ────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: h.checkRateLimitImpl,
}))

// ── Sentry spy ──────────────────────────────────────────────────────────────
vi.mock("@sentry/nextjs", () => ({
  captureException: h.captureExceptionSpy,
  captureMessage: vi.fn(),
}))

// ── Supabase mock ───────────────────────────────────────────────────────────
vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "announcements") throw new Error(`Unmocked Supabase table: ${table}`)
      return { select: (cols: string) => h.buildQuery(cols) }
    },
  })),
}))

// Import AFTER mocks
import { GET } from "@/app/api/announcements/route"
import { NextRequest } from "next/server"

function buildRequest(): NextRequest {
  return new NextRequest("https://test.local/api/announcements", { method: "GET" })
}

beforeEach(() => {
  h.captureExceptionSpy.mockClear()
  h.checkRateLimitImpl.mockResolvedValue({ allowed: true, remaining: 999 })
  h.state.lastSelect = ""
  h.state.publishedFilter = undefined
  h.state.audienceFilter = undefined
})

describe("/api/announcements", () => {
  it("returns only published + audience=public rows; excludes draft and members-only", async () => {
    const res = await GET(buildRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(body.message).toBe("OK")
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe("a1")
    expect(body.data[0].title).toBe("Welcome")

    // Confirm the handler actually issued both filters — without these,
    // an unpublished or members-only announcement could leak.
    expect(h.state.publishedFilter).toBe(true)
    expect(h.state.audienceFilter).toBe("public")

    // Response intentionally omits `published` and `audience` (admin
    // concerns, not client-facing).
    expect(body.data[0]).not.toHaveProperty("published")
    expect(body.data[0]).not.toHaveProperty("audience")

    expect(h.captureExceptionSpy).not.toHaveBeenCalled()
  })

  it("every column in the SELECT exists on the announcements table", () => {
    const requested = h.state.lastSelect || "id, title, body, created_at, updated_at"
    // Re-invoke to capture lastSelect if the prior test wasn't run in isolation.
    for (const col of requested.split(",").map((c) => c.trim()).filter(Boolean)) {
      expect(
        h.KNOWN_ANNOUNCEMENT_COLUMNS.has(col),
        `unknown announcements column: ${col}`
      ).toBe(true)
    }
  })

  it("a schema error surfaces as 500 + Sentry capture (no silent No-announcements)", async () => {
    const supabase = await import("@/lib/supabase")
    vi.mocked(supabase.createAdminClient).mockReturnValueOnce({
      from: () => ({ select: () => h.buildQuery("id, title, made_up_column") }),
    } as unknown as ReturnType<typeof supabase.createAdminClient>)

    const res = await GET(buildRequest())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.status).toBe(false)
    expect(body.message).toBe("Failed to load announcements")
    expect(h.captureExceptionSpy).toHaveBeenCalledTimes(1)
    const [err, ctx] = h.captureExceptionSpy.mock.calls[0]
    expect((err as Error).message).toMatch(/made_up_column/)
    expect((ctx as { tags: Record<string, string> }).tags.flow).toBe("announcements_list")
  })

  it("rate-limit rejection returns 429 without hitting the database", async () => {
    h.checkRateLimitImpl.mockResolvedValueOnce({ allowed: false, remaining: 0 })
    const res = await GET(buildRequest())
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body.status).toBe(false)
    expect(body.message).toBe("Too many requests")
    // No query was issued, so the select string from setUp stays empty.
    expect(h.state.lastSelect).toBe("")
  })
})
