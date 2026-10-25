#!/usr/bin/env node
/**
 * Email each survey participant their personal /survey/<token> link (AMASI Survey Consortium, Oct 2026).
 *
 * Input: a CSV with columns email,surveys,token (surveys = DLC, PVH or DLC|PVH; token = the raw link token whose
 * sha256 is in survey_participant_details). The raw tokens exist only in that file and in the emails.
 *
 * Default: DRY RUN (prints who would get what). Flags:
 *   --test=you@example.com   send that address its own row's email only (the row must be in the CSV)
 *   --apply                  send to every row not already in the sent log
 *   --log=path               sent log (default: <csv>.sent.log); rows listed there are skipped
 */
import fs from "node:fs"
import path from "node:path"

const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.startsWith("--") ? a.slice(2).split("=") : ["csv", a])))
const CSV = args.csv
if (!CSV) {
  console.error("usage: node scripts/survey-send.mjs <file.csv> [--test=email | --apply]")
  process.exit(1)
}
const LOG = args.log || `${CSV}.sent.log`
const APPLY = "apply" in args
const TEST_TO = args.test

const env = {}
const envFile = path.join(process.cwd(), ".env.local")
for (const line of fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const RESEND_API_KEY = (process.env.RESEND_API_KEY || env.RESEND_API_KEY || "").trim()
const FROM = (process.env.SURVEY_FROM || "AMASI Survey Consortium <noreply@amasi.org>").trim()
const REPLY_TO = (process.env.SURVEY_REPLY_TO || "").trim()
const APP_URL = "https://membership.amasi.org"
// Keep in step with SURVEY_NAMES in src/lib/survey.ts.
const SURVEY_NAMES = {
  DLC: "AMASI Difficult Cholecystectomy Survey",
  PVH: "AMASI Primary Ventral Hernia Survey",
}

const rows = fs
  .readFileSync(CSV, "utf8")
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((l) => {
    const [email, surveys, token] = l.split(",").map((s) => s.trim())
    return { email: email.toLowerCase(), surveys: surveys.split("|"), token }
  })
for (const r of rows) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(r.token) || !r.email.includes("@") || r.surveys.some((s) => !SURVEY_NAMES[s])) {
    console.error("bad row:", r.email)
    process.exit(1)
  }
}
const sent = new Set(fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean) : [])

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

function message(r) {
  const names = r.surveys.map((s) => SURVEY_NAMES[s])
  const surveyText = names.join(" and the ")
  const link = `${APP_URL}/survey/${r.token}`
  const subject = `${names.length > 1 ? "AMASI Surveys" : names[0]}: your details for the manuscript`
  const text = [
    "Dear Doctor,",
    "",
    `Thank you for participating in the ${surveyText}. Your email is on record as a participant in the survey, which will be published in a reputed journal shortly.`,
    "",
    "Kindly provide your name, place of work (hospital name) and city so that we can include you as a participant in the manuscript:",
    link,
    "",
    "Regards",
    "AMASI Survey Consortium",
  ].join("\n")
  const html = `<p>Dear Doctor,</p>
<p>Thank you for participating in the ${esc(surveyText)}. Your email is on record as a participant in the survey, which will be published in a reputed journal shortly.</p>
<p>Kindly provide your name, place of work (hospital name) and city so that we can include you as a participant in the manuscript.</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">Fill in my details</a></p>
<p style="color:#555;font-size:13px">Or open this link: ${esc(link)}<br>This link is personal to you; please do not forward it.</p>
<p>Regards<br>AMASI Survey Consortium</p>`
  return { from: FROM, to: [r.email], subject, text, html, ...(REPLY_TO && { reply_to: REPLY_TO }) }
}

async function sendBatch(messages) {
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body)}`)
  return body
}

const pending = rows.filter((r) => !sent.has(r.email))
console.log(`${rows.length} rows, ${rows.length - pending.length} already sent, ${pending.length} to send`)

if (TEST_TO) {
  // Only the tester's own row: never hand a real participant's working link to someone else.
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY missing")
  const own = rows.find((r) => r.email === TEST_TO.toLowerCase())
  if (!own) throw new Error(`${TEST_TO} is not a row in ${CSV}; add a test row for it first`)
  const m = message(own)
  await sendBatch([{ ...m, subject: `[TEST] ${m.subject}` }])
  if (!sent.has(own.email)) fs.appendFileSync(LOG, own.email + "\n")
  console.log(`test sent to ${TEST_TO}`)
} else if (!APPLY) {
  for (const r of pending.slice(0, 5)) console.log(`would send to ${r.email}: ${message(r).subject}`)
  if (pending.length > 5) console.log(`... and ${pending.length - 5} more. Pass --apply to send.`)
} else {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY missing")
  for (let i = 0; i < pending.length; i += 50) {
    const chunk = pending.slice(i, i + 50)
    await sendBatch(chunk.map(message))
    fs.appendFileSync(LOG, chunk.map((r) => r.email).join("\n") + "\n")
    console.log(`sent ${i + chunk.length}/${pending.length}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.log(`done. Sent log: ${LOG}`)
}
