// One-shot import of paid+unapproved applications from the legacy AMASI app
// into membership_applications as `pending_review`. Source CSV (despite .sql
// filename) is /Users/prabhu/Downloads/member_data-5-4-2026.sql, 12 rows.
//
// Of the 12 rows, 4 are already members in our system (Shivani Verma,
// Taarika Ramesh, Sohini Burman, Swaroop Mallesh) — those are skipped.
// The remaining 8 are inserted with:
//   - status='pending_review', payment_status='paid', payment_id=<order_id>
//   - email_verified=true, mobile_verified=true (legacy otp_verify=1)
//   - documents JSONB with {status:'uploaded', fileUrl} for each non-NULL URL
//   - profile_photo_url set from legacy `profile`
//   - previous_membership_no = legacy app_no (e.g. AL16295) for traceability
//   - manual_review_reason = "Imported from legacy AMASI app — old #<app_no>"
// Idempotent: skips any row whose email already has an application or member.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { randomBytes } from "node:crypto";

const env = readFileSync("/Users/prabhu/amasi-membership/.env.local", "utf8");
const get = (k) => env.match(new RegExp(`${k}=["']?([^"'\\n]+)`))?.[1];
const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

const DRY_RUN = process.argv.includes("--dry-run");
const CSV_PATH = "/Users/prabhu/Downloads/member_data-5-4-2026.sql";

// ----- CSV parser (handles double-quoted fields with embedded commas) -----
function parseCSV(text) {
  const rows = [];
  let i = 0, field = "", row = [], inQ = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = readFileSync(CSV_PATH, "utf8");
const rows = parseCSV(text);
const header = rows[0];
const idx = (col) => header.indexOf(col);
const dataRows = rows.slice(1).filter(r => r.length >= header.length - 2 && r[0]);

console.log(`Parsed ${dataRows.length} rows from CSV`);

// ----- Map legacy application_id → new membership type -----
//   1 → LM   (prefix L)
//   2 → ALM  (prefix AL)
//   4 → ALM  (Birender — user confirmed: PG done, no ASI = ALM, not ACM)
const TYPE_BY_APP_ID = { "1": "LM", "2": "ALM", "4": "ALM" };

const norm = (s) => (s == null || s === "NULL" || s === "") ? null : s;

function buildRecord(r) {
  const get = (col) => norm(r[idx(col)]);

  const appNo = get("application_no");
  const email = get("email")?.toLowerCase();
  const phone = get("mobile");
  const orderId = get("Razorpay_orderID");
  const membershipType = TYPE_BY_APP_ID[get("application_id")] || "ALM";

  const refNumber = `AMASI-${new Date().getFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;

  // Build documents JSONB. Each cert URL becomes {status:'uploaded', fileUrl}.
  // status='uploaded' (not 'extracted') means "file is here but OCR hasn't run"
  // — admin sees it under Pending and can run OCR / approve manually.
  const docs = {};
  const docCols = {
    mci_certificate: get("mci_certificate"),
    pg_degree_certificate: get("pg_degree_certificate"),
    asi_member_certificate: get("asi_member_certificate"),
    active_license: get("active_license"),
    letter_hod: get("letter_hod"),
    mbbs_degree_certificate: get("mbbs_degree_certificate"),
  };
  for (const [k, url] of Object.entries(docCols)) {
    if (url) docs[k] = { status: "uploaded", fileUrl: url, message: "Imported from legacy app" };
  }

  const profileUrl = get("profile");

  return {
    legacyAppNo: appNo,
    email,
    phone,
    orderId,
    payload: {
      reference_number: refNumber,
      // Legacy app_no (AL16295 / L16257 / ...) is non-numeric so it can't go
      // in previous_membership_no (integer). Provenance is preserved in
      // manual_review_reason and ai_flags below.
      salutation: get("salutation") || "Dr.",
      first_name: get("first_name"),
      middle_name: get("middle_name"),
      last_name: get("last_name"),
      name: [get("first_name"), get("middle_name"), get("last_name")].filter(Boolean).join(" "),
      email,
      phone,
      mobile_code: get("mobile_code") || "+91",
      date_of_birth: get("dob"),
      gender: get("gender"),
      father_name: get("father_name"),
      nationality: get("nationality") || "Indian",
      membership_type: membershipType,
      street_address_1: get("street_line1"),
      street_address_2: get("street_line2"),
      city: get("city"),
      // legacy `state` is a numeric code — we don't have the mapping. Leave
      // null; admin sets on review. Zone is already a label and survives.
      state: null,
      country: "India",
      postal_code: get("pin"),
      zone: get("zone"),
      landline: get("landline"),
      std_code: get("stdcode"),
      ug_degree: get("edu_undergrad_degree"),
      ug_college: get("edu_undergrad_college"),
      ug_university: get("edu_undergrad_university"),
      ug_year: get("edu_undergrad_year"),
      pg_degree: get("edu_postgrad_degree"),
      pg_college: get("edu_postgrad_college"),
      pg_university: get("edu_postgrad_university"),
      pg_year: get("edu_postgrad_year"),
      ss_degree: get("edu_superspecialty_degree"),
      ss_college: get("edu_superspecialty_college"),
      ss_university: get("edu_superspecialty_university"),
      ss_year: get("edu_superspecialty_year"),
      mci_council_number: get("mci_council_number"),
      // legacy mci_council_state / asi_state were numeric FKs to a states
      // table we don't have. Null them; admin populates on review.
      mci_council_state: null,
      imr_registration_no: get("imr_reg_no"),
      asi_membership_no: get("asi_membership_no"),
      asi_state: null,
      profile_photo_url: profileUrl,
      payment_status: "paid",
      payment_id: orderId,
      email_verified: true,
      mobile_verified: true,
      ai_verified: false,
      ai_confidence: "legacy_import",
      ai_flags: [`Imported from legacy AMASI app on ${new Date().toISOString().slice(0, 10)} — old #${appNo}`],
      needs_manual_review: true,
      manual_review_reason: `legacy_import: Imported from legacy AMASI app — old #${appNo}. Documents are on legacy S3; admin to verify.`,
      ocr_score: null,
      documents: docs,
      ocr_data: {},
      status: "pending_review",
    },
  };
}

