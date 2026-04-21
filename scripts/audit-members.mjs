import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

// Helper to print a table of samples
function printSamples(rows, extraCols = []) {
  const cols = ["amasi_number", "name", "email", ...extraCols];
  if (rows.length === 0) { console.log("  (none)"); return; }
  const samples = rows.slice(0, 10);
  for (const r of samples) {
    const parts = cols.map(c => `${c}: ${r[c] ?? "(null)"}`);
    console.log("  " + parts.join(" | "));
  }
  if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
}

async function fetchAll(select = "*") {
  let all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from("members").select(select).range(from, from + pageSize - 1);
    if (error) { console.error("Fetch error:", error); break; }
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main() {
  console.log("Fetching all members...");
  const members = await fetchAll("amasi_number,name,email,phone,membership_type,status,date_of_birth");
  console.log(`Total members: ${members.length}\n`);

  const summary = [];

  // 1. Duplicate emails
  console.log("=== 1. DUPLICATE EMAILS ===");
  const emailMap = {};
  for (const m of members) {
    if (!m.email) continue;
    const e = m.email.toLowerCase().trim();
    (emailMap[e] = emailMap[e] || []).push(m);
  }
  const dupEmails = Object.entries(emailMap).filter(([, v]) => v.length > 1);
  console.log(`Count: ${dupEmails.length} duplicate email groups`);
  const dupEmailRows = dupEmails.flatMap(([email, rows]) => rows.map(r => ({ ...r, duplicate_email: email, group_size: rows.length })));
  summary.push({ check: "Duplicate emails", count: `${dupEmails.length} groups (${dupEmailRows.length} members)` });
  printSamples(dupEmailRows, ["duplicate_email", "group_size"]);
  console.log();

  // 2. Invalid emails
  console.log("=== 2. INVALID EMAILS ===");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = members.filter(m => m.email && !emailRegex.test(m.email.trim()));
  console.log(`Count: ${invalidEmails.length}`);
  summary.push({ check: "Invalid emails", count: invalidEmails.length });
  printSamples(invalidEmails);
  console.log();

  // 3. Duplicate phone numbers
  console.log("=== 3. DUPLICATE PHONE NUMBERS ===");
  const phoneMap = {};
  for (const m of members) {
    if (!m.phone) continue;
    const p = String(m.phone).replace(/[\s\-()]/g, "");
    if (!p) continue;
    (phoneMap[p] = phoneMap[p] || []).push(m);
  }
  const dupPhones = Object.entries(phoneMap).filter(([, v]) => v.length > 1);
  console.log(`Count: ${dupPhones.length} duplicate phone groups`);
  const dupPhoneRows = dupPhones.flatMap(([phone, rows]) => rows.map(r => ({ ...r, duplicate_phone: phone, group_size: rows.length })));
  summary.push({ check: "Duplicate phones", count: `${dupPhones.length} groups (${dupPhoneRows.length} members)` });
  printSamples(dupPhoneRows, ["phone", "group_size"]);
  console.log();

  // 4. Members with name "Unknown"
  console.log("=== 4. MEMBERS WITH NAME 'Unknown' ===");
  const unknowns = members.filter(m => m.name && m.name.trim().toLowerCase() === "unknown");
  console.log(`Count: ${unknowns.length} (expected: 44)`);
  summary.push({ check: "Name 'Unknown'", count: unknowns.length });
  printSamples(unknowns);
  console.log();

  // 5. Empty/null critical fields
  console.log("=== 5. EMPTY/NULL CRITICAL FIELDS ===");
  const criticalFields = ["name", "email", "membership_type", "status"];
  for (const field of criticalFields) {
    const missing = members.filter(m => !m[field] || m[field].trim() === "");
    console.log(`  ${field}: ${missing.length} missing`);
    summary.push({ check: `Missing ${field}`, count: missing.length });
    if (missing.length > 0 && missing.length <= 10) printSamples(missing);
  }
  console.log();

  // 6. Invalid membership_type
  console.log("=== 6. INVALID MEMBERSHIP_TYPE ===");
  const validTypes = new Set(["LM", "ALM", "ACM", "ILM"]);
  const invalidTypes = members.filter(m => m.membership_type && !validTypes.has(m.membership_type.trim().toUpperCase()));
  console.log(`Count: ${invalidTypes.length}`);
  summary.push({ check: "Invalid membership_type", count: invalidTypes.length });
  printSamples(invalidTypes, ["membership_type"]);
  // Also show distribution
  const typeDist = {};
  for (const m of members) { const t = m.membership_type || "(null)"; typeDist[t] = (typeDist[t] || 0) + 1; }
  console.log("  Distribution:", JSON.stringify(typeDist));
  console.log();

  // 7. Invalid status
  console.log("=== 7. INVALID STATUS ===");
  const validStatuses = new Set(["active", "inactive"]);
  const invalidStatuses = members.filter(m => m.status && !validStatuses.has(m.status.trim().toLowerCase()));
  console.log(`Count: ${invalidStatuses.length}`);
  summary.push({ check: "Invalid status", count: invalidStatuses.length });
  printSamples(invalidStatuses, ["status"]);
  const statusDist = {};
  for (const m of members) { const s = m.status || "(null)"; statusDist[s] = (statusDist[s] || 0) + 1; }
  console.log("  Distribution:", JSON.stringify(statusDist));
  console.log();

  // 8. Duplicate AMASI numbers
  console.log("=== 8. DUPLICATE AMASI NUMBERS ===");
  const amasiMap = {};
  for (const m of members) {
    if (!m.amasi_number) continue;
    const a = String(m.amasi_number).trim();
    (amasiMap[a] = amasiMap[a] || []).push(m);
  }
  const dupAmasi = Object.entries(amasiMap).filter(([, v]) => v.length > 1);
  console.log(`Count: ${dupAmasi.length} duplicate AMASI number groups`);
  summary.push({ check: "Duplicate AMASI numbers", count: dupAmasi.length });
  if (dupAmasi.length > 0) {
    const dupAmasiRows = dupAmasi.flatMap(([num, rows]) => rows.map(r => ({ ...r, dup_amasi: num })));
    printSamples(dupAmasiRows, ["amasi_number"]);
  }
  console.log();

  // 9. Placeholder emails
  console.log("=== 9. PLACEHOLDER EMAILS ===");
  const placeholderPatterns = [/@amasi\.org/i, /@placeholder/i, /@example\./i, /@test\./i, /noemail/i, /no-email/i, /unknown@/i];
  const placeholders = members.filter(m => {
    if (!m.email) return false;
    return placeholderPatterns.some(p => p.test(m.email));
  });
  console.log(`Count: ${placeholders.length}`);
  summary.push({ check: "Placeholder emails", count: placeholders.length });
  printSamples(placeholders);
  console.log();

  // 10. Invalid dates
  console.log("=== 10. INVALID DATES (date_of_birth) ===");
  const now = new Date();
  const cutoff1920 = new Date("1920-01-01");
  const invalidDates = members.filter(m => {
    if (!m.date_of_birth) return false;
    const d = new Date(m.date_of_birth);
    if (isNaN(d.getTime())) return true;
    if (d > now) return true;
    if (d < cutoff1920) return true;
    return false;
  });
  console.log(`Count: ${invalidDates.length}`);
  summary.push({ check: "Invalid date_of_birth", count: invalidDates.length });
  printSamples(invalidDates, ["date_of_birth"]);
  console.log();

  // Summary
  console.log("========== SUMMARY ==========");
  console.log(`Total members: ${members.length}`);
  console.log("------------------------------");
  for (const s of summary) {
    console.log(`  ${s.check}: ${s.count}`);
  }
  console.log("==============================");
}

main().catch(console.error);
