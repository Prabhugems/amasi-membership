// Maps between Supabase `members` table columns and profile form fields

export interface ProfileFormData {
  // Identity (read-only in UI)
  id: string
  email: string
  phone: string
  amasi_number: number
  membership_type: string
  application_no: string
  status: string
  zone: string

  // Editable personal
  salutation: string
  firstName: string
  middleName: string
  lastName: string
  dob: string
  gender: string
  fatherName: string
  nationality: string

  // Editable address
  streetLine1: string
  streetLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  landline: string
  stdCode: string

  // Education - UG
  eduUndergradDegree: string
  eduUndergradCollege: string
  eduUndergradUniversity: string
  eduUndergradYear: string

  // Education - PG
  eduPostgradDegree: string
  eduPostgradCollege: string
  eduPostgradUniversity: string
  eduPostgradYear: string

  // Education - Super Specialty
  eduSuperspecialtyDegree: string
  eduSuperspecialtyCollege: string
  eduSuperspecialtyUniversity: string
  eduSuperspecialtyYear: string

  // Registration
  mciCouncilNumber: string
  mciCouncilState: string
  imrRegNo: string
  asiMembershipNo: string
  asiState: string

  // Documents (URLs)
  mciCertificate: string | null
  pgDegreeCertificate: string | null
  mbbsDegreeCertificate: string | null
  asiMemberCertificate: string | null
  activeLicense: string | null
  letterHod: string | null
  profilePhoto: string | null
}

/** Split a full name into first/middle/last parts */
function splitName(name: string): { first: string; middle: string; last: string } {
  const parts = (name || "").trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" }
  if (parts.length === 2) return { first: parts[0], middle: "", last: parts[1] }
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1] }
}

/** Join first/middle/last into a single name */
function joinName(first: string, middle: string, last: string): string {
  return [first, middle, last].filter(Boolean).join(" ").trim()
}

/** Convert a Supabase `members` row to ProfileFormData */
export function dbToFormData(row: Record<string, any>): ProfileFormData {
  const { first, middle, last } = splitName(row.name || "")

  return {
    id: row.id || "",
    email: row.email || "",
    phone: String(row.phone || ""),
    amasi_number: row.amasi_number || 0,
    membership_type: row.membership_type || "",
    application_no: row.application_no || "",
    status: row.status || "",
    zone: row.zone || "",

    salutation: row.salutation || "Dr.",
    firstName: first,
    middleName: middle,
    lastName: last,
    dob: row.date_of_birth || "",
    gender: row.gender || "",
    fatherName: row.father_name || "",
    nationality: row.nationality || "",

    streetLine1: row.street_address_1 || "",
    streetLine2: row.street_address_2 || "",
    city: row.city || "",
    state: row.state || "",
    postalCode: row.postal_code || "",
    country: row.country || "",
    landline: row.landline || "",
    stdCode: row.std_code || "",

    eduUndergradDegree: row.edu_undergrad_degree || "",
    eduUndergradCollege: row.ug_college || "",
    eduUndergradUniversity: row.ug_university || "",
    eduUndergradYear: row.ug_year || "",

    eduPostgradDegree: row.pg_degree || "",
    eduPostgradCollege: row.pg_college || "",
    eduPostgradUniversity: row.pg_university || "",
    eduPostgradYear: row.pg_year || "",

    eduSuperspecialtyDegree: row.edu_superspecialty_degree || "",
    eduSuperspecialtyCollege: row.edu_superspecialty_college || "",
    eduSuperspecialtyUniversity: row.edu_superspecialty_university || "",
    eduSuperspecialtyYear: row.edu_superspecialty_year || "",

    mciCouncilNumber: row.mci_council_number || "",
    mciCouncilState: row.mci_council_state || "",
    imrRegNo: row.imr_registration_no || "",
    asiMembershipNo: row.asi_membership_no || "",
    asiState: row.asi_state || "",

    mciCertificate: row.mci_certificate || null,
    pgDegreeCertificate: row.pg_degree_certificate || null,
    mbbsDegreeCertificate: row.mbbs_degree_certificate || null,
    asiMemberCertificate: row.asi_member_certificate || null,
    activeLicense: row.active_license || null,
    letterHod: row.letter_hod || null,
    profilePhoto: row.profile_photo || null,
  }
}

