import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const sql = readFileSync(join(process.cwd(), "sql/040_mou_application_framework.sql"), "utf-8")

describe("sql/040_mou_application_framework.sql", () => {
  it("only uses additive ALTER TABLE (add column if not exists)", () => {
    const alterLines = sql.split("\n").filter((l) => /^\s*(alter table|add column|drop column)/i.test(l.trim()))
    for (const line of alterLines) {
      if (/drop column|drop table|alter column.*type/i.test(line)) {
        throw new Error(`Non-additive migration statement found: ${line}`)
      }
    }
  })

  it("adds every shared column type_specific_validation.ts and application-form.tsx will need", () => {
    const expectedColumns = [
      "amasi_year_of_joining", "designation", "proposed_registration_fee",
      "programme_outline", "institution_type", "joint_programme",
      "partner_associations", "consent_guest_institution_url",
      "brief_institution_url", "faculty", "agreements", "type_specific_data",
    ]
    for (const col of expectedColumns) {
      expect(sql).toContain(col)
    }
  })

  it("creates mou_signatures with every column the MouSignature interface needs", () => {
    expect(sql).toContain("create table if not exists public.mou_signatures")
    const signatureColumns = [
      "application_id", "mou_version", "mou_sha256", "signatory_name",
      "signatory_email", "signatory_amasi_number", "otp_verified_at",
      "accepted_at", "ip_address", "user_agent", "approved_by", "approved_at",
    ]
    for (const col of signatureColumns) {
      expect(sql).toContain(col)
    }
  })

  it("enables RLS on mou_signatures with no policies (house style)", () => {
    expect(sql).toContain("alter table public.mou_signatures enable row level security")
    expect(sql).not.toMatch(/create policy.*mou_signatures/i)
  })

  it("never touches sql/039's existing tables destructively", () => {
    expect(sql).not.toMatch(/drop table/i)
  })
})
