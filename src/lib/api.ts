const AMASI_API_BASE = "https://application.amasi.org/api"

export interface MemberData {
  id: number
  application_id: number
  application_no: string
  application_no_without_letter: string
  membership_no: number
  first_name: string
  last_name: string
  middle_name: string
  email: string
  mobile_code: string
  mobile: string
  father_name: string
  dob: string
  age: number
  nationality: string
  zone: string
  gender: string
  street_line1: string
  street_line2: string
  country: string
  state: string
  city: string
  pin: string
  landline: string
  stdcode: string
  edu_undergrad_degree: string
  edu_undergrad_college: string
  edu_undergrad_university: string
  edu_undergrad_year: number
  edu_postgrad_degree: string
  edu_postgrad_college: string
  edu_postgrad_university: string
  edu_postgrad_year: number
  edu_superspecialty_degree: string
  edu_superspecialty_college: string
  edu_superspecialty_university: string
  edu_superspecialty_year: number | null
  mci_council_number: string
  mci_council_state: string
  imr_reg_no: string
  asi_membership_no: string
  asi_state: string
  mci_certificate: string | null
  pg_degree_certificate: string | null
  asi_member_certificate: string | null
  active_license: string | null
  letter_hod: string | null
  mbbs_degree_certificate: string | null
  profile: string | null
  member_reg_date: string
  joining_date: string
  doc_status: string | null
  application_status: number
  status: number
  created_on: string
  updated_on: string
  salutation: string
  country_name: string
  state_name: string
  status_name: string
  mci_council_state_name: string
  asi_state_name: string | null
  application_name: string
}

export interface ApiResponse {
  status: boolean
  message: string
  data: MemberData[]
}

export async function fetchMemberByEmailOrPhone(
  emailOrPhone: string
): Promise<ApiResponse> {
  const formData = new FormData()
  formData.append("email_or_phone", emailOrPhone)

  const res = await fetch(`${AMASI_API_BASE}/member_detail_data`, {
    method: "POST",
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }

  return res.json()
}
