import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load env
const envFile = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => {
  const re = new RegExp(k + '=["\']?([^"\'\\n]+)');
  const m = envFile.match(re);
  return m?.[1]?.trim();
};

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

// Parse MySQL INSERT VALUES into JS objects
// tbl_member columns (from CREATE TABLE):
const COLUMNS = [
  "id", "application_id", "application_no", "application_no_without_letter", "membership_no",
  "first_name", "last_name", "middle_name", "email", "mobile_code", "mobile",
  "password", "pass", "father_name", "dob", "age", "nationality", "zone", "gender",
  "street_line1", "street_line2", "country", "state", "city", "pin",
  "landline", "stdcode", "mailing_address",
  "edu_undergrad_degree", "edu_undergrad_college", "edu_undergrad_university", "edu_undergrad_year",
  "edu_postgrad_degree", "edu_postgrad_college", "edu_postgrad_university", "edu_postgrad_year",
  "edu_superspecialty_degree", "edu_superspecialty_college", "edu_superspecialty_university", "edu_superspecialty_year",
  "mci_council_number", "mci_council_state", "imr_reg_no", "asi_membership_no", "asi_state",
  "other_inter_organisation", "other_inter_organisation_value",
  "mci_certificate", "pg_degree_certificate", "asi_member_certificate",
  "active_license", "letter_hod", "mbbs_degree_certificate", "profile",
  "member_reg_date", "joining_date", "doc_status", "application_status",
  "otp", "otp_verify", "otp_time", "status", "last_login",
  "created_on", "updated_on", "register_by", "login_by", "device_id", "salutation", "Razorpay_orderID"
];

function parseValue(v) {
  if (v === "NULL" || v === undefined) return null;
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const num = Number(v);
  return isNaN(num) ? v : num;
}

// Parse a single INSERT statement's VALUES into rows
function parseInsertValues(line) {
  // Remove "INSERT INTO `tbl_member` VALUES " prefix and trailing ";"
  const valuesStr = line.replace(/^INSERT INTO `tbl_member` VALUES /, "").replace(/;$/, "");

  const rows = [];
  let i = 0;

  while (i < valuesStr.length) {
    // Find start of row
    if (valuesStr[i] !== "(") { i++; continue; }
    i++; // skip '('

    const values = [];
    let current = "";
    let inString = false;
    let escaped = false;
    let depth = 0;

    while (i < valuesStr.length) {
      const ch = valuesStr[i];

      if (escaped) {
        current += ch;
        escaped = false;
        i++;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        current += ch;
        i++;
        continue;
      }

      if (ch === "'" && !inString) {
        inString = true;
        current += ch;
        i++;
        continue;
      }

      if (ch === "'" && inString) {
        inString = false;
        current += ch;
        i++;
        continue;
      }

      if (inString) {
        current += ch;
        i++;
        continue;
      }

      if (ch === "," && depth === 0) {
        values.push(parseValue(current.trim()));
        current = "";
        i++;
        continue;
      }

      if (ch === ")") {
        values.push(parseValue(current.trim()));
        i++; // skip ')'
        break;
      }

      current += ch;
      i++;
    }

    if (values.length >= COLUMNS.length - 2) { // some rows may have fewer cols
      const row = {};
      for (let j = 0; j < Math.min(values.length, COLUMNS.length); j++) {
        row[COLUMNS[j]] = values[j];
      }
      rows.push(row);
    }
  }

  return rows;
}

// Map old system state IDs to state names
const STATE_MAP = {
  "4001": "Andhra Pradesh", "4002": "Arunachal Pradesh", "4003": "Assam",
  "4004": "Bihar", "4005": "Chhattisgarh", "4006": "Goa", "4007": "Gujarat",
  "4008": "Maharashtra", "4009": "Manipur", "4010": "Meghalaya",
  "4011": "Mizoram", "4012": "Nagaland", "4013": "Odisha", "4014": "Punjab",
  "4015": "Rajasthan", "4016": "Sikkim", "4017": "Telangana",
  "4018": "Tripura", "4019": "Uttar Pradesh", "4020": "Uttarakhand",
  "4021": "West Bengal", "4022": "Delhi", "4023": "Haryana",
  "4024": "Himachal Pradesh", "4025": "Jammu & Kashmir", "4026": "Jharkhand",
  "4027": "Karnataka", "4028": "Kerala", "4029": "Madhya Pradesh",
  "4030": "Tamil Nadu", "4031": "Chandigarh", "4032": "Puducherry",
  "4033": "Ladakh",
};

function getStateName(stateVal) {
  if (!stateVal) return null;
  const s = String(stateVal);
  if (STATE_MAP[s]) return STATE_MAP[s];
  // If it's already a name, return as-is
  if (s.length > 4) return s;
  return null;
}

