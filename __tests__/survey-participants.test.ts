/**
 * Survey participant details (AMASI Survey Consortium, Oct 2026).
 *
 * Covers:
 *  1. lib/survey: token shape, field parsing, "with details", CSV formula guard.
 *  2. /api/survey/[token]: a bad or unknown token opens nothing; GET returns only
 *     the link's own row (no id/hash); POST is same-origin only and writes just
 *     the three fields on the hashed row.
 *  3. /api/admin/survey: admin session required; status filter; CSV export.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createHash } from "node:crypto"

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  calls: [] as { method: string; args: unknown[] }[],
  updateResult: { data: [{ id: "row-1" }] as unknown[] | null, error: null as unknown },
  session: { role: "admin" } as Record<string, unknown> | null,
  rateLimitAllowed: true,
}))

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: h.rateLimitAllowed, remaining: 1, resetAt: 0 })),
}))
vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn(async () => h.session) }))
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "survey_participant_details") throw new Error(`Unmocked table ${table}`)
      const record = (method: string) => (...args: unknown[]) => {
        h.calls.push({ method, args })
        return chain
      }
      const chain: Record<string, unknown> = {
        select: record("select"),
        eq: record("eq"),
        order: record("order"),
        contains: record("contains"),
        update: record("update"),
        maybeSingle: async () => {
          const hash = h.calls.find((c) => c.method === "eq")?.args[1]
          return { data: h.rows.find((r) => r.token_hash === hash) ?? null, error: null }
        },
        range: async () => ({ data: h.rows, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(h.updateResult),
      }
      return chain
    },
  }),
}))

import { NextRequest } from "next/server"
import { GET as getParticipant, POST as postParticipant } from "@/app/api/survey/[token]/route"
import { GET as getAdmin } from "@/app/api/admin/survey/route"
import { scrubSurveyToken, scrubSurveyTokenFromEvent } from "@/lib/scrub-survey-token"
import { csvCell, hasAllDetails, parseSurveyDetails, surveyCsv, surveyTokenHash } from "@/lib/survey"

const TOKEN = "IVJd_21YOMRAxirxDrrFtxFL0oE7mzbDS-hQDfGQlvo"
const HASH = createHash("sha256").update(TOKEN).digest("hex")
const ROW = {
  id: "row-1",
  token_hash: HASH,
  email: "doc@example.com",
  surveys: ["DLC", "PVH"],
  name: "Rajesh Kumar",
  hospital: null,
  city: "Chennai",
  submitted_at: null,
  emailed_at: null,
}
const params = (token: string) => ({ params: Promise.resolve({ token }) })
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init)

beforeEach(() => {
  h.rows = [ROW]
  h.calls = []
  h.updateResult = { data: [{ id: "row-1" }], error: null }
  h.session = { role: "admin" }
  h.rateLimitAllowed = true
})

describe("lib/survey", () => {
  it("hashes only well-formed tokens", () => {
    expect(surveyTokenHash(TOKEN)).toBe(HASH)
    expect(surveyTokenHash("short")).toBeNull()
    expect(surveyTokenHash(`${TOKEN.slice(0, 42)}*`)).toBeNull()
    expect(surveyTokenHash(undefined)).toBeNull()
  })

  it("requires all three fields and ignores anything else", () => {
    expect(parseSurveyDetails({ name: " A  B ", hospital: "H", city: "C", email: "x@y.z" })).toEqual({
      ok: true,
      value: { name: "A B", hospital: "H", city: "C" },
    })
    expect(parseSurveyDetails({ name: "A", city: "C" })).toEqual({ ok: false, error: "Please fill in your hospital." })
    expect(parseSurveyDetails({ name: "A", hospital: "H".repeat(301), city: "C" }).ok).toBe(false)
  })

  it("counts a row as with details only when name, hospital and city are all filled", () => {
    expect(hasAllDetails({ name: "A", hospital: "H", city: "C" })).toBe(true)
    expect(hasAllDetails({ name: "A", hospital: " ", city: "C" })).toBe(false)
    expect(hasAllDetails({ name: "A", hospital: null, city: "C" })).toBe(false)
  })

  it("stops participant text from running as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"")
    expect(csvCell("+91 98400")).toBe("\"'+91 98400\"")
    expect(csvCell("Apollo;=HYPERLINK(1)")).toBe("\"Apollo;'=HYPERLINK(1)\"")
    expect(csvCell("Apollo, Chennai")).toBe("\"Apollo, Chennai\"")
    expect(csvCell(null)).toBe("\"\"")
  })

  it("exports a header and one line per participant", () => {
    const csv = surveyCsv([{ ...ROW, hospital: "Apollo" }])
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n")
    expect(lines[0]).toBe("Email,Surveys,Name,Hospital,City,Status,Sent by participant,Submitted at")
    expect(lines[1]).toBe('"doc@example.com","DLC + PVH","Rajesh Kumar","Apollo","Chennai","with details","no",""')
  })
})

describe("GET /api/survey/[token]", () => {
  it("opens nothing for a malformed token, without querying", async () => {
    const res = await getParticipant(req("https://membership.amasi.org/api/survey/abc"), params("abc"))
    expect(res.status).toBe(404)
    expect(h.calls).toHaveLength(0)
  })

  it("opens nothing for an unknown token", async () => {
    const other = "A".repeat(43)
    const res = await getParticipant(req(`https://membership.amasi.org/api/survey/${other}`), params(other))
    expect(res.status).toBe(404)
  })

  it("returns the link's own row with what we hold, never the id or hash", async () => {
    const res = await getParticipant(req(`https://membership.amasi.org/api/survey/${TOKEN}`), params(TOKEN))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body.participant).toEqual({
      email: "doc@example.com",
      surveys: ["DLC", "PVH"],
      name: "Rajesh Kumar",
      hospital: "",
      city: "Chennai",
      submitted: false,
    })
    expect(JSON.stringify(body)).not.toContain(HASH)
    expect(h.calls).toContainEqual({ method: "eq", args: ["token_hash", HASH] })
  })

  it("refuses when rate limited", async () => {
    h.rateLimitAllowed = false
    const res = await getParticipant(req(`https://membership.amasi.org/api/survey/${TOKEN}`), params(TOKEN))
    expect(res.status).toBe(429)
  })
})

describe("POST /api/survey/[token]", () => {
  const post = (origin: string | null, body: unknown) =>
    postParticipant(
      req(`https://membership.amasi.org/api/survey/${TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
      }),
      params(TOKEN)
    )

  it("refuses a cross-site or origin-less post", async () => {
    expect((await post("https://evil.example", { name: "A", hospital: "H", city: "C" })).status).toBe(403)
    expect((await post(null, { name: "A", hospital: "H", city: "C" })).status).toBe(403)
    expect(h.calls.find((c) => c.method === "update")).toBeUndefined()
  })

  it("saves only the three fields on the hashed row", async () => {
    const res = await post("https://membership.amasi.org", { name: "A", hospital: "H", city: "C", email: "x@y.z", surveys: ["X"] })
    expect(res.status).toBe(200)
    const update = h.calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>
    expect(Object.keys(update).sort()).toEqual(["city", "hospital", "name", "submitted_at", "updated_at"])
    expect(h.calls).toContainEqual({ method: "eq", args: ["token_hash", HASH] })
  })

  it("rejects a missing field", async () => {
    const res = await post("https://membership.amasi.org", { name: "A", city: "C" })
    expect(res.status).toBe(400)
  })

  it("reports an unknown link instead of a silent success", async () => {
    h.updateResult = { data: [], error: null }
    const res = await post("https://membership.amasi.org", { name: "A", hospital: "H", city: "C" })
    expect(res.status).toBe(404)
  })
})

describe("GET /api/admin/survey", () => {
  it("requires an admin session", async () => {
    h.session = null
    const res = await getAdmin(req("https://membership.amasi.org/api/admin/survey"))
    expect(res.status).toBe(401)
  })

  it("lists participants with and without details, filtered by status", async () => {
    h.rows = [
      { ...ROW, email: "a@x.in", hospital: "Apollo" },
      { ...ROW, email: "b@x.in" },
    ]
    const all = await (await getAdmin(req("https://membership.amasi.org/api/admin/survey"))).json()
    expect(all.rows).toHaveLength(2)
    const without = await (await getAdmin(req("https://membership.amasi.org/api/admin/survey?status=without"))).json()
    expect(without.rows.map((r: { email: string }) => r.email)).toEqual(["b@x.in"])
    expect(JSON.stringify(all)).not.toContain(HASH)
  })

  it("filters by survey and rejects unknown filters", async () => {
    await getAdmin(req("https://membership.amasi.org/api/admin/survey?survey=PVH"))
    expect(h.calls).toContainEqual({ method: "contains", args: ["surveys", ["PVH"]] })
    expect((await getAdmin(req("https://membership.amasi.org/api/admin/survey?survey=XYZ"))).status).toBe(400)
    expect((await getAdmin(req("https://membership.amasi.org/api/admin/survey?survey=constructor"))).status).toBe(400)
    expect((await getAdmin(req("https://membership.amasi.org/api/admin/survey?status=maybe"))).status).toBe(400)
  })

  it("downloads a CSV", async () => {
    const res = await getAdmin(req("https://membership.amasi.org/api/admin/survey?format=csv&survey=DLC&status=with"))
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(res.headers.get("content-disposition")).toContain("survey-participants-DLC-with-details.csv")
  })
})

describe("scrub-survey-token", () => {
  it("removes link tokens from URLs and Sentry events", () => {
    expect(scrubSurveyToken(`https://membership.amasi.org/survey/${TOKEN}?x=1`)).toBe("https://membership.amasi.org/survey/[token]?x=1")
    expect(scrubSurveyToken(`/api/survey/${TOKEN}`)).toBe("/api/survey/[token]")
    const event = { request: { url: `https://m.test/api/survey/${TOKEN}` }, breadcrumbs: [{ data: { url: `/survey/${TOKEN}` } }] }
    expect(JSON.stringify(scrubSurveyTokenFromEvent(event))).not.toContain(TOKEN)
    const plain = { message: "nothing here" }
    expect(scrubSurveyTokenFromEvent(plain)).toBe(plain)
  })
})
