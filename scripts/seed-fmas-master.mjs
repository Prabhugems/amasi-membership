#!/usr/bin/env node
// Seed member_credentials (FMAS) from the AMASICON "Master-FMAS" Airtable base.
//
// Source: base app7TElm0QUruBlZr, table Master-FMAS (tbl9CuIgSFdoNVk9x).
// Each row has: CONVOCATION NUMBER (e.g. "127AEC1152") and AMASI Number.
// The leading 1-3 digits of CONVOCATION NUMBER encode the course number,
// which matches skill_courses.id / member_credentials.skill_course_id —
// run scripts/seed-skill-courses.mjs against the same base first so those
// course rows exist.
//
// IMPORTANT: AMASICON duplicates the whole "Master-FMAS" Airtable base for
// each year's convocation cycle. AIRTABLE_BASE_ID, YEAR, AWARDED_AT, and
// CONVOCATION_PLACE/PRESIDENT_NAME below must be updated for each new
// convocation cycle — this run (2026) covers Kolkata, 27 Aug 2026, courses
// 118-127. A member not yet in `members` is skipped (reported, not failed);
// re-run after they're registered to pick them up (idempotent upsert).
//
// Also upserts ONE credential_templates row for (FMAS, YEAR). Point
// TEMPLATE_PATH at an image already committed under public/certificates/fmas/
// — this base does not reliably carry a per-course certificate attachment,
// so unlike seed-fmas.ts (the legacy FMASIANS pipeline) this script does not
// download one from Airtable.
//
// Usage:
//   node scripts/seed-fmas-master.mjs              # writes
//   node scripts/seed-fmas-master.mjs --dry-run    # logs only

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

// Load .env.local manually — no Next.js runtime in standalone script.
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const DRY_RUN = process.argv.includes("--dry-run")

const AIRTABLE_BASE_ID = "app7TElm0QUruBlZr"
const AIRTABLE_MASTER_FMAS_TABLE = "tbl9CuIgSFdoNVk9x"
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

const YEAR = 2026
const AWARDED_AT = "2026-08-27"
const CONVOCATION_PLACE = "Kolkata"
const CONVOCATION_DATE = "27th August 2026"
const PRESIDENT_NAME = "Dr. Kalpesh Jani"
const TEMPLATE_PATH = "/certificates/fmas/2026.jpg"

if (!AIRTABLE_PAT) {
  console.error("AIRTABLE_PAT not set in .env.local")
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

async function* listAllRecords(tableId) {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`)
  url.searchParams.set("pageSize", "100")
  url.searchParams.append("fields[]", "CONVOCATION NUMBER")
  url.searchParams.append("fields[]", "AMASI Number")
  let offset
  do {
    if (offset) url.searchParams.set("offset", offset)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
    })
    if (!res.ok) throw new Error(`Airtable ${tableId} ${res.status}: ${await res.text()}`)
    const json = await res.json()
    for (const rec of json.records) yield rec
    offset = json.offset
  } while (offset)
}

function parseCourseNumber(convocationNumber) {
  if (typeof convocationNumber !== "string") return null
  const m = convocationNumber.trim().match(/^(\d{1,4})/)
  return m ? parseInt(m[1], 10) : null
}

async function loadAmasiNumbers() {
  const set = new Set()
  let from = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await supabase
      .from("members")
      .select("amasi_number")
      .not("amasi_number", "is", null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) {
      if (typeof r.amasi_number === "number") set.add(r.amasi_number)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return set
}

async function main() {
  console.log(`[seed-fmas-master] starting (dryRun=${DRY_RUN})`)

  const memberAmasiSet = await loadAmasiNumbers()
  console.log(`[seed-fmas-master] members table has ${memberAmasiSet.size} amasi_number values`)

  const rows = []
  let scanned = 0
  const skippedNoNumber = []
  const skippedNoCourse = []
  const skippedNotInMembers = []

  for await (const raw of listAllRecords(AIRTABLE_MASTER_FMAS_TABLE)) {
    scanned++
    const f = raw.fields
    const amasi = typeof f["AMASI Number"] === "number" ? f["AMASI Number"] : null
    const convocationNumber = typeof f["CONVOCATION NUMBER"] === "string" ? f["CONVOCATION NUMBER"] : null
    if (amasi === null) {
      skippedNoNumber.push(raw.id)
      continue
    }
    const courseId = parseCourseNumber(convocationNumber)
    if (courseId === null) {
      skippedNoCourse.push(`${raw.id}/${amasi}`)
      continue
    }
    if (!memberAmasiSet.has(amasi)) {
      skippedNotInMembers.push(amasi)
      continue
    }
    rows.push({
      amasi_number: amasi,
      credential_type: "FMAS",
      year: YEAR,
      skill_course_id: courseId,
      awarded_at: AWARDED_AT,
    })
  }

  console.log("[seed-fmas-master] summary:")
  console.log(`  scanned:                 ${scanned}`)
  console.log(`  matched:                 ${rows.length}`)
  console.log(`  skipped (no AMASI #):    ${skippedNoNumber.length}`)
  console.log(`  skipped (no course #):   ${skippedNoCourse.length}`)
  console.log(`  skipped (not a member):  ${skippedNotInMembers.length}`)
  if (skippedNotInMembers.length && skippedNotInMembers.length <= 50) {
    console.log(`    AMASI #s: ${skippedNotInMembers.join(", ")}`)
  }

  if (DRY_RUN) {
    console.log("[seed-fmas-master] sample rows:")
    for (const r of rows.slice(0, 10)) console.log(" ", r)
    return
  }

  const CHUNK = 400
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase
      .from("member_credentials")
      .upsert(chunk, { onConflict: "amasi_number,credential_type,year" })
    if (error) throw error
    console.log(`[seed-fmas-master] upserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`)
  }

  const { error: templateError } = await supabase.from("credential_templates").upsert(
    {
      credential_type: "FMAS",
      year: YEAR,
      template_path: TEMPLATE_PATH,
      president_name: PRESIDENT_NAME,
      convocation_date: CONVOCATION_DATE,
      convocation_place: CONVOCATION_PLACE,
    },
    { onConflict: "credential_type,year" },
  )
  if (templateError) throw templateError
  console.log(`[seed-fmas-master] upserted credential_templates row for FMAS ${YEAR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
