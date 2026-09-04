export type ApplicationTypeId =
  | "fmas" | "mmas" | "dmas" | "workshop" | "rural_program"
  | "slcp" | "nextgen" | "meet_the_master" | "zonal_event"

export type ApplicationStatus =
  | "submitted" | "under_review" | "changes_requested" | "approved" | "rejected"

export interface AcademicEventApplication {
  id: string
  application_type_id: ApplicationTypeId
  status: ApplicationStatus
  applicant_amasi_number: string | null
  applicant_member_id: string | null
  organizer_name: string
  email: string
  phone_number: string
  otp_verified_at: string | null
  primary_institution: string
  event_name: string | null
  expected_participants: string | null
  live_surgery_demo: boolean | null
  preferred_date_1: string
  preferred_date_2: string | null
  finalized_date: string | null
  venue_type: string | null
  venue_name: string | null
  venue_address: string | null
  venue_city: string | null
  venue_state: string | null
  venue_zip: string | null
  venue_country: string | null
  zone: "North" | "South" | "East" | "West" | "Central" | null
  auditorium_hall_a: boolean
  auditorium_hall_b: boolean
  av_equipment: boolean
  endotrainers: boolean
  high_speed_internet: boolean
  agree_terms: boolean
  certify_accurate: boolean
  authority_confirm: boolean
  committee_member_photo_url: string | null
  institution_photo_url: string | null
  mou_generated_url: string | null
  mou_version: number
  created_event_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  admin_notes: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface NewApplicationInput {
  application_type_id: ApplicationTypeId
  organizer_name: string
  email: string
  phone_number: string
  applicant_amasi_number?: string
  applicant_member_id?: string
  primary_institution: string
  event_name?: string
  expected_participants?: string
  live_surgery_demo?: boolean
  preferred_date_1: string
  preferred_date_2?: string
  venue_type?: string
  venue_name?: string
  venue_address?: string
  venue_city?: string
  venue_state?: string
  venue_zip?: string
  venue_country?: string
  zone?: "North" | "South" | "East" | "West" | "Central"
  auditorium_hall_a?: boolean
  auditorium_hall_b?: boolean
  av_equipment?: boolean
  endotrainers?: boolean
  high_speed_internet?: boolean
  agree_terms: boolean
  certify_accurate: boolean
  authority_confirm: boolean
  committee_member_photo_url?: string
  institution_photo_url?: string
}
