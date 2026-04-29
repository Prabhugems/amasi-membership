/**
 * scripts/test-ocr-prompts.ts
 *
 * Test harness for the OCR prompt + scorer changes in PRs #1 and #2.
 *
 * Two modes:
 *
 *   --mode=real (default)
 *     Calls extractDocument() against real certificate files, validates
 *     the JSON shape returned by Claude Vision. If --score is set, also
 *     calls scoreApplication() with synthesized form data to verify no
 *     spurious low_extraction_confidence blocking reason fires on real
 *     extractions (PR #2 T7 invariant).
 *
 *     Args: <docType>:<filepath>:<expectation> triples.
 *     <expectation> ∈ {"high","medium","low","reject"}.
 *
 *   --mode=canned
 *     Loads JSON fixtures from scripts/fixtures/ (or --fixture-dir=PATH)
 *     and feeds them directly to scoreApplication(). No Claude calls.
 *     Asserts blockingReasons / lowConfidenceDocs / mediumConfidenceDocs
 *     per fixture. Used for PR #2 T1-T6.
 *
 *     Args: fixture filenames OR none to run all fixtures in the dir.
 *
 * Common flags:
 *   --score              In real mode, also call scoreApplication() and
 *                        run T7 invariant checks. Passes supabase=undefined
 *                        so NMC verification is skipped.
 *   --fixture-dir=PATH   Override fixture directory (default: scripts/fixtures).
 *
 * Usage examples:
 *
 *   PR #1 (real cert extraction shape — original PR #1 invocation):
 *     node --env-file=.env.local --import tsx scripts/test-ocr-prompts.ts \
 *       pg_degree_certificate:./test-certs/pg.jpg:high \
 *       mbbs_degree_certificate:./test-certs/mbbs.jpg:high
 *
 *   PR #2 T1-T4 (canned confidence states):
 *     npx tsx scripts/test-ocr-prompts.ts --mode=canned
 *
 *   PR #2 T7 (real cert + scoring no-op):
 *     node --env-file=.env.local --import tsx scripts/test-ocr-prompts.ts --score \
 *       pg_degree_certificate:./test-certs/pg.jpg:high
 *
 * Exit code 0 if all hard checks pass, 1 otherwise.
 */

import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { extractDocument } from "../src/lib/document-extraction"
import { scoreApplication } from "../src/lib/ai-approval"

type Expectation = "high" | "medium" | "low" | "reject"

interface TestCase {
  docType: string
  filepath: string
  expectation: Expectation
}

interface CheckResult {
  name: string
  pass: boolean
  detail: string
  soft?: boolean
}

interface CannedFixture {
  name: string
  description?: string
  uploads: Record<string, {
    status: string
    fileUrl?: string | null
    extracted: Record<string, any>
    message?: string
  }>
  formData: Record<string, any>
  paymentPaid: boolean
  assertions: {
    blockingReasonsIncludes?: string[]
    blockingReasonsExcludes?: string[]
    lowConfidenceDocsCount?: number
    mediumConfidenceDocsCount?: number
    autoApprove?: boolean
  }
}

interface ScriptArgs {
  mode: "real" | "canned"
  score: boolean
  fixtureDir: string
  positional: string[]
}

const PREFIXES = ["Dr.", "Prof.", "Mr.", "Mrs.", "Ms.", "Shri.", "Smt.", "Dr ", "Prof "]
const DEFAULT_FIXTURE_DIR = "scripts/fixtures"

function parseFlags(argv: string[]): ScriptArgs {
  const out: ScriptArgs = {
    mode: "real",
    score: false,
    fixtureDir: DEFAULT_FIXTURE_DIR,
    positional: [],
  }
  for (const arg of argv) {
    if (arg === "--score") {
      out.score = true
    } else if (arg.startsWith("--mode=")) {
      const v = arg.slice("--mode=".length)
      if (v !== "real" && v !== "canned") {
        console.error(`invalid --mode "${v}" — must be "real" or "canned"`)
        process.exit(2)
      }
      out.mode = v
    } else if (arg.startsWith("--fixture-dir=")) {
      out.fixtureDir = arg.slice("--fixture-dir=".length)
    } else if (arg.startsWith("--")) {
      console.error(`unknown flag: ${arg}`)
      process.exit(2)
    } else {
      out.positional.push(arg)
    }
  }
  return out
}

function parseRealCases(args: string[]): TestCase[] {
  if (args.length === 0) {
    console.error("Usage (real mode): tsx scripts/test-ocr-prompts.ts <docType>:<filepath>:<expect> [...]")
    console.error("       <expect> is one of: high | medium | low | reject")
    process.exit(2)
  }
  return args.map((arg, i) => {
    const parts = arg.split(":")
    if (parts.length < 3) {
      console.error(`arg ${i}: expected docType:filepath:expect, got "${arg}"`)
      process.exit(2)
    }
    const expectation = parts[parts.length - 1] as Expectation
    if (!["high", "medium", "low", "reject"].includes(expectation)) {
      console.error(`arg ${i}: invalid expectation "${expectation}"`)
      process.exit(2)
    }
    const filepath = parts.slice(1, -1).join(":")
    return { docType: parts[0], filepath, expectation }
  })
}

