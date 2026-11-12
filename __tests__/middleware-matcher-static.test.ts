import { describe, it, expect } from "vitest"
import { config } from "@/middleware"

// The public membership card (/card) renders /amasi-logo.png. When middleware
// ran on that path it redirected anonymous visitors to /login, the <img>
// failed, and html2canvas rejected — members saw "PDF/PNG generation error".
describe("middleware matcher", () => {
  const re = new RegExp("^" + config.matcher[0] + "$")
  it("does not run on the logo used by the public card", () => {
    expect(re.test("/amasi-logo.png")).toBe(false)
  })
  it("still runs on app routes", () => {
    expect(re.test("/member")).toBe(true)
    expect(re.test("/api/members/search")).toBe(true)
  })
})
