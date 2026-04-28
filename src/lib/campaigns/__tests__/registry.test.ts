import { describe, it, expect } from "vitest"
import { getTemplate, listTemplates } from "../registry"

describe("template registry", () => {
  it("returns the profile_update_missing_pg_degree template", () => {
    const t = getTemplate("profile_update_missing_pg_degree")
    expect(t.key).toBe("profile_update_missing_pg_degree")
    expect(t.category).toBe("marketing")
    expect(t.targetFields).toEqual(["pg_degree"])
  })

  it("throws for unknown keys", () => {
    expect(() => getTemplate("does_not_exist")).toThrow(/unknown template/i)
  })

  it("lists at least one template", () => {
    expect(listTemplates().length).toBeGreaterThan(0)
  })

  it("subject and html render with a sample member", () => {
    const t = getTemplate("profile_update_missing_pg_degree")
    const sample = {
      id: "m1", amasi_number: 1234, name: "Dr. Test",
      email: "t@example.com", pg_degree: null, profile_photo: null,
      date_of_birth: null, membership_type: "LM", marketing_opt_out_at: null,
    }
    expect(t.subject(sample)).toContain("1234")
    const noToken = t.html(sample, { baseUrl: "https://example.com" })
    expect(noToken).toContain("Dr. Test")
    // Without a token the CTA falls back to the plain /m short-URL
    // (which redirects to /member and prompts OTP at runtime).
    expect(noToken).toContain("example.com/m")
    expect(noToken).not.toContain("?t=")

    // With a token, the CTA includes ?t=<encoded jwt> for one-click sign-in.
    const withToken = t.html(sample, { baseUrl: "https://example.com", autoLoginToken: "abc.def.ghi" })
    expect(withToken).toContain("example.com/m?t=abc.def.ghi")
    expect(withToken).toContain("expires in 24 hours")
  })
})
