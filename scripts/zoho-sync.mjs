import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const listKey = "3z182b75ecd10e4ec2630141e948ca189d5eda94234653c0666c907acbcaee053b";

// Get token
const { data: row } = await supabase.from("zoho_tokens").select("*").eq("id", "default").single();
let token = row.access_token;
if (new Date(row.expires_at) < new Date()) {
  const res = await fetch("https://accounts.zoho.in/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: getEnv("ZOHO_CLIENT_ID"), client_secret: getEnv("ZOHO_CLIENT_SECRET"), refresh_token: row.refresh_token }),
  });
  const d = await res.json();
  token = d.access_token;
  await supabase.from("zoho_tokens").update({ access_token: token, expires_at: new Date(Date.now() + d.expires_in * 1000).toISOString() }).eq("id", "default");
  console.log("Token refreshed");
}

// Get members > 17021 with real emails
let allMembers = [];
let offset = 0;
while (true) {
  const { data } = await supabase.from("members").select("amasi_number, name, email, membership_type")
    .gt("amasi_number", 17021).not("email", "like", "noemail-%").order("amasi_number").range(offset, offset + 999);
  if (!data || data.length === 0) break;
  allMembers.push(...data);
  offset += data.length;
  if (data.length < 1000) break;
}
console.log(`Syncing ${allMembers.length} members to Zoho AMASI MEMBERS list...\n`);

let synced = 0, failed = 0, skipped = 0;

for (let i = 0; i < allMembers.length; i++) {
  const m = allMembers[i];
  const nameParts = m.name.split(" ");
  const firstName = nameParts[0] || "Member";
  const lastName = nameParts.slice(1).join(" ") || "";

  try {
    const res = await fetch("https://campaigns.zoho.in/api/v1.1/json/listsubscribe", {
      method: "POST",
      headers: { "Authorization": "Zoho-oauthtoken " + token, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        resfmt: "JSON",
        listkey: listKey,
        contactinfo: JSON.stringify({
          "Contact Email": m.email,
          "First Name": firstName,
          "Last Name": lastName,
        }),
      }),
    });
    const data = await res.json();
    if (data.status === "success" || data.code === "0") {
      synced++;
    } else if (data.code === "2011" || data.message?.includes("already")) {
      skipped++;
    } else {
      failed++;
      if (failed <= 5) console.log(`  #${m.amasi_number} ${m.email}: ${data.message}`);
    }
  } catch (e) {
    failed++;
    if (failed <= 5) console.log(`  #${m.amasi_number} error: ${e.message}`);
  }

  if ((i + 1) % 50 === 0) {
    console.log(`Progress: ${i + 1}/${allMembers.length} (synced: ${synced}, skipped: ${skipped}, failed: ${failed})`);
    // Rate limit: 500/min, add small delay every 50
    await new Promise(r => setTimeout(r, 500));
  }
}

console.log(`\n=== DONE ===`);
console.log(`Synced: ${synced}`);
console.log(`Already existed: ${skipped}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${allMembers.length}`);
