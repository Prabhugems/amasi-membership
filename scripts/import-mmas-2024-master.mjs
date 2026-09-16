// One-off import: MMAS 2024 (Hyderabad convocation) cohort from the
// Airtable "Master-MMAS" table (base appxRnSu9nbcbKBIX) into
// member_credentials. Mirrors scripts/import-mmas-2025-master.mjs.
//
// Source data quality notes (2026-09-16 import session):
//
// - 96 total Airtable rows. 16 have no AMASI Number at all (not a
//   placeholder like 2025's "1" — genuinely empty) and are excluded;
//   member_credentials.amasi_number is NOT NULL and is part of the PK, so
//   these candidates need a real AMASI number assigned before they can be
//   imported. Names (for follow-up): Jyothsna Karivedu, Vineeth Venkata
//   Damera, Tanmay Pareek, Jyoti Ranjan Swain, Anil Jampani, Balasubramanian
//   Venkitaraman, Dinesh Reddy, Amit Shivajirao Patil, Hazarathaiah
//   Nadendla, Jay Prakash Singh, Kishore Babu, Arun Kumar S L, Joyner,
//   Senthil Kumar Indrajith, Md Manir Hussain Khan, Govind K Purushothaman
//   (a second "Govind K Purushothaman" row DOES have AMASI 14716 under
//   Esophageal Cancer Surgery — likely the same person re-registering with
//   their number; that row is imported, the no-AMASI one is not).
// - No duplicate/conflicting category entries this year (unlike 2025) — a
//   cleaner cohort.
// - Net: 96 - 16 (no AMASI number) = 80 imported.

import { readFileSync } from "node:fs"
import path from "node:path"

const envText = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const DRY_RUN = process.argv.includes("--dry-run")

// skill_courses ids seeded by sql/042_mmas_2024_template_and_courses.sql
const HERNIA = 132
const ESOPHAGEAL = 133
const UPPER_GI = 134

// [amasiNumber, skillCourseId]
const ROWS = [
  [652, HERNIA], [829, HERNIA], [1298, ESOPHAGEAL], [3726, HERNIA], [3934, HERNIA],
  [3959, HERNIA], [4144, HERNIA], [4546, HERNIA], [4828, HERNIA], [4912, HERNIA],
  [5234, ESOPHAGEAL], [5499, HERNIA], [5700, HERNIA], [5965, HERNIA], [6064, HERNIA],
  [6117, UPPER_GI], [7575, HERNIA], [7919, HERNIA], [8175, HERNIA], [8352, HERNIA],
  [8500, HERNIA], [8787, HERNIA], [8959, HERNIA], [9000, HERNIA], [9040, HERNIA],
  [9397, HERNIA], [9417, HERNIA], [9432, ESOPHAGEAL], [9678, HERNIA], [10080, HERNIA],
  [10081, HERNIA], [10185, ESOPHAGEAL], [10200, HERNIA], [10280, HERNIA], [10483, HERNIA],
  [10572, HERNIA], [10897, HERNIA], [10996, HERNIA], [10998, UPPER_GI], [11699, HERNIA],
  [11770, HERNIA], [11772, HERNIA], [11841, HERNIA], [12540, HERNIA], [12543, HERNIA],
  [12550, UPPER_GI], [12892, UPPER_GI], [12955, HERNIA], [13812, HERNIA], [13877, UPPER_GI],
  [13889, HERNIA], [13899, HERNIA], [14011, HERNIA], [14130, HERNIA], [14154, HERNIA],
  [14183, HERNIA], [14196, HERNIA], [14215, HERNIA], [14219, HERNIA], [14224, HERNIA],
  [14225, HERNIA], [14226, HERNIA], [14233, HERNIA], [14236, HERNIA], [14242, HERNIA],
  [14253, HERNIA], [14255, HERNIA], [14264, HERNIA], [14267, HERNIA], [14269, HERNIA],
  [14270, HERNIA], [14274, HERNIA], [14282, HERNIA], [14289, HERNIA], [14290, HERNIA],
  [14300, HERNIA], [14463, UPPER_GI], [14638, HERNIA], [14716, ESOPHAGEAL], [14846, HERNIA],
]

async function main() {
  console.log(`[import-mmas-2024] ${ROWS.length} rows to upsert${DRY_RUN ? " (dry run)" : ""}`)
  if (DRY_RUN) {
    console.log(ROWS.slice(0, 5), "...")
    return
  }

  const { createAdminClient } = await import("../src/lib/supabase.ts")
  const db = createAdminClient()

  const { error } = await db.from("member_credentials").upsert(
    ROWS.map(([amasiNumber, skillCourseId]) => ({
      amasi_number: amasiNumber,
      credential_type: "MMAS",
      year: 2024,
      skill_course_id: skillCourseId,
      awarded_at: "2024-08-15",
    })),
    { onConflict: "amasi_number,credential_type,year" }
  )
  if (error) throw error

  console.log(`[import-mmas-2024] DONE — upserted ${ROWS.length} MMAS 2024 credentials`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