// Form field → DB column mapping (only editable fields)
const formToDbMap: Record<string, string> = {
  email: "email",
  phone: "phone",
  salutation: "salutation",
  fatherName: "father_name",
  dob: "date_of_birth",
  gender: "gender",
  nationality: "nationality",
  streetLine1: "street_address_1",
  streetLine2: "street_address_2",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  country: "country",
  landline: "landline",
  stdCode: "std_code",
  eduUndergradDegree: "edu_undergrad_degree",
  eduUndergradCollege: "ug_college",
  eduUndergradUniversity: "ug_university",
  eduUndergradYear: "ug_year",
  eduPostgradDegree: "pg_degree",
  eduPostgradCollege: "pg_college",
  eduPostgradUniversity: "pg_university",
  eduPostgradYear: "pg_year",
  eduSuperspecialtyDegree: "edu_superspecialty_degree",
  eduSuperspecialtyCollege: "edu_superspecialty_college",
  eduSuperspecialtyUniversity: "edu_superspecialty_university",
  eduSuperspecialtyYear: "edu_superspecialty_year",
  mciCouncilNumber: "mci_council_number",
  mciCouncilState: "mci_council_state",
  imrRegNo: "imr_registration_no",
  asiMembershipNo: "asi_membership_no",
  asiState: "asi_state",
  zone: "zone",
  profilePhoto: "profile_photo",
  mciCertificate: "mci_certificate",
  pgDegreeCertificate: "pg_degree_certificate",
  mbbsDegreeCertificate: "mbbs_degree_certificate",
  asiMemberCertificate: "asi_member_certificate",
  activeLicense: "active_license",
  letterHod: "letter_hod",
}

// Reverse map for display
const dbToFormMap: Record<string, string> = Object.fromEntries(
  Object.entries(formToDbMap).map(([k, v]) => [v, k])
)

/** Convert changed form fields to DB column updates. Handles name joining. */
export function formChangesToDb(
  original: ProfileFormData,
  updated: ProfileFormData
): Record<string, any> {
  const changes: Record<string, any> = {}

  // Handle name fields specially (join into single `name` column)
  const origName = joinName(original.firstName, original.middleName, original.lastName)
  const newName = joinName(updated.firstName, updated.middleName, updated.lastName)
  if (origName !== newName) {
    changes.name = newName
  }

  // Handle all other mapped fields
  for (const [formKey, dbCol] of Object.entries(formToDbMap)) {
    const origVal = (original as any)[formKey] ?? ""
    const newVal = (updated as any)[formKey] ?? ""
    if (String(origVal) !== String(newVal)) {
      changes[dbCol] = newVal || null
    }
  }

  return changes
}

export interface ChangeEntry {
  field: string       // DB column name
  label: string       // Human-readable label
  oldValue: string
  newValue: string
}

// Human-readable labels for DB columns
const fieldLabels: Record<string, string> = {
  name: "Full Name",
  email: "Email",
  phone: "Mobile Number",
  salutation: "Salutation",
  father_name: "Father's Name",
  date_of_birth: "Date of Birth",
  gender: "Gender",
  nationality: "Nationality",
  street_address_1: "Address Line 1",
  street_address_2: "Address Line 2",
  city: "City",
  state: "State",
  postal_code: "PIN Code",
  country: "Country",
  landline: "Landline",
  std_code: "STD Code",
  edu_undergrad_degree: "UG Degree",
  ug_college: "UG College",
  ug_university: "UG University",
  ug_year: "UG Year",
  pg_degree: "PG Degree",
  pg_college: "PG College",
  pg_university: "PG University",
  pg_year: "PG Year",
  edu_superspecialty_degree: "Super Specialty Degree",
  edu_superspecialty_college: "Super Specialty College",
  edu_superspecialty_university: "Super Specialty University",
  edu_superspecialty_year: "Super Specialty Year",
  mci_council_number: "MCI/Council Number",
  mci_council_state: "MCI Council State",
  imr_registration_no: "IMR Registration No",
  asi_membership_no: "ASI Membership No",
  asi_state: "ASI State",
  profile_photo: "Profile Photo",
  mci_certificate: "MCI Certificate",
  pg_degree_certificate: "PG Degree Certificate",
  mbbs_degree_certificate: "MBBS Degree Certificate",
  asi_member_certificate: "ASI Member Certificate",
  active_license: "Active License",
  letter_hod: "HOD Letter",
}

/** Compute a human-readable diff between original and updated form data */
export function computeDiff(
  original: ProfileFormData,
  updated: ProfileFormData
): ChangeEntry[] {
  const dbChanges = formChangesToDb(original, updated)
  const entries: ChangeEntry[] = []

  for (const [dbCol, newVal] of Object.entries(dbChanges)) {
    // Find the original DB value
    const formKey = dbToFormMap[dbCol]
    let oldVal = ""
    if (dbCol === "name") {
      oldVal = joinName(original.firstName, original.middleName, original.lastName)
    } else if (formKey) {
      oldVal = String((original as any)[formKey] ?? "")
    }

    entries.push({
      field: dbCol,
      label: fieldLabels[dbCol] || dbCol,
      oldValue: oldVal,
      newValue: String(newVal ?? ""),
    })
  }

  return entries
}

/** Check which required fields are missing for profile completeness */
export function getMissingFields(data: ProfileFormData): string[] {
  const missing: string[] = []
  if (!data.dob) missing.push("Date of Birth")
  if (!data.gender) missing.push("Gender")
  if (!data.eduPostgradDegree) missing.push("PG Degree")
  if (!data.mciCouncilNumber) missing.push("MCI/Council Number")
  if (!data.firstName) missing.push("Name")
  if (!data.city) missing.push("City")
  if (!data.state) missing.push("State")
  return missing
}