function validateValidDoc(
  extracted: Record<string, any>,
  docType: string,
  expectedConfidence: Expectation,
): CheckResult[] {
  const out: CheckResult[] = []

  out.push({
    name: "is_valid_medical_document = true",
    pass: extracted.is_valid_medical_document === true,
    detail: `got: ${JSON.stringify(extracted.is_valid_medical_document)}`,
  })

  const fullName = extracted.full_name
  const fullNameRaw = extracted.full_name_raw
  const nameOk = typeof fullName === "string" && fullName.length > 0
  const rawOk = typeof fullNameRaw === "string" && fullNameRaw.length > 0
  out.push({
    name: "full_name is non-empty string",
    pass: nameOk,
    detail: `got: ${JSON.stringify(fullName)}`,
  })
  out.push({
    name: "full_name_raw is non-empty string (NEW field)",
    pass: rawOk,
    detail: `got: ${JSON.stringify(fullNameRaw)}`,
  })
  if (nameOk && rawOk) {
    const rawHasPrefix = PREFIXES.some(p => fullNameRaw.startsWith(p))
    const nameHasPrefix = PREFIXES.some(p => fullName.startsWith(p))
    const stripWorked = (rawHasPrefix && !nameHasPrefix) || (!rawHasPrefix && fullNameRaw === fullName)
    out.push({
      name: "full_name_raw retains prefix that full_name strips",
      pass: stripWorked,
      detail: `raw=${JSON.stringify(fullNameRaw)}  stripped=${JSON.stringify(fullName)}`,
    })
  }

  const conf = extracted.extraction_confidence
  out.push({
    name: 'extraction_confidence ∈ {"high","medium","low"} (NEW field)',
    pass: conf === "high" || conf === "medium" || conf === "low",
    detail: `got: ${JSON.stringify(conf)}`,
  })
  if (expectedConfidence !== "reject") {
    out.push({
      name: `extraction_confidence matches expected "${expectedConfidence}" (soft)`,
      pass: conf === expectedConfidence,
      detail: `got: ${JSON.stringify(conf)}`,
      soft: true,
    })
  }

  const notes = extracted.extraction_notes
  const notesOk =
    notes === null ||
    notes === undefined ||
    (typeof notes === "string" && notes.length <= 100)
  out.push({
    name: "extraction_notes is null or string ≤ 100 chars (NEW field)",
    pass: notesOk,
    detail: `len=${typeof notes === "string" ? notes.length : "n/a"} val=${JSON.stringify(notes)}`,
  })

  const gender = extracted.gender
  out.push({
    name: 'gender ∈ {"Male","Female",null} (capitalized — downstream depends on this)',
    pass: gender === "Male" || gender === "Female" || gender === null || gender === undefined,
    detail: `got: ${JSON.stringify(gender)}`,
  })

  if (docType === "pg_degree_certificate" || docType === "mbbs_degree_certificate") {
    const drt = extracted.degree_raw_text
    out.push({
      name: "degree_raw_text present (downstream blocked-degree filter reads this)",
      pass: typeof drt === "string" && drt.length > 0,
      detail: `got: ${JSON.stringify(drt)}`,
    })
    const dt = extracted.document_type
    out.push({
      name: 'document_type ∈ {"original","provisional"}',
      pass: dt === "original" || dt === "provisional",
      detail: `got: ${JSON.stringify(dt)}`,
    })
  }

  return out
}

function validateRejectedDoc(extracted: Record<string, any>): CheckResult[] {
  return [
    {
      name: "is_valid_medical_document = false (rejection contract intact)",
      pass: extracted.is_valid_medical_document === false,
      detail: `got: ${JSON.stringify(extracted.is_valid_medical_document)}`,
    },
    {
      name: "rejection_reason present",
      pass: typeof extracted.rejection_reason === "string" && extracted.rejection_reason.length > 0,
      detail: `got: ${JSON.stringify(extracted.rejection_reason)}`,
    },
  ]
}

/** PR #2 T7: feed the extracted data into scoreApplication() with synthesized
 *  form data and assert the new gating fires only when confidence === "low". */
