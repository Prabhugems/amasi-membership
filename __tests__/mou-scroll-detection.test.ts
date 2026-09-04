import { describe, it, expect } from "vitest"
import { isScrolledToEnd } from "@/components/mou/mou-scroll-panel"

describe("isScrolledToEnd", () => {
  it("is true when scrollTop + clientHeight reaches scrollHeight exactly", () => {
    expect(isScrolledToEnd({ scrollTop: 800, clientHeight: 200, scrollHeight: 1000 })).toBe(true)
  })

  it("is true within the default threshold (a few px short due to subpixel rendering)", () => {
    expect(isScrolledToEnd({ scrollTop: 796, clientHeight: 200, scrollHeight: 1000 })).toBe(true)
  })

  it("is false when clearly not scrolled to the end", () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 200, scrollHeight: 1000 })).toBe(false)
  })

  it("is true when content is shorter than the panel (nothing to scroll)", () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true)
  })

  it("respects a custom threshold", () => {
    expect(isScrolledToEnd({ scrollTop: 750, clientHeight: 200, scrollHeight: 1000 }, 60)).toBe(true)
    expect(isScrolledToEnd({ scrollTop: 750, clientHeight: 200, scrollHeight: 1000 }, 10)).toBe(false)
  })
})
