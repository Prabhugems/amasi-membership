// One-shot audit-log catch-up for zone-realign-bylaw-2026-06-06.mjs.
// The original script wrote to a stale column name (`details`) — actual
// schema is `new_data`. Data writes succeeded; only the audit entries need
// to be re-recorded.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

const entries = [
  {
    table: "members",
    entity_type: "member",
    updated: 1549,
    moves: {
      "Uttar Pradesh: North Zone -> Central Zone": 974,
      "Delhi: North Zone -> Central Zone": 377,
      "Rajasthan: West Zone -> North Zone": 106,
      "Madhya Pradesh: West Zone -> Central Zone": 48,
      "Punjab: West Zone -> North Zone": 6,
      "Tamil Nadu: West Zone -> South Zone": 6,
      "Nagaland: South Zone -> East Zone": 6,
      "Jharkhand: South Zone -> East Zone": 5,
      "Sikkim: North Zone -> East Zone": 3,
      "Gujarat: North Zone -> West Zone": 3,
      "Mizoram: South Zone -> East Zone": 2,
      "West Bengal: North Zone -> East Zone": 2,
      "Chhattisgarh: West Zone -> Central Zone": 2,
      "misc one-offs": 9,
    },
  },
  {
    table: "membership_applications",
    entity_type: "membership_application",
    updated: 109,
    moves: {
      "Madhya Pradesh: West Zone -> Central Zone": 49,
      "Delhi: North Zone -> Central Zone": 29,
      "Uttar Pradesh: North Zone -> Central Zone": 27,
      "Chhattisgarh: West Zone -> Central Zone": 2,
      "Tamil Nadu: (null) -> South Zone": 1,
      "West Bengal: West Zone -> East Zone": 1,
    },
  },
];

for (const e of entries) {
  const { error } = await supabase.from("membership_audit_log").insert({
    action: "zone_realign_bylaw_2023",
    entity_type: e.entity_type,
    entity_id: "bulk",
    new_data: {
      script: "scripts/zone-realign-bylaw-2026-06-06.mjs --apply",
      table: e.table,
      updated_rows: e.updated,
      moves: e.moves,
      bylaw_reference: "AMASI By-Laws 2023, Schedule § Zonal Chapters (Central Zone amended 5 Nov 2023 Raipur GBM)",
      ran_at: "2026-06-06",
      driven_by: "src/lib/membership-types.ts STATE_TO_ZONE",
    },
    performed_by: "admin (Prabhu via Claude Code)",
  });
  if (error) console.error(`✗ ${e.table}: ${error.message}`);
  else console.log(`✓ ${e.table} audit row written`);
}
