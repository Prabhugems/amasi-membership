import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { listTickets, createTicket, replyToTicket, getTicketReplies } from "@/components/member-support/support-api"

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock) })
afterEach(() => { vi.unstubAllGlobals() })

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}

describe("support-api", () => {
  it("listTickets queries by email and returns an array", async () => {
    fetchMock.mockReturnValueOnce(ok([{ id: "1", subject: "x", status: "open" }]))
    const out = await listTickets("a@b.com")
    expect(fetchMock).toHaveBeenCalledWith("/api/tickets?email=a%40b.com")
    expect(out).toHaveLength(1)
  })

  it("listTickets returns [] when the response is not an array", async () => {
    fetchMock.mockReturnValueOnce(ok({ error: "nope" }))
    expect(await listTickets("a@b.com")).toEqual([])
  })

  it("getTicketReplies returns the replies array", async () => {
    fetchMock.mockReturnValueOnce(ok({ replies: [{ id: "r1", message: "hi" }] }))
    expect(await getTicketReplies("t1")).toEqual([{ id: "r1", message: "hi" }])
  })

  it("createTicket posts JSON with member identity", async () => {
    fetchMock.mockReturnValueOnce(ok({ ticket_number: "TKT-1" }))
    const res = await createTicket({
      name: "Dr X", email: "a@b.com", phone: "9", amasi_number: "100",
      category: "Other", subject: "S", description: "D", priority: "normal",
    })
    expect(res.ticket_number).toBe("TKT-1")
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/tickets")
    expect(opts.method).toBe("POST")
    expect(JSON.parse(opts.body).subject).toBe("S")
  })

  it("replyToTicket sends multipart when a file is present", async () => {
    fetchMock.mockReturnValueOnce(ok({ id: "r2", message: "with file" }))
    const file = new File(["x"], "a.png", { type: "image/png" })
    await replyToTicket("t1", { message: "hi", authorName: "Dr X", file })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/tickets/t1/reply")
    expect(opts.method).toBe("POST")
    expect(opts.body instanceof FormData).toBe(true)
  })

  it("replyToTicket sends JSON when no file", async () => {
    fetchMock.mockReturnValueOnce(ok({ id: "r3", message: "hi" }))
    await replyToTicket("t1", { message: "hi", authorName: "Dr X", file: null })
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(opts.body).as_member).toBe(true)
  })
})
