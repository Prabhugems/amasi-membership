/**
 * Pull subscriber emails from a Zoho Campaigns mailing list, so we can diff
 * against our members table to find who never got the EGBM notice.
 *
 * This is a best-effort proxy for "who the campaign reached": it reads CURRENT
 * list membership (active + unsubscribed + bounced), which should closely match
 * the campaign's delivered+bounced count if the list hasn't changed much since
 * the send. The script prints the total so you can sanity-check it against the
 * Zoho report (~11,732 = 11,657 delivered + 75 bounced). If it's wildly off,
 * fall back to a manual CSV export instead.
 *
 * Usage:
 *   pnpm tsx scripts/zoho-fetch-list-subscribers.ts                 # list all lists, then fetch default
 *   pnpm tsx scripts/zoho-fetch-list-subscribers.ts <listkey>       # fetch a specific list
 *   pnpm tsx scripts/zoho-fetch-list-subscribers.ts <listkey> <out.csv>
 *
 * Output: one email per line, written to <out.csv> (default ~/Desktop/zoho-egbm-recipients.csv).
 * Feed that file to scripts/egm-nonrecipients-2026-06-17.ts.
 */

import { writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { config as loadEnv } from "dotenv"

loadEnv({ path: path.resolve(process.cwd(), ".env.local") })

import { zohoApi } from "../src/lib/zoho"

// AMASI MEMBERS list (from scripts/zoho-sync.mjs). Override via argv[2].
const DEFAULT_LIST_KEY = "3z182b75ecd10e4ec2630141e948ca189d5eda94234653c0666c907acbcaee053b"
const STATUSES = ["active", "unsub", "bounce"] as const
const RANGE = 100

function extractEmails(payload: unknown, into: Set<string>): number {
  const json = JSON.stringify(payload)
  let n = 0
  for (const m of json.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const e = m[0].toLowerCase().trim()
    if (!into.has(e)) {
      into.add(e)
      n++
    }
  }
  return n
}

async function fetchStatus(listKey: string, status: string, emails: Set<string>) {
  let fromindex = 1
  for (;;) {
    const ep = `/getlistsubscribers?resfmt=JSON&listkey=${encodeURIComponent(listKey)}&status=${status}&sort=asc&fromindex=${fromindex}&range=${RANGE}`
    const res = await zohoApi(ep)
    const details = (res && (res.list_of_details || res.listsubscribers)) as unknown[] | undefined
    const got = Array.isArray(details) ? details.length : 0
    const added = extractEmails(details ?? res, emails)
    process.stdout.write(`  ${status} fromindex=${fromindex}: ${got} rows (+${added} new emails)\n`)
    if (got < RANGE || got === 0) break
    fromindex += RANGE
  }
}

async function main() {
  const listKey = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DEFAULT_LIST_KEY
  const outPath = process.argv[3] || path.join(os.homedir(), "Desktop", "zoho-egbm-recipients.csv")

  // 1. List all mailing lists so we can confirm key + size.
  console.log("Fetching mailing lists…")
  const lists = await zohoApi("/getmailinglists?resfmt=JSON&range=100")
  const arr = (lists && (lists.list_of_details || lists.listinfo)) as Array<Record<string, unknown>> | undefined
  if (Array.isArray(arr)) {
    for (const l of arr) {
      console.log(`  listkey=${l.listkey}  "${l.listname}"  subscribers=${l.noofcontacts ?? l.no_of_contacts ?? "?"}`)
    }
  } else {
    console.log("  (could not parse list response):", JSON.stringify(lists).slice(0, 400))
  }

  // 2. Pull subscribers for the chosen list across statuses.
  console.log(`\nFetching subscribers for list ${listKey} …`)
  const emails = new Set<string>()
  for (const status of STATUSES) {
    try {
      await fetchStatus(listKey, status, emails)
    } catch (e) {
      console.error(`  status=${status} failed:`, e instanceof Error ? e.message : e)
    }
  }

  console.log(`\nTotal distinct emails pulled: ${emails.size}`)
  console.log("(Sanity-check against the Zoho report: ~11,732 = 11,657 delivered + 75 bounced.)")

  await writeFile(outPath, Array.from(emails).join("\n") + "\n", "utf8")
  console.log(`\n✅ Wrote ${emails.size} emails to ${outPath}`)
  console.log("Next: pnpm tsx scripts/egm-nonrecipients-2026-06-17.ts " + outPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
