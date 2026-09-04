import { describe, it, expect, vi } from "vitest"

const singleMock = vi.fn()
const insertSelectSingleMock = vi.fn()

// Helper to create a chainable query builder
const createQueryBuilder = () => {
  const builder = {
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    single: singleMock,
    maybeSingle: singleMock,
    select: vi.fn().mockReturnThis(),
  }
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: insertSelectSingleMock,
        }),
      }),
      select: vi.fn().mockReturnValue(createQueryBuilder()),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  }),
}))

import { getRoleAssignment, lookupMemberByNumberOrEmail } from "@/lib/mou/supabase-helpers"

describe("getRoleAssignment", () => {
  it("returns null when no assignment row exists", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    const result = await getRoleAssignment("hon_secretary")
    expect(result).toBeNull()
  })

  it("returns the assignment when found", async () => {
    singleMock.mockResolvedValueOnce({
      data: { name: "Dr. Biswarup Bose", email: "dr.biswarupbose@gmail.com", phone: "+919831001112" },
      error: null,
    })
    const result = await getRoleAssignment("hon_secretary")
    expect(result?.name).toBe("Dr. Biswarup Bose")
  })
})

describe("lookupMemberByNumberOrEmail", () => {
  it("returns null when nothing matches", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    const result = await lookupMemberByNumberOrEmail("no-such-member@example.com")
    expect(result).toBeNull()
  })
})
