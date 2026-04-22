import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

const { data: drafts } = await supabase.from("draft_applications").select("id, email");
for (const d of drafts || []) {
  const { data: app } = await supabase.from("membership_applications").select("id").eq("email", d.email).maybeSingle();
  if (app) {
    await supabase.from("draft_applications").delete().eq("id", d.id);
    console.log("Deleted orphan draft:", d.email);
  }
}
console.log("Done");
