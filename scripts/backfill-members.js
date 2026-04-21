/**
 * Backfill missing member data from the old AMASI API.
 * Run: export $(grep -E "^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=" .env.local | sed 's/"//g' | xargs) && node scripts/backfill-members.js
 *
 * Fetches members missing key fields (state, zone, pg_degree, etc.)
 * and updates them from application.amasi.org
 */
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OLD_API = 'https://application.amasi.org/api/member_detail_data';
const BATCH = parseInt(process.argv[2]) || 200; // members per run
const OFFSET = parseInt(process.argv[3]) || 0;

async function fetchFromOldAPI(email) {
  const params = new URLSearchParams();
  params.append('email_or_phone', email);
  try {
    const res = await fetch(OLD_API, { method: 'POST', body: params });
    if (!res.ok) return null;
    const data = await res.json();
    return data.status && data.data?.length ? data.data[0] : null;
  } catch { return null; }
}

async function run() {
  // Get members with missing state (biggest gap at 62%)
  const { data: members, error } = await supabase
    .from('members')
    .select('amasi_number, email, name, state, zone, pg_degree, gender, membership_type')
    .is('state', null)
    .not('email', 'like', '%@amasi.org') // skip placeholder emails
    .order('amasi_number', { ascending: false })
    .range(OFFSET, OFFSET + BATCH - 1);

  if (error) { console.error('Fetch error:', error.message); return; }
  console.log(`Backfilling ${members.length} members (offset ${OFFSET}, batch ${BATCH})...`);

  let updated = 0, skipped = 0, failed = 0;

  for (const m of members) {
    const d = await fetchFromOldAPI(m.email);
    if (!d) { skipped++; continue; }

    const updates = {};

    // Only fill fields that are currently empty
    if (!m.state && d.state_name) updates.state = d.state_name;
    if (!m.zone && d.zone) updates.zone = d.zone;
    if (!m.pg_degree && d.edu_postgrad_degree) updates.pg_degree = d.edu_postgrad_degree;
    if (!m.gender && d.gender) updates.gender = d.gender;
    if (!m.membership_type && d.application_name) {
      const match = d.application_name.match(/\[(\w+)\]/);
      updates.membership_type = match ? match[1] : d.application_name;
    }

    // Additional fields
    if (d.father_name) updates.father_name = d.father_name;
    if (d.mobile) updates.phone = String(d.mobile);
    if (d.city) updates.city = d.city;
    if (d.pin) updates.postal_code = d.pin;
    if (d.nationality) updates.nationality = d.nationality;
    if (d.dob && d.dob !== '0000-00-00') updates.date_of_birth = d.dob;
    if (d.mci_council_number) updates.mci_council_number = d.mci_council_number;
    if (d.mci_council_state_name) updates.mci_council_state = d.mci_council_state_name;
    if (d.edu_postgrad_college) updates.pg_college = d.edu_postgrad_college;
    if (d.edu_postgrad_university) updates.pg_university = d.edu_postgrad_university;
    if (d.edu_postgrad_year && String(d.edu_postgrad_year) !== '0') updates.pg_year = parseInt(d.edu_postgrad_year);
    if (d.profile) updates.profile_photo = d.profile;
    if (d.mci_certificate) updates.mci_certificate = d.mci_certificate;
    if (d.pg_degree_certificate) updates.pg_degree_certificate = d.pg_degree_certificate;
    if (d.asi_membership_no) updates.asi_membership_no = d.asi_membership_no;
    if (d.application_no) updates.application_no = d.application_no;
    if (d.joining_date && d.joining_date !== '0000-00-00') updates.joining_date = d.joining_date;
    if (d.salutation) updates.salutation = d.salutation;

    // Remove empty/null values
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '' || v === 'NULL' || v === undefined) delete updates[k];
    }

    if (Object.keys(updates).length === 0) { skipped++; continue; }

    const { error: updateErr } = await supabase
      .from('members')
      .update(updates)
      .eq('amasi_number', m.amasi_number);

    if (updateErr) {
      failed++;
      if (failed <= 3) console.log(`  FAIL #${m.amasi_number}: ${updateErr.message}`);
    } else {
      updated++;
      if (updated % 50 === 0) console.log(`  ...updated ${updated}`);
    }

    // Rate limit: don't hammer the old API
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (not in old system), ${failed} failed`);
  console.log(`Next run: node scripts/backfill-members.js ${BATCH} ${OFFSET + BATCH}`);
}

run().catch(e => console.error(e));
