import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { createAdminClient } from "../src/lib/supabase"
import {
  listAllRecords,
  downloadAttachment,
  TABLE_FMASIANS,
  TABLE_SKILL_COURSE,
} from "../src/lib/credentials/airtable"
import {
  parseFmasianRecord,
  parseSkillCourseRecord,
  extractConvocationPlace,
} from "../src/lib/credentials/airtable-parser"
import { upsertCredential, upsertTemplate } from "../src/lib/credentials/queries"

const TEMPLATE_DIR = path.resolve(process.cwd(), "public/certificates/fmas")
const DRY_RUN = process.argv.includes("--dry-run")

async function main() {
  console.log(`[seed-fmas] starting (dryRun=${DRY_RUN})`)
  const db = createAdminClient()

  // 1) Walk all Skill Course records and build a record-id → resolved data map.
  console.log("[seed-fmas] fetching Skill Course records ...")
  const courseById = new Map<string, ReturnType<typeof parseSkillCourseRecord>>()
  let courseCount = 0
  let courseErrors = 0
  for await (const raw of listAllRecords(TABLE_SKILL_COURSE)) {
    try {
      courseById.set(raw.id, parseSkillCourseRecord(raw))
      courseCount++
    } catch (e) {
      courseErrors++
      console.warn(`[seed-fmas]   skill course parse failed for ${raw.id}:`, (e as Error).message)
    }
  }
  console.log(`[seed-fmas] fetched ${courseCount} Skill Course records (${courseErrors} parse errors)`)

  // 2) Pick one canonical course per year (the first one we see with an attachment),
  //    download the template, and upsert credential_templates.
  await mkdir(TEMPLATE_DIR, { recursive: true })
  const templateByYear = new Map<number, ReturnType<typeof parseSkillCourseRecord>>()
  for (const c of courseById.values()) {
    if (c.yearOfFmas !== null && c.fmasCertificateAttachmentUrl && !templateByYear.has(c.yearOfFmas)) {
      templateByYear.set(c.yearOfFmas, c)
    }
  }
  console.log(`[seed-fmas] ${templateByYear.size} unique years with templates`)

  for (const [year, course] of templateByYear) {
    const url = course.fmasCertificateAttachmentUrl!
    const filename = course.fmasCertificateFilename ?? `${year}.jpg`
    const ext = path.extname(filename).toLowerCase() || ".jpg"
    const localFile = `${year}${ext}`
    const localPath = path.join(TEMPLATE_DIR, localFile)
    const publicPath = `/certificates/fmas/${localFile}`
    console.log(`[seed-fmas]   year=${year} downloading ${url.slice(0, 60)}...`)
    if (!DRY_RUN) {
      const buf = await downloadAttachment(url)
      await writeFile(localPath, buf)
      await upsertTemplate(db, {
        credentialType: "FMAS",
        year,
        templatePath: publicPath,
        presidentName: course.presidentName,
        convocationDate: course.convocationDateAndPlace,
        convocationPlace: extractConvocationPlace(course.convocationDateAndPlace),
      })
    }
  }

  // 3) Walk FMASIANS records and upsert one credential row per matched member.
  console.log("[seed-fmas] fetching FMASIANS records ...")
  const memberAmasiSet = await loadAmasiNumbers(db)
  console.log(`[seed-fmas] members table has ${memberAmasiSet.size} amasi_number values`)

  let scanned = 0
  let matched = 0
  const skippedNoAmasi: string[] = []
  const skippedNoYear: string[] = []
  const skippedNotInMembers: number[] = []
  const skippedErrors: string[] = []

  for await (const raw of listAllRecords(TABLE_FMASIANS)) {
    scanned++
    try {
      const f = parseFmasianRecord(raw)
      if (f.amasiNumber === null) {
        skippedNoAmasi.push(f.id)
        continue
      }
      if (f.yearOfConvocation === null) {
        skippedNoYear.push(`${f.id}/${f.amasiNumber}`)
        continue
      }
      if (!memberAmasiSet.has(f.amasiNumber)) {
        skippedNotInMembers.push(f.amasiNumber)
        continue
      }
      const course = f.skillCourseRecordId ? courseById.get(f.skillCourseRecordId) ?? null : null
      if (!DRY_RUN) {
        await upsertCredential(db, {
          amasiNumber: f.amasiNumber,
          credentialType: "FMAS",
          year: f.yearOfConvocation,
          skillCourseId: course?.skillCourseNumber ?? null,
          awardedAt: null,
        })
      }
      matched++
      if (scanned % 500 === 0) console.log(`[seed-fmas]   scanned=${scanned} matched=${matched}`)
    } catch (e) {
      skippedErrors.push(raw.id)
      console.warn(`[seed-fmas]   fmasian parse failed for ${raw.id}:`, (e as Error).message)
    }
  }

  console.log("[seed-fmas] summary:")
  console.log(`  scanned:                 ${scanned}`)
  console.log(`  matched + upserted:      ${matched}`)
  console.log(`  skipped (no AMASI #):    ${skippedNoAmasi.length}`)
  console.log(`  skipped (no year):       ${skippedNoYear.length}`)
  console.log(`  skipped (not a member):  ${skippedNotInMembers.length}`)
  console.log(`  skipped (parse error):   ${skippedErrors.length}`)
  if (skippedNotInMembers.length && skippedNotInMembers.length <= 50) {
    console.log(`    AMASI #s: ${skippedNotInMembers.join(", ")}`)
  }
}

async function loadAmasiNumbers(db: ReturnType<typeof createAdminClient>): Promise<Set<number>> {
  const set = new Set<number>()
  let from = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await db
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

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