async function validateScoringInvariant(
  tc: TestCase,
  extracted: Record<string, any>,
): Promise<CheckResult[]> {
  const uploads: Record<string, any> = {
    [tc.docType]: {
      status: "extracted",
      fileUrl: tc.filepath,
      extracted,
    },
  }
  const fullName = (extracted.full_name || "").trim()
  const parts = fullName.split(/\s+/).filter(Boolean)
  const formData = {
    firstName: parts[0] || "Test",
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : "Subject",
    eduPostgradDegree: extracted.degree_name || "",
    eduPostgradCollege: extracted.institution_name || "",
    eduPostgradUniversity: extracted.university_name || "",
    eduPostgradYear: extracted.year_of_passing || "",
    mciCouncilNumber: "",
    mciCouncilState: "",
    membershipType: "",
  }
  const result = await scoreApplication(formData, uploads, true, undefined)
  const out: CheckResult[] = []
  const conf = extracted.extraction_confidence

  const hasBlock = result.blockingReasons.includes("low_extraction_confidence")
  const expectedBlock = conf === "low"
  out.push({
    name: 'T7: blockingReasons contains "low_extraction_confidence" IFF confidence === "low"',
    pass: hasBlock === expectedBlock,
    detail: `confidence="${conf}"  hasBlock=${hasBlock}  expected=${expectedBlock}  blockingReasons=${JSON.stringify(result.blockingReasons)}`,
  })

  const lowCount = result.lowConfidenceDocs.length
  const expectedLowCount = conf === "low" ? 1 : 0
  out.push({
    name: "T7: lowConfidenceDocs.length matches expected",
    pass: lowCount === expectedLowCount,
    detail: `confidence="${conf}"  got=${lowCount}  expected=${expectedLowCount}`,
  })

  const medCount = result.mediumConfidenceDocs.length
  const expectedMedCount = conf === "medium" ? 1 : 0
  out.push({
    name: "T7: mediumConfidenceDocs.length matches expected",
    pass: medCount === expectedMedCount,
    detail: `confidence="${conf}"  got=${medCount}  expected=${expectedMedCount}`,
  })

  return out
}

async function runRealTest(
  tc: TestCase,
  alsoScore: boolean,
): Promise<{ hardPassed: number; hardFailed: number; softFailed: number }> {
  const abs = resolve(tc.filepath)
  const bar = "=".repeat(80)
  console.log("\n" + bar)
  console.log(`FILE:    ${abs}`)
  console.log(`DOCTYPE: ${tc.docType}`)
  console.log(`EXPECT:  ${tc.expectation}`)
  console.log(bar)

  const buffer = await readFile(abs)
  const fileName = abs.split("/").pop() || "test"

  const t0 = performance.now()
  const result = await extractDocument({ buffer, fileName, docType: tc.docType })
  const ms = Math.round(performance.now() - t0)

  console.log(`\n→ engine: ${result.engine}, isValid: ${result.isValid}, engineError: ${result.engineError}, ${ms}ms`)
  if (result.rejectionReason) console.log(`→ rejectionReason: ${result.rejectionReason}`)
  console.log("\nExtracted JSON:")
  console.log(JSON.stringify(result.extracted, null, 2))

  const checks =
    tc.expectation === "reject"
      ? validateRejectedDoc(result.extracted)
      : validateValidDoc(result.extracted, tc.docType, tc.expectation)

  if (alsoScore && tc.expectation !== "reject") {
    const scoringChecks = await validateScoringInvariant(tc, result.extracted)
    checks.push(...scoringChecks)
  }

  console.log("\nValidation:")
  let hardPassed = 0, hardFailed = 0, softFailed = 0
  for (const c of checks) {
    const icon = c.pass ? "✓" : "✗"
    const tag = c.soft ? " [soft]" : ""
    console.log(`  ${icon}${tag} ${c.name}`)
    console.log(`       ${c.detail}`)
    if (c.pass) {
      if (!c.soft) hardPassed++
    } else {
      c.soft ? softFailed++ : hardFailed++
    }
  }
  console.log(`\nResult: ${hardPassed} hard passed, ${hardFailed} hard failed, ${softFailed} soft failed`)
  return { hardPassed, hardFailed, softFailed }
}

