const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const DUMP_PATH = process.argv[2] || '/Users/prabhubalasubramaniam/Downloads/WhatsApp Dump Apr 21.sql';

async function run() {
  // Get ALL existing AMASI numbers (paginate to avoid 1000-row limit)
  const existingSet = new Set();
  let offset = 0;
  while (true) {
    const { data, error: fetchErr } = await supabase
      .from('members')
      .select('amasi_number')
      .range(offset, offset + 4999);
    if (fetchErr) { console.error('Fetch error:', fetchErr.message); return; }
    if (!data || data.length === 0) break;
    data.forEach(m => existingSet.add(m.amasi_number));
    offset += data.length;
    if (data.length < 5000) break;
  }
  console.log('Existing members in Supabase:', existingSet.size);

  // Read dump
  const content = fs.readFileSync(DUMP_PATH, 'utf8');

  // Get column names
  const colRegex = /CREATE TABLE `tbl_member` \(\s*([\s\S]*?)\s*PRIMARY KEY/;
  const colMatch = content.match(colRegex);
  if (!colMatch) { console.error('Could not find tbl_member CREATE TABLE'); return; }
  const columns = [];
  for (const line of colMatch[1].split('\n')) {
    const m = line.match(/^\s*`(\w+)`/);
    if (m) columns.push(m[1]);
  }
  console.log('Columns:', columns.length);

  // Get INSERT values
  const insertRegex = /INSERT INTO `tbl_member` VALUES\s*(.+?);\s*$/ms;
  const insertMatch = content.match(insertRegex);
  if (!insertMatch) { console.error('No INSERT INTO tbl_member found'); return; }

  // Parse rows
  const rowRegex = /\((?:[^()]*|\([^()]*\))*\)/g;
  const rowStrings = insertMatch[1].match(rowRegex) || [];
  console.log('Dump rows:', rowStrings.length);

  let imported = 0, skipped = 0, failed = 0;

  for (const rowStr of rowStrings) {
    // Parse fields respecting quoted strings
    const fields = [];
    let current = '', inQ = false, started = false;
    for (let i = 0; i < rowStr.length; i++) {
      const ch = rowStr[i];
      if (ch === '(' && !started) { started = true; continue; }
      if (!started) continue;
      if (ch === ')' && !inQ) { fields.push(current.trim().replace(/^'|'$/g, '')); break; }
      if (ch === "'" && !inQ) { inQ = true; continue; }
      if (ch === "'" && inQ) {
        // Check for escaped quote ''
        if (rowStr[i + 1] === "'") { current += "'"; i++; continue; }
        inQ = false; continue;
      }
      if (ch === ',' && !inQ) { fields.push(current.trim().replace(/^'|'$/g, '')); current = ''; continue; }
      current += ch;
    }

    // Map to object
    const d = {};
    columns.forEach((col, i) => {
      if (i < fields.length) d[col] = fields[i] === 'NULL' ? null : fields[i];
    });

    // Skip if no membership number or already exists
    if (!d.membership_no) { skipped++; continue; }
    const memNo = parseInt(d.membership_no);
    if (isNaN(memNo) || existingSet.has(memNo)) { skipped++; continue; }

    // Build record
    const name = [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(' ').trim();
    const record = {
      amasi_number: memNo,
      name: name || 'Unknown',
      email: d.email || `member${memNo}@amasi.org`,
      phone: d.mobile || '',
      status: 'active',
    };

    // Map fields
    const fieldMap = {
      salutation: 'salutation', mobile_code: 'mobile_code', father_name: 'father_name',
      nationality: 'nationality', application_no: 'application_no',
      street_line1: 'street_address_1', street_line2: 'street_address_2',
      city: 'city', state: 'state', country: 'country', pin: 'postal_code', zone: 'zone',
      edu_postgrad_degree: 'pg_degree', edu_postgrad_college: 'pg_college',
      edu_postgrad_university: 'pg_university',
      mci_council_number: 'mci_council_number', mci_council_state: 'mci_council_state',
      asi_membership_no: 'asi_membership_no', profile: 'profile_photo',
      mci_certificate: 'mci_certificate', pg_degree_certificate: 'pg_degree_certificate',
      mbbs_degree_certificate: 'mbbs_degree_certificate',
      asi_member_certificate: 'asi_member_certificate',
      active_license: 'active_license', letter_hod: 'letter_hod', gender: 'gender',
    };

    for (const [src, dst] of Object.entries(fieldMap)) {
      if (d[src]) record[dst] = d[src];
    }

    // Dates
    if (d.dob && d.dob !== '0000-00-00') record.date_of_birth = d.dob;
    if (d.joining_date && d.joining_date !== '0000-00-00') record.joining_date = d.joining_date;
    if (d.member_reg_date && !d.member_reg_date.includes('0000')) record.application_date = d.member_reg_date;
    if (d.edu_postgrad_year && d.edu_postgrad_year !== '0' && d.edu_postgrad_year !== '' && /^\d+$/.test(d.edu_postgrad_year)) {
      record.pg_year = parseInt(d.edu_postgrad_year);
    }
    // Remove empty strings for all fields (Supabase rejects '' for integer/date columns)
    for (const [k, v] of Object.entries(record)) {
      if (v === '' || v === 'NULL') delete record[k];
    }

    // Upsert — insert new members, update existing with fresh data from dump
    const { error } = await supabase.from('members').upsert(record, { onConflict: 'amasi_number' });
    if (error) {
      failed++;
      if (failed <= 5) console.log(`FAIL #${memNo} (${d.email}): ${error.message}`);
    } else {
      imported++;
      existingSet.add(memNo);
      if (imported % 100 === 0) console.log(`  ...imported ${imported}`);
    }
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped (already exist), ${failed} failed`);

  // Final count
  const { count } = await supabase.from('members').select('*', { count: 'exact', head: true });
  console.log(`Total members in Supabase now: ${count}`);
}

run().catch(e => console.error(e));
