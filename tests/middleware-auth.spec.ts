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
    // Should reach the handler (not 401 from middleware) — handler returns 404 for bad token
    expect(res.status()).not.toBe(401)
  })

  test("GET /api/tickets/[uuid] is allowed for member access", async ({ request }) => {
    const fakeUuid = "00000000-0000-0000-0000-000000000000"
    const res = await request.get(`${BASE}/api/tickets/${fakeUuid}`)
    // Should reach the handler (not 401) — handler returns 404 for non-existent ticket
    expect(res.status()).not.toBe(401)
  })

  test("GET /api/tickets/by-number/TKT-20260418-XXXX is allowed", async ({ request }) => {
    const res = await request.get(`${BASE}/api/tickets/by-number/TKT-20260418-XXXX`)
    // Should reach the handler (not 401)
    expect(res.status()).not.toBe(401)
  })
})
