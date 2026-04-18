import { test, expect } from "@playwright/test"

const BASE = "http://localhost:3000"

test.describe("Middleware auth: protected ticket routes return 401 without auth", () => {
  test("GET /api/tickets/upload returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/tickets/upload`)
    expect(res.status()).toBe(401)
  })

  test("POST /api/tickets/upload returns 401", async ({ request }) => {
    const res = await request.post(`${BASE}/api/tickets/upload`, {
      multipart: {
        file: {
          name: "test.png",
          mimeType: "image/png",
          buffer: Buffer.from("fake-image-data"),
        },
        path: "tickets/test/test.png",
      },
    })
    expect(res.status()).toBe(401)
  })

  test("GET /api/tickets/analytics returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/tickets/analytics`)
    expect(res.status()).toBe(401)
  })

  test("GET /api/tickets/csat is allowed (token-based auth)", async ({ request }) => {
    const res = await request.get(`${BASE}/api/tickets/csat?token=invalid&rating=5`)
    expect(res.status()).not.toBe(401)
  })

  test("GET /api/tickets/[uuid] without session returns 401", async ({ request }) => {
    const fakeUuid = "00000000-0000-0000-0000-000000000000"
    const res = await request.get(`${BASE}/api/tickets/${fakeUuid}`)
    expect(res.status()).toBe(401)
  })

  test("GET /api/tickets/[uuid]?email= does NOT bypass auth", async ({ request }) => {
    const fakeUuid = "00000000-0000-0000-0000-000000000000"
    const res = await request.get(`${BASE}/api/tickets/${fakeUuid}?email=test@example.com`)
    expect(res.status()).toBe(401)
  })

  test("GET /api/tickets/by-number/TKT-* without session returns 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/tickets/by-number/TKT-20260418-XXXX`)
    // Middleware lets it through, handler checks auth — will return 401 after Commit B
    // For now, handler still uses email param, so it returns 404 (no email provided)
    expect([401, 404]).toContain(res.status())
  })
})
