// One-off import: MMAS 2025 (Jaipur convocation) cohort from the Airtable
// "Master-MMAS" table (base appzvNGDFoceUXroM) into member_credentials.
//
// Source data quality notes (surfaced during the 2026-09-16 import session,
// see conversation/commit history — not re-derivable from the DB alone):
//
// - 148 total Airtable rows. 3 were excluded: "Dr Sagnik Ray", "Amal
//   Francis", "Dr. Sachin Karthick" all carried AMASI Number = 1, which is a
//   placeholder/unset value, not a real assigned number (member_credentials'
//   PK is (amasi_number, credential_type, year) — importing all three under
//   "1" would silently misattribute the credential to whoever actually
//   holds AMASI #1). These 3 need real AMASI numbers before they can be
//   imported; follow up with AMASI office / Airtable owner.
// - 7 AMASI numbers appeared twice or three times with DIFFERENT category
//   links (9136, 9486, 10258, 12703, 14984, 15712, 15981) — apparent
//   category corrections over time. Resolved by keeping the row with the
//   latest Airtable createdTime per AMASI number ("latest wins").
// - Net: 148 - 3 (invalid) - 8 (duplicate/superseded rows) = 137 imported.
//
// This script is a re-runnable record of that import (idempotent via
// ON CONFLICT), not a live Airtable puller — the resolved (amasiNumber,
// skillCourseId) pairs are embedded below. To re-import from a fresh
// Airtable pull, adapt scripts/seed-fmas-master.mjs's pattern instead.

import { readFileSync } from "node:fs"
import path from "node:path"

const envText = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const DRY_RUN = process.argv.includes("--dry-run")

// skill_courses ids seeded by sql/041_mmas_course_name_top_pct.sql
const HERNIA = 128
const HPB = 129
const COLORECTAL = 130
const UPPER_GI_BARIATRIC = 131

// [amasiNumber, skillCourseId] — resolved per the notes above.
const ROWS = [
  [1007, HERNIA], [1498, HPB], [1563, HERNIA], [3062, HERNIA], [3247, HERNIA],
  [3282, HERNIA], [3528, UPPER_GI_BARIATRIC], [3756, HERNIA], [3947, COLORECTAL],
  [3959, COLORECTAL], [4157, HERNIA], [4400, HERNIA], [4479, HPB],
  [4514, UPPER_GI_BARIATRIC], [4569, HPB], [4684, HERNIA], [4974, HPB],
  [5550, HPB], [5556, HPB], [5658, HPB], [5686, HPB], [5791, UPPER_GI_BARIATRIC],
  [5922, HPB], [6131, HPB], [6135, HPB], [6267, HERNIA], [6282, HERNIA],
  [6368, HERNIA], [6471, HPB], [6598, HPB], [6622, HERNIA], [7552, COLORECTAL],
  [7611, COLORECTAL], [8006, COLORECTAL], [8030, HERNIA], [8208, HERNIA],
  [8467, HPB], [8679, HPB], [8756, HPB], [8768, HERNIA], [9136, COLORECTAL],
  [9486, UPPER_GI_BARIATRIC], [9528, COLORECTAL], [9553, COLORECTAL],
  [9663, HERNIA], [9673, HPB], [9823, HPB], [10258, HPB], [10341, HPB],
  [10534, HPB], [10589, HERNIA], [10753, COLORECTAL], [10938, COLORECTAL],
  [11194, HPB], [11328, HPB], [11337, HPB], [11425, UPPER_GI_BARIATRIC],
  [11601, UPPER_GI_BARIATRIC], [11606, COLORECTAL], [11792, UPPER_GI_BARIATRIC],
  [11853, HPB], [12058, HERNIA], [12197, HERNIA], [12340, HPB], [12436, HPB],
  [12585, UPPER_GI_BARIATRIC], [12703, UPPER_GI_BARIATRIC], [12892, HPB],
  [12916, COLORECTAL], [12927, HPB], [12948, UPPER_GI_BARIATRIC],
  [13001, COLORECTAL], [13159, COLORECTAL], [13179, HPB], [13559, HPB],
  [13579, UPPER_GI_BARIATRIC], [13823, HERNIA], [14018, HPB], [14232, HPB],
  [14397, HERNIA], [14522, UPPER_GI_BARIATRIC], [14641, UPPER_GI_BARIATRIC],
  [14695, HPB], [14697, HPB], [14782, HPB], [14866, COLORECTAL], [14930, HPB],
  [14984, COLORECTAL], [14997, COLORECTAL], [15041, COLORECTAL], [15055, HPB],
  [15072, HPB], [15092, HPB], [15106, HPB], [15126, HPB], [15153, HPB],
  [15173, UPPER_GI_BARIATRIC], [15235, HPB], [15236, HPB], [15239, HPB],
  [15442, UPPER_GI_BARIATRIC], [15446, HPB], [15499, HERNIA], [15611, HPB],
  [15612, HPB], [15667, HPB], [15668, HPB], [15669, HPB], [15670, HPB],
  [15675, HPB], [15681, HPB], [15687, HPB], [15688, HPB], [15698, HPB],
  [15712, HPB], [15713, HPB], [15716, HPB], [15722, HPB], [15756, HPB],
  [15858, HPB], [15880, HPB], [15893, HPB], [15898, HPB], [15952, COLORECTAL],
  [15976, HPB], [15981, UPPER_GI_BARIATRIC], [16099, UPPER_GI_BARIATRIC],
  [16144, HERNIA], [16178, HERNIA], [16226, UPPER_GI_BARIATRIC],
  [16364, UPPER_GI_BARIATRIC], [16538, HPB], [16600, UPPER_GI_BARIATRIC],
  [16609, UPPER_GI_BARIATRIC], [16621, UPPER_GI_BARIATRIC], [16670, HERNIA],
  [16671, HPB],
]

async function main() {
  console.log(`[import-mmas-2025] ${ROWS.length} rows to upsert${DRY_RUN ? " (dry run)" : ""}`)
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
      year: 2025,
      skill_course_id: skillCourseId,
      awarded_at: "2025-08-28",
    })),
    { onConflict: "amasi_number,credential_type,year" }
  )
  if (error) throw error

  console.log(`[import-mmas-2025] DONE — upserted ${ROWS.length} MMAS 2025 credentials`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
