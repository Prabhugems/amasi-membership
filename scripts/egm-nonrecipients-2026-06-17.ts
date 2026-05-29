/**
 * Build a Resend campaign targeting ONLY the members who did NOT receive the
 * EGBM notice that was already sent via Zoho Campaigns ("AMASI EGBM Online
 * 17th June 2026", ~11,732 delivered+bounced).
 *
 * Context (2026-05-29): the notice went out through Zoho to the AMASI MEMBERS
 * list, but our `members` table has ~16,570 valid-email members — ~4,800 of
 * them (mostly legacy members never synced into Zoho) never got it. This
 * script diffs our members against the Zoho recipient CSV and materialises a
 * campaign (template `egm_notice_2026_06_17`) containing only the gap.
 *
 * The CSV is the Zoho campaign recipient export (Delivered + Bounced) — any
 * layout works; we regex-extract every email address from the raw file.
 *
 * Usage:
 *   pnpm tsx scripts/egm-nonrecipients-2026-06-17.ts <zoho-export.csv>            # dry run
 *   pnpm tsx scripts/egm-nonrecipients-2026-06-17.ts <zoho-export.csv> --commit   # create campaign
 *
 * After --commit: open /campaigns in the admin app, find the campaign in the
 * history list, and click "Send next batch" until pending = 0. Do NOT click
 * "Create campaign" for this template in the UI — that re-targets ALL members.
 *
 * Idempotent-ish: re-running with --commit creates a SECOND campaign row. Run
 * the dry run first, eyeball the numbers, then --commit exactly once.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import { config as loadEnv } from "dotenv"

// Load .env.local explicitly (Next.js convention; tsx doesn't auto-load).
loadEnv({ path: path.resolve(process.cwd(), ".env.local") })

import { createAdminClient } from "../src/lib/supabase"
import { getTemplate } from "../src/lib/campaigns/registry"

const TEMPLATE_KEY = "egm_notice_2026_06_17"
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

// Same valid-email predicate the template's buildSegment uses (kept in sync by
// hand — see src/lib/campaigns/templates/egm-notice-2026-06-17.ts).
function isValidMemberEmail(email: string | null): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  if (e.startsWith("noemail-")) return false
  if (e.startsWith("noreply@")) return false
  if (e.startsWith("admin@")) return false
  if (e.startsWith("test@")) return false
  if (e.startsWith("collegeofamasi@")) return false
  if (e.includes("@test.")) return false
  return true
}

interface MemberRow {
  id: string
  email: string
  name: string | null
  amasi_number: number | null
}

async function main() {
  const csvPath = process.argv[2]
  const commit = process.argv.includes("--commit")
  if (!csvPath || csvPath.startsWith("--")) {
    console.error("Usage: pnpm tsx scripts/egm-nonrecipients-2026-06-17.ts <zoho-export.csv> [--commit]")
    process.exit(1)
  }

  // Validate the template exists before touching the DB.
  const template = getTemplate(TEMPLATE_KEY)

  // 1. Parse the Zoho recipient CSV → set of already-emailed addresses.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied CLI arg
  const raw = await readFile(path.resolve(csvPath), "utf8")
  const sent = new Set<string>()
  for (const m of raw.matchAll(EMAIL_RE)) sent.add(m[0].toLowerCase().trim())
  console.log(`Zoho CSV: ${sent.size} distinct email addresses already sent to.`)
  if (sent.size === 0) {
    console.error("No emails found in the CSV — wrong file or unexpected format. Aborting.")
    process.exit(1)
  }

  // 2. Page through all members (Supabase caps at 1000 rows/query).
  const supabase = createAdminClient()
  const members: MemberRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("members")
      .select("id,email,name,amasi_number")
      .order("amasi_number", { ascending: true })
      .range(from, from + PAGE - 1)
      .returns<MemberRow[]>()
    if (error) throw new Error(`members fetch failed at offset ${from}: ${error.message}`)
    if (!data || data.length === 0) break
    members.push(...data)
    if (data.length < PAGE) break
  }
  console.log(`Members table: ${members.length} rows.`)

  // 3. Diff. Non-recipient = valid-email member whose email isn't in the Zoho set.
  const valid = members.filter((m) => isValidMemberEmail(m.email))
  const seenMemberEmails = new Set<string>()
  const nonRecipients: MemberRow[] = []
  let alreadySent = 0
  for (const m of valid) {
    const e = m.email.toLowerCase().trim()
    if (seenMemberEmails.has(e)) continue // de-dupe members sharing an email
    seenMemberEmails.add(e)
    if (sent.has(e)) alreadySent++
    else nonRecipients.push(m)
  }

  // Sanity: how many of the Zoho addresses map to a current member?
  let csvMatchedMember = 0
  for (const e of sent) if (seenMemberEmails.has(e)) csvMatchedMember++

  console.log("")
  console.log("=== DIFF SUMMARY ===")
  console.log(`Valid-email members (distinct):     ${seenMemberEmails.size}`)
  console.log(`  ↳ already in Zoho send:           ${alreadySent}`)
  console.log(`  ↳ NON-recipients (will receive):  ${nonRecipients.length}`)
  console.log(`Zoho addresses matching a member:   ${csvMatchedMember} / ${sent.size}`)
  console.log(`Zoho addresses with no member row:  ${sent.size - csvMatchedMember} (ignored)`)
  console.log("")
  console.log("Sample non-recipients:")
  for (const m of nonRecipients.slice(0, 10)) {
    console.log(`  #${m.amasi_number ?? "?"}  ${m.email}  (${m.name ?? "—"})`)
  }
  console.log("")

  if (!commit) {
    console.log("DRY RUN — no campaign created. Re-run with --commit to materialise.")
    return
  }
  if (nonRecipients.length === 0) {
    console.log("Nothing to send. Exiting.")
    return
  }

  // 4. Create the campaign row + scoped recipients.
  const { data: campaign, error: insErr } = await supabase
    .from("email_campaigns")
    .insert({
      template_key: template.key,
      name: template.name,
      category: template.category,
      target_fields: template.targetFields,
      status: "sending",
      created_by: "script:egm-nonrecipients-2026-06-17",
    })
    .select("id")
    .single<{ id: string }>()
  if (insErr || !campaign) throw new Error(`campaign insert failed: ${insErr?.message ?? "unknown"}`)

  const rows = nonRecipients.map((m) => ({
    campaign_id: campaign.id,
    member_id: m.id,
    email: m.email,
    amasi_number: m.amasi_number,
    name: m.name,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error: recErr } = await supabase
      .from("email_campaign_recipients")
      .upsert(chunk, { onConflict: "campaign_id,member_id", ignoreDuplicates: true })
    if (recErr) throw new Error(`recipient insert failed (chunk ${i}): ${recErr.message}`)
  }

  console.log(`✅ Campaign ${campaign.id} created with ${rows.length} recipients.`)
  console.log("   Open /campaigns and click 'Send next batch' until pending = 0.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
