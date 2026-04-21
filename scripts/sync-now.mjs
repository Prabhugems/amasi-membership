import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => {
  const re = new RegExp(k + "=[\"']?([^\"'\\n]+)");
  const m = env.match(re);
  return m?.[1]?.trim();
};

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const OLD_API = "https://application.amasi.org/api/member_detail_data";

// Get current max
const { data: maxRow } = await supabase.from("members").select("amasi_number").order("amasi_number", { ascending: false }).limit(1).single();
const currentMax = maxRow?.amasi_number || 0;
console.log("Current max AMASI#:", currentMax);

const { count } = await supabase.from("members").select("*", { count: "exact", head: true });
console.log("Total members:", count);

// Sync from currentMax+1 up to currentMax+500 (bigger range to cover gaps)
let imported = 0;
let consecutiveNotFound = 0;
const maxRange = 500;

for (let num = currentMax + 1; num <= currentMax + maxRange; num++) {
  if (consecutiveNotFound >= 20) {
    console.log(`Stopping: 20 consecutive misses at #${num}`);
    break;
  }

  try {
    const formData = new FormData();
    formData.append("membership_no", String(num));
    const res = await fetch(OLD_API, { method: "POST", body: formData });

    if (!res.ok) { consecutiveNotFound++; continue; }
    const data = await res.json();
    if (!data.status || !data.data?.length) { consecutiveNotFound++; continue; }

    consecutiveNotFound = 0;
    const d = data.data[0];

    // Check if already exists
    const { data: existing } = await supabase.from("members").select("amasi_number").eq("amasi_number", num).maybeSingle();
    if (existing) { console.log(`#${num} already exists, skip`); continue; }

    const appName = d.application_name || "";
    let membershipType = appName;
    if (appName.includes("[")) {
      const match = appName.match(/\[(\w+)\]/);
      if (match) membershipType = match[1];
    }

    const name = [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(" ").trim();
    const record = {
      amasi_number: num,
      name: name || "Unknown",
      email: d.email || `member${num}@amasi.org`,
      phone: String(d.mobile || ""),
      status: "active",
      membership_type: membershipType,
      salutation: d.salutation || "Dr.",
      mobile_code: d.mobile_code || "+91",
      application_no: d.application_no || null,
      father_name: d.father_name || null,
      nationality: d.nationality || "Indian",
      street_address_1: d.street_line1 || null,
      city: d.city || null,
      state: d.state_name || d.state || null,
      country: d.country_name || "India",
      postal_code: d.pin || null,
      zone: d.zone || null,
      pg_degree: d.edu_postgrad_degree || null,
      pg_college: d.edu_postgrad_college || null,
      pg_university: d.edu_postgrad_university || null,
      mci_council_number: d.mci_council_number || null,
      mci_council_state: d.mci_council_state_name || d.mci_council_state || null,
      asi_membership_no: d.asi_membership_no || null,
      profile_photo: d.profile || null,
      gender: d.gender || null,
      date_of_birth: (d.dob && d.dob !== "0000-00-00") ? d.dob : null,
    };

    // Remove null values
    for (const [k, v] of Object.entries(record)) {
      if (v === null || v === "" || v === "NULL") delete record[k];
    }
    record.amasi_number = num;
    record.name = name || "Unknown";
    record.email = d.email || `member${num}@amasi.org`;
    record.status = "active";

    const { error } = await supabase.from("members").insert(record);
    if (error) {
      console.error(`#${num} FAILED:`, error.message);
    } else {
      imported++;
      console.log(`#${num} ✓ ${name} (${d.email || "no email"}) [${membershipType}]`);
    }
  } catch (err) {
    consecutiveNotFound++;
    console.error(`#${num} error:`, err.message);
  }
}

console.log(`\nDone! Imported ${imported} new members (checked ${currentMax + 1} to ${currentMax + maxRange})`);

// Verify 18235 now
const { data: check } = await supabase.from("members").select("amasi_number, name, email").eq("amasi_number", 18235).maybeSingle();
console.log("Member 18235:", check ? JSON.stringify(check) : "STILL NOT FOUND");

// Update sequence
const { data: newMax } = await supabase.from("members").select("amasi_number").order("amasi_number", { ascending: false }).limit(1).single();
console.log("New max AMASI#:", newMax?.amasi_number);
