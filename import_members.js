const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://jmdwxymbgxwdsmcwbahp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptZHd4eW1iZ3h3ZHNtY3diYWhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAxMTA1NSwiZXhwIjoyMDgyNTg3MDU1fQ.rvk94RhIk7lcDonsR_dWdPL7rEzmn91tdXLChDg9b4Y'
);

const csv = fs.readFileSync("/Users/prabhubalasubramaniam/Downloads/AMASI Membership Application Report.csv", "utf8");
const lines = csv.split('\n');
const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

function parseCSVRow(line) {
  const row = {};
  let field = '', inQuotes = false, idx = 0;
  for (const c of line) {
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { row[headers[idx]] = field.trim(); field = ''; idx++; continue; }
    field += c;
  }
  row[headers[idx]] = field.trim();
  return row;
}

const clean = (v) => (v && v !== 'N/A' && v !== 'null' && v.trim()) ? v.trim() : null;

async function run() {
  let updated = 0, skipped = 0, errors = 0;
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVRow(lines[i]);
    
    const email = clean(row['Email']);
    const memberId = clean(row['Member ID']);
    if (!email && !memberId) { skipped++; continue; }
    
    // Build update object - only set non-null values
    const updates = {};
    const name = clean(row['Name']);
    if (name) updates.name = name;
    if (clean(row["Father's Name"])) updates.father_name = clean(row["Father's Name"]);
    if (clean(row['DOB'])) {
      // Convert DD/MM/YYYY to YYYY-MM-DD
      const parts = row['DOB'].split('/');
      if (parts.length === 3) updates.date_of_birth = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    if (clean(row['Gender'])) updates.gender = clean(row['Gender']);
    if (clean(row['Nationality'])) updates.nationality = clean(row['Nationality']);
    if (clean(row['Membership Type'])) updates.membership_type = clean(row['Membership Type']);
    if (clean(row['Application No'])) updates.application_no = clean(row['Application No']);
    if (clean(row['Mobile'])) updates.phone = parseInt(clean(row['Mobile'])) || null;
    if (clean(row['Mobile Code'])) updates.mobile_code = clean(row['Mobile Code']);
    if (clean(row['Street Address 1'])) updates.street_address_1 = clean(row['Street Address 1']);
    if (clean(row['Street Address 2'])) updates.street_address_2 = clean(row['Street Address 2']);
    if (clean(row['City'])) updates.city = clean(row['City']);
    if (clean(row['State'])) updates.state = clean(row['State']);
    if (clean(row['Country'])) updates.country = clean(row['Country']);
    if (clean(row['Postal/Zip Code'])) updates.postal_code = clean(row['Postal/Zip Code']);
    if (clean(row['Landline'])) updates.landline = clean(row['Landline']);
    if (clean(row['STD Code'])) updates.std_code = clean(row['STD Code']);
    if (clean(row['Education - UG College'])) updates.ug_college = clean(row['Education - UG College']);
    if (clean(row['Education - UG University'])) updates.ug_university = clean(row['Education - UG University']);
    if (clean(row['Education - UG Year'])) updates.ug_year = clean(row['Education - UG Year']);
    if (clean(row['Education - PG Degree'])) updates.pg_degree = clean(row['Education - PG Degree']);
    if (clean(row['Education - PG College'])) updates.pg_college = clean(row['Education - PG College']);
    if (clean(row['Education - PG University'])) updates.pg_university = clean(row['Education - PG University']);
    if (clean(row['Education - PG Year'])) updates.pg_year = clean(row['Education - PG Year']);
    if (clean(row['MCI Council Number'])) updates.mci_council_number = clean(row['MCI Council Number']);
    if (clean(row['MCI Council State'])) updates.mci_council_state = clean(row['MCI Council State']);
    if (clean(row['IMR Registration No'])) updates.imr_registration_no = clean(row['IMR Registration No']);
    if (clean(row['ASI Membership No'])) updates.asi_membership_no = clean(row['ASI Membership No']);
    if (clean(row['ASI State'])) updates.asi_state = clean(row['ASI State']);
    
    updates.amasi_number = parseInt(memberId) || null;
    updates.status = 'active';
    updates.updated_at = new Date().toISOString();
    
    if (!email) { skipped++; continue; }
    
    // Upsert by email
    const { error } = await supabase
      .from('members')
      .upsert({ email, ...updates }, { onConflict: 'email' });
    
    if (error) {
      errors++;
      if (errors <= 5) console.error(`Error row ${i}:`, error.message);
    } else {
      updated++;
    }
    
    if (i % 500 === 0) console.log(`Progress: ${i}/${lines.length} (updated: ${updated}, errors: ${errors})`);
  }
  
  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

run().catch(e => console.error('Fatal:', e.message));