const records = dataRows.map(buildRecord);

// ----- Skip duplicates (already a member or already an application) -----
console.log("\n--- Duplicate check ---");
const toInsert = [];
for (const rec of records) {
  const { data: memberHit } = await supabase
    .from("members")
    .select("amasi_number")
    .or(`email.eq.${rec.email},phone.eq.${rec.phone}`)
    .limit(1)
    .maybeSingle();
  const { data: appHit } = await supabase
    .from("membership_applications")
    .select("reference_number, status")
    .or(`email.eq.${rec.email},phone.eq.${rec.phone}`)
    .limit(1)
    .maybeSingle();
  if (memberHit) {
    console.log(`SKIP ${rec.legacyAppNo} ${rec.email} — already member #${memberHit.amasi_number}`);
    continue;
  }
  if (appHit) {
    console.log(`SKIP ${rec.legacyAppNo} ${rec.email} — already an application: ${appHit.reference_number} (${appHit.status})`);
    continue;
  }
  console.log(`OK   ${rec.legacyAppNo} ${rec.email} → ${rec.payload.membership_type}, ref=${rec.payload.reference_number}`);
  toInsert.push(rec);
}

console.log(`\n${toInsert.length} records to insert (DRY_RUN=${DRY_RUN})`);

if (DRY_RUN) {
  console.log("\nFirst record preview:");
  console.dir(toInsert[0]?.payload, { depth: 4 });
  process.exit(0);
}

// ----- Insert -----
console.log("\n--- Inserting ---");
let ok = 0, fail = 0;
for (const rec of toInsert) {
  const { data, error } = await supabase
    .from("membership_applications")
    .insert(rec.payload)
    .select("id, reference_number, status")
    .single();
  if (error) {
    console.error(`FAIL ${rec.legacyAppNo} ${rec.email}: ${error.message}`);
    fail++;
  } else {
    console.log(`INSERTED ${rec.legacyAppNo} → ${data.reference_number} (${data.status}) id=${data.id}`);
    ok++;
  }
}
console.log(`\nDone. inserted=${ok}, failed=${fail}`);