async function runCannedFixture(fixturePath: string): Promise<{ hardPassed: number; hardFailed: number }> {
  const raw = await readFile(fixturePath, "utf8")
  const fixture: CannedFixture = JSON.parse(raw)
  const bar = "=".repeat(80)
  console.log("\n" + bar)
  console.log(`FIXTURE: ${fixture.name}`)
  if (fixture.description) console.log(`DESC:    ${fixture.description}`)
  console.log(bar)

  const t0 = performance.now()
  const result = await scoreApplication(fixture.formData, fixture.uploads, fixture.paymentPaid, undefined)
  const ms = Math.round(performance.now() - t0)
  console.log(`\n→ autoApprove: ${result.autoApprove}, decision: ${result.decision || "(derived)"}, ${ms}ms`)
  console.log(`→ blockingReasons: ${JSON.stringify(result.blockingReasons)}`)
  console.log(`→ lowConfidenceDocs: ${JSON.stringify(result.lowConfidenceDocs)}`)
  console.log(`→ mediumConfidenceDocs: ${JSON.stringify(result.mediumConfidenceDocs)}`)

  const checks: CheckResult[] = []
  const a = fixture.assertions
  if (a.blockingReasonsIncludes) {
    for (const r of a.blockingReasonsIncludes) {
      checks.push({
        name: `blockingReasons includes "${r}"`,
        pass: result.blockingReasons.includes(r),
        detail: `got: ${JSON.stringify(result.blockingReasons)}`,
      })
    }
  }
  if (a.blockingReasonsExcludes) {
    for (const r of a.blockingReasonsExcludes) {
      checks.push({
        name: `blockingReasons does NOT include "${r}"`,
        pass: !result.blockingReasons.includes(r),
        detail: `got: ${JSON.stringify(result.blockingReasons)}`,
      })
    }
  }
  if (typeof a.lowConfidenceDocsCount === "number") {
    checks.push({
      name: `lowConfidenceDocs.length === ${a.lowConfidenceDocsCount}`,
      pass: result.lowConfidenceDocs.length === a.lowConfidenceDocsCount,
      detail: `got: ${result.lowConfidenceDocs.length}`,
    })
  }
  if (typeof a.mediumConfidenceDocsCount === "number") {
    checks.push({
      name: `mediumConfidenceDocs.length === ${a.mediumConfidenceDocsCount}`,
      pass: result.mediumConfidenceDocs.length === a.mediumConfidenceDocsCount,
      detail: `got: ${result.mediumConfidenceDocs.length}`,
    })
  }
  if (typeof a.autoApprove === "boolean") {
    checks.push({
      name: `autoApprove === ${a.autoApprove}`,
      pass: result.autoApprove === a.autoApprove,
      detail: `got: ${result.autoApprove}`,
    })
  }

  console.log("\nValidation:")
  let hardPassed = 0, hardFailed = 0
  for (const c of checks) {
    const icon = c.pass ? "✓" : "✗"
    console.log(`  ${icon} ${c.name}`)
    console.log(`       ${c.detail}`)
    c.pass ? hardPassed++ : hardFailed++
  }
  console.log(`\nResult: ${hardPassed}/${hardPassed + hardFailed} checks passed`)
  return { hardPassed, hardFailed }
}

async function main() {
  const args = parseFlags(process.argv.slice(2))

  if (args.mode === "canned") {
    let fixturePaths: string[]
    if (args.positional.length > 0) {
      fixturePaths = args.positional.map(name =>
        name.endsWith(".json") ? resolve(args.fixtureDir, name) : resolve(args.fixtureDir, name + ".json")
      )
    } else {
      const all = await readdir(args.fixtureDir)
      fixturePaths = all.filter(n => n.endsWith(".json")).sort().map(n => resolve(args.fixtureDir, n))
    }
    if (fixturePaths.length === 0) {
      console.error(`No fixtures found in ${args.fixtureDir}`)
      process.exit(2)
    }
    let totalHardPassed = 0, totalHardFailed = 0
    for (const p of fixturePaths) {
      try {
        const r = await runCannedFixture(p)
        totalHardPassed += r.hardPassed
        totalHardFailed += r.hardFailed
      } catch (err) {
        console.error(`\n✗ ${p} crashed:`, err)
        totalHardFailed++
      }
    }
    const bar = "=".repeat(80)
    console.log("\n" + bar)
    console.log(`TOTAL (canned): ${totalHardPassed} passed / ${totalHardFailed} failed across ${fixturePaths.length} fixtures`)
    console.log(bar)
    process.exit(totalHardFailed === 0 ? 0 : 1)
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Either:")
    console.error("  node --env-file=.env.local --import tsx scripts/test-ocr-prompts.ts ...")
    console.error("  ANTHROPIC_API_KEY=sk-... npx tsx scripts/test-ocr-prompts.ts ...")
    process.exit(2)
  }

  const cases = parseRealCases(args.positional)
  let totalHardPassed = 0, totalHardFailed = 0, totalSoftFailed = 0
  for (const tc of cases) {
    try {
      const r = await runRealTest(tc, args.score)
      totalHardPassed += r.hardPassed
      totalHardFailed += r.hardFailed
      totalSoftFailed += r.softFailed
    } catch (err) {
      console.error(`\n✗ ${tc.filepath} crashed:`, err)
      totalHardFailed++
    }
  }

  const bar = "=".repeat(80)
  console.log("\n" + bar)
  console.log(`TOTAL (real): ${totalHardPassed} hard passed / ${totalHardFailed} hard failed / ${totalSoftFailed} soft failed across ${cases.length} files`)
  console.log(bar)
  process.exit(totalHardFailed === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