// Convert old member row to our Supabase schema
function toSupabaseRecord(row) {
  if (!row.membership_no || row.membership_no === 0) return null; // skip members without AMASI number

  const name = [row.first_name, row.middle_name, row.last_name].filter(v => v && v !== "NULL" && v !== "").join(" ").trim();

  // Determine membership type from application_no prefix
  let membershipType = "LM";
  const appNo = row.application_no || "";
  if (appNo.startsWith("AL")) membershipType = "ALM";
  else if (appNo.startsWith("AC")) membershipType = "ACM";
  else if (appNo.startsWith("IL")) membershipType = "ILM";
  else if (appNo.startsWith("L")) membershipType = "LM";

  const record = {
    amasi_number: row.membership_no,
    name: name || "Unknown",
    email: row.email || `member${row.membership_no}@amasi.org`,
    phone: row.mobile ? String(row.mobile) : null,
    status: row.status === 1 ? "active" : "inactive",
    membership_type: membershipType,
    salutation: row.salutation || "Dr.",
    mobile_code: row.mobile_code || "+91",
    application_no: row.application_no || null,
    father_name: row.father_name || null,
    nationality: row.nationality || "Indian",
    street_address_1: row.street_line1 || null,
    street_address_2: row.street_line2 || null,
    city: row.city || null,
    state: getStateName(row.state) || getStateName(row.mci_council_state) || null,
    country: row.country ? (String(row.country).length <= 4 ? "India" : String(row.country)) : "India",
    postal_code: row.pin || null,
    zone: row.zone || null,
    gender: row.gender || null,
    date_of_birth: (row.dob && row.dob !== "0000-00-00") ? row.dob : null,
    // ug_degree/college/university/year columns don't exist in members table — skip them
    pg_degree: row.edu_postgrad_degree || null,
    pg_college: row.edu_postgrad_college || null,
    pg_university: row.edu_postgrad_university || null,
    pg_year: row.edu_postgrad_year || null,
    mci_council_number: row.mci_council_number || null,
    mci_council_state: getStateName(row.mci_council_state) || null,
    asi_membership_no: row.asi_membership_no || null,
    profile_photo: row.profile || null,
    mci_certificate: row.mci_certificate || null,
    pg_degree_certificate: row.pg_degree_certificate || null,
    mbbs_degree_certificate: row.mbbs_degree_certificate || null,
    asi_member_certificate: row.asi_member_certificate || null,
    active_license: row.active_license || null,
    letter_hod: row.letter_hod || null,
  };

  if (row.joining_date && row.joining_date !== "0000-00-00") record.joining_date = row.joining_date;
  if (row.member_reg_date && !String(row.member_reg_date).includes("0000")) record.application_date = row.member_reg_date;

  // Remove null/empty values
  for (const [k, v] of Object.entries(record)) {
    if (v === null || v === "" || v === "NULL" || v === "0000-00-00") delete record[k];
  }
  // Re-add required fields
  record.amasi_number = row.membership_no;
  record.name = name || "Unknown";
  record.email = row.email || `member${row.membership_no}@amasi.org`;
  record.status = row.status === 1 ? "active" : "inactive";

  return record;
}

// Main
async function main() {
  console.log("Reading SQL dump...");
  const sql = readFileSync("/Users/prabhubalasubramaniam/Downloads/WhatsApp Dump Apr 21 2026.sql", "utf8");

  // Extract all INSERT INTO tbl_member lines
  const insertLines = sql.split("\n").filter(l => l.startsWith("INSERT INTO `tbl_member` VALUES"));
  console.log(`Found ${insertLines.length} INSERT statements`);

  // Parse all rows
  let allRows = [];
  for (const line of insertLines) {
    const rows = parseInsertValues(line);
    allRows.push(...rows);
  }
  console.log(`Parsed ${allRows.length} total rows from dump`);

  // Filter to only members with AMASI numbers
  const membersWithNumbers = allRows.filter(r => r.membership_no && r.membership_no > 0);
  console.log(`Members with AMASI numbers: ${membersWithNumbers.length}`);

  // Get existing AMASI numbers from our DB
  console.log("Fetching existing members from Supabase...");
  const existingNumbers = new Set();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase.from("members").select("amasi_number").range(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    for (const r of data) existingNumbers.add(r.amasi_number);
    offset += data.length;
    if (data.length < pageSize) break;
  }
  console.log(`Existing members in Supabase: ${existingNumbers.size}`);

  // Find new members
  const newMembers = membersWithNumbers.filter(r => !existingNumbers.has(r.membership_no));
  console.log(`New members to import: ${newMembers.length}`);

  if (newMembers.length === 0) {
    console.log("Nothing to import!");
    return;
  }

  // Convert to Supabase records
  const records = newMembers.map(toSupabaseRecord).filter(Boolean);
  console.log(`Valid records to insert: ${records.length}`);

  // Insert in batches of 100
  let imported = 0;
  let failed = 0;
  const batchSize = 100;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase.from("members").upsert(batch, { onConflict: "amasi_number" });

    if (error) {
      console.error(`Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
      // Try one by one for this batch
      for (const rec of batch) {
        const { error: singleErr } = await supabase.from("members").upsert(rec, { onConflict: "amasi_number" });
        if (singleErr) {
          console.error(`  #${rec.amasi_number} FAILED: ${singleErr.message}`);
          failed++;
        } else {
          imported++;
        }
      }
    } else {
      imported += batch.length;
    }

    if ((i + batchSize) % 500 === 0 || i + batchSize >= records.length) {
      console.log(`Progress: ${Math.min(i + batchSize, records.length)}/${records.length} (imported: ${imported}, failed: ${failed})`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Imported: ${imported}`);
  console.log(`Failed: ${failed}`);

  // Verify 18235
  const { data: check } = await supabase.from("members").select("amasi_number, name, email").eq("amasi_number", 18235).maybeSingle();
  console.log(`\nMember 18235: ${check ? `${check.name} (${check.email})` : "NOT FOUND"}`);

  // New totals
  const { count } = await supabase.from("members").select("*", { count: "exact", head: true });
  console.log(`Total members now: ${count}`);

  const { data: newMax } = await supabase.from("members").select("amasi_number").order("amasi_number", { ascending: false }).limit(1).single();
  console.log(`Max AMASI#: ${newMax?.amasi_number}`);
}

main().catch(console.error);
