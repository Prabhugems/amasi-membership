#!/usr/bin/env node
// Seed skill_courses (FMAS) from the AMASICON Airtable base.
//
// Source: base appzvNGDFoceUXroM, table FMAS (tblytNgOfdvqgRd3L).
// Each row has: Name (e.g. "114 FMAS Course Nagpur"), Place, Convenor Name,
// COURSE VENUE. The leading 1-3 digits of Name encode the course number,
// which matches member_credentials.skill_course_id.
//
// Year is derived after seeding by joining onto member_credentials
// (each credential carries the convocation year).
//
// Usage:
//   node scripts/seed-skill-courses.mjs              # writes
//   node scripts/seed-skill-courses.mjs --dry-run    # logs only

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

// Load .env.local manually — no Next.js runtime in standalone script.
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const DRY_RUN = process.argv.includes("--dry-run")

const AIRTABLE_BASE_ID = "appzvNGDFoceUXroM"
const AIRTABLE_FMAS_TABLE = "tblytNgOfdvqgRd3L"
const AIRTABLE_PAT = process.env.AIRTABLE_PAT

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

function parseCourseNumber(name) {
  if (typeof name !== "string") return null
  const m = name.trim().match(/^(\d{1,4})\b/)
  return m ? parseInt(m[1], 10) : null
}

async function main() {
  console.log(`[seed-skill-courses] starting (dryRun=${DRY_RUN})`)

  const rows = []
  let scanned = 0
  let skippedNoNumber = 0

  for await (const raw of listAllRecords(AIRTABLE_FMAS_TABLE)) {
    scanned++
    const f = raw.fields
    const name = typeof f["Name"] === "string" ? f["Name"] : ""
    const id = parseCourseNumber(name)
    if (id === null) {
      skippedNoNumber++
      continue
    }
    rows.push({
      id,
      credential_type: "FMAS",
      name,
      place: typeof f["Place"] === "string" ? f["Place"] : null,
      convenor: typeof f["Convenor Name"] === "string" ? f["Convenor Name"] : null,
      venue: typeof f["COURSE VENUE"] === "string" ? f["COURSE VENUE"] : null,
      year: null,
    })
  }

  console.log(`[seed-skill-courses] scanned=${scanned} valid=${rows.length} skipped(no#)=${skippedNoNumber}`)

  if (rows.length === 0) {
    console.log("[seed-skill-courses] nothing to write")
    return
  }

  // Backfill year per course from member_credentials. Use the most common year
  // among credentials linked to that course id (handles late awards).
  const ids = rows.map((r) => r.id)
  const yearByCourse = new Map()
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from("member_credentials")
      .select("skill_course_id, year")
      .eq("credential_type", "FMAS")
      .in("skill_course_id", chunk)
    if (error) throw error
    for (const r of data ?? []) {
      const courseId = r.skill_course_id
      const year = r.year
      if (typeof courseId !== "number" || typeof year !== "number") continue
      const counts = yearByCourse.get(courseId) ?? new Map()
      counts.set(year, (counts.get(year) ?? 0) + 1)
      yearByCourse.set(courseId, counts)
    }
  }
  for (const r of rows) {
    const counts = yearByCourse.get(r.id)
    if (!counts || counts.size === 0) continue
    let bestYear = null
    let bestCount = -1
    for (const [year, count] of counts) {
      if (count > bestCount) {
        bestCount = count
        bestYear = year
      }
    }
    r.year = bestYear
  }

  if (DRY_RUN) {
    console.log("[seed-skill-courses] sample rows:")
    for (const r of rows.slice(0, 10)) console.log(" ", r)
    return
  }

  const { error } = await supabase
    .from("skill_courses")
    .upsert(rows, { onConflict: "id,credential_type" })
  if (error) throw error
  console.log(`[seed-skill-courses] upserted ${rows.length} rows`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
