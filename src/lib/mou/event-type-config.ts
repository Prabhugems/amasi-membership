import type { ApplicationTypeId } from "./types"
import { RURAL_PROGRAM_CLAUSES, WORKSHOP_CLAUSES } from "./mou-pdf"
import { SMALL_STATE_CHAPTER_STATES } from "./small-state-chapters"

export type MouFieldKey =
  | "amasi_membership_number" | "auditorium_facilities" | "committee_member_photo"
  | "institution_photo" | "high_speed_internet" | "expected_participants"
  | "live_surgery_demo" | "event_name" | "zone"

export interface EventTypeUiConfig {
  id: ApplicationTypeId
  label: string
  description: string
  fields: MouFieldKey[]
  // True only for types whose MOU legal text still has [TBD] placeholder
  // terms (financial/participant details) pending real content from the
  // AMASI Secretary — see mou-template-article.md in the SDD workspace.
  // Hides the type from the /mou landing page and its application route
  // until this is cleared.
  pendingContent?: boolean
}

export interface Agreement {
  clauseRef: string
  text: string
}

export type TypeSpecificFieldDef =
  | { key: string; kind: "text" | "textarea" | "number"; label: string; required?: boolean; maxLength?: number; min?: number; max?: number; helperText?: string }
  | { key: string; kind: "checkbox"; label: string; helperText?: string }
  | { key: string; kind: "radio"; label: string; options: { value: string; label: string }[]; required?: boolean; blockValue?: { value: string; message: string }; helperText?: string }
  | { key: "faculty"; kind: "faculty-rows"; minRows: number; maxRows: number }
  | { key: "partner_associations"; kind: "association-rows"; maxRows: number }
  | { key: string; kind: "conditional-upload"; docType: string; label: string; requiredWhen: { field: string; equals: string } }
  | { key: "facilities"; kind: "facilities-group"; items: { key: string; kind: "checkbox" | "number"; label: string }[] }

export interface MouEventTypeConfig extends EventTypeUiConfig {
  mouClauses: string[]
  mouTitle: string
  mouVersion: number
  organizerNameLabel?: string
  agreements: Agreement[]
  minLeadDays?: number
  requiresVenue?: boolean
  confirmationNote?: string
  typeSpecificFields: TypeSpecificFieldDef[]
  smallStateException?: {
    chapterFlagField: string
    venueStateField: string
    states: string[]
  }
  eventSubtypeWarning?: string
}

// Keys in a MouEventTypeConfig's typeSpecificFields that ALSO have a real
// column on academic_event_applications (from sql/040) — everything else
// in typeSpecificFields belongs only in type_specific_data. Single source
// of truth for Task 5 (route.ts, writing) and Task 10 (admin page,
// reading) so the two never drift apart on which bucket a key is in.
export const SHARED_TYPE_SPECIFIC_COLUMN_KEYS = new Set([
  "amasi_year_of_joining", "designation", "institution_type", "joint_programme",
  "proposed_registration_fee", "programme_outline",
])

// Common to every type regardless of this list: organizer_name, email,
// phone_number, primary_institution, preferred_date_1/2, venue_*,
// agree_terms, certify_accurate, authority_confirm. Only the EXTRA
// fields per type are listed here — src/components/mou/application-form.tsx
// always renders the common set, then conditionally renders these.
export const EVENT_TYPE_CONFIG: Record<ApplicationTypeId, EventTypeUiConfig | MouEventTypeConfig> = {
  fmas: {
    id: "fmas", label: "FMAS Course", description: "Fellowship in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo", "zone"],
  },
  mmas: {
    id: "mmas", label: "MMAS Course", description: "Mastery in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo", "zone"],
  },
  dmas: {
    id: "dmas", label: "DMAS Course", description: "Diploma in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo", "zone"],
  },
  slcp: {
    id: "slcp", label: "Safe Laparoscopic Cholecystectomy Programme", description: "SLCP hosting application",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo",
      "high_speed_internet", "expected_participants", "live_surgery_demo", "zone"],
  },
  workshop: {
    id: "workshop", label: "Workshop / CME / Conference", description: "AMASI workshop, CME, or conference hosting application (other than AMASICON)",
    fields: ["event_name", "expected_participants", "live_surgery_demo", "zone"],
    mouClauses: WORKSHOP_CLAUSES,
    mouTitle: "MEMORANDUM OF UNDERSTANDING FOR WORKSHOP/CME/CONFERENCE (OTHER THAN AMASICON)",
    mouVersion: 1,
    organizerNameLabel: "Organizing Secretary name",
    minLeadDays: 45,
    requiresVenue: true,
    confirmationNote: "AMASI HQ completes processing within two weeks of receiving the request. Please do not announce or publicise the programme until you receive written approval.",
    eventSubtypeWarning: "The MOU covers events other than AMASICON. Annual conference applications do not go through this route.",
    smallStateException: {
      chapterFlagField: "organised_by_state_chapter",
      venueStateField: "venue_state",
      states: SMALL_STATE_CHAPTER_STATES,
    },
    agreements: [
      { clauseRef: "5, 7", text: "I will not announce or publicise the programme, or use the AMASI name or logo in any form, until written approval is received from AMASI HQ." },
      { clauseRef: "6", text: "All banners, brochures, print and electronic materials will carry the logos of both AMASI and ASI." },
      { clauseRef: "12", text: "No bank account will be opened in the name of AMASI for this event under any circumstances." },
      { clauseRef: "13", text: "The programme — speakers, subjects, timings, allotment of halls and chairpersons — will be finalised only after AMASI's approval." },
      { clauseRef: "13", text: "The organising committee will provide halls of adequate capacity, audiovisual equipment and its management, a suitable podium, and personnel for assistance." },
      { clauseRef: "16", text: "The organising committee will arrange to-and-fro transport, accommodation and food for AMASI-provided faculty." },
      { clauseRef: "18", text: "No audiovisual material promoting the meetings, conferences or workshops of any other professional body will be displayed at the venue without informing AMASI." },
      { clauseRef: "19", text: "The event will not be used for personal propaganda, promotion of a private hospital, political propaganda, or any purpose other than the academic dissemination of knowledge." },
      { clauseRef: "20", text: "The organising committee bears full financial responsibility for the event; AMASI bears no financial liability, and no payment is due to AMASI." },
      { clauseRef: "21, 22", text: "I will forward the detailed programme, the list of organising committee members, the schedule of lectures, and the faculty involved at least 3 weeks before the event." },
      { clauseRef: "24", text: "I will provide full details of the available facilities to the Hon. Secretary at least one month in advance, and I accept that full responsibility for conducting the event rests with the organising committee." },
      { clauseRef: "25", text: "I will submit a report with photographs to the Hon. Secretary within 15 days of the event." },
      { clauseRef: "26", text: "I understand that my OTP-verified acceptance of the MOU on this form is my signature on it as Organizing Secretary, and that the MOU takes effect once AMASI approves this application." },
      { clauseRef: "existing", text: "I certify that all information provided is accurate and that I have the authority to submit this application on behalf of my institution." },
    ],
    typeSpecificFields: [
      { key: "amasi_year_of_joining", kind: "number", label: "Year of joining AMASI", min: 1993, max: new Date().getFullYear() },
      { key: "designation", kind: "text", label: "Designation at institution" },
      { key: "event_subtype", kind: "radio", label: "Event type", required: true, options: [
        { value: "workshop", label: "Workshop" }, { value: "cme", label: "CME" }, { value: "conference", label: "Conference" },
      ] },
      { key: "institution_type", kind: "radio", label: "Institution type", required: true, options: [
        { value: "own", label: "Own institution" }, { value: "guest", label: "Guest institution" }, { value: "private", label: "Private institution (individual)" },
      ] },
      { key: "joint_programme", kind: "checkbox", label: "This is a joint programme with another association", helperText: "Add a consent letter for each partner association below." },
      { key: "consent_guest_institution", kind: "conditional-upload", docType: "consent_guest_institution", label: "Consent letter from Head of the guest institution", requiredWhen: { field: "institution_type", equals: "guest" } },
      { key: "brief_institution", kind: "conditional-upload", docType: "brief_institution", label: "Brief about the institution", requiredWhen: { field: "institution_type", equals: "private" } },
      { key: "partner_associations", kind: "association-rows", maxRows: 10 },
      { key: "expected_delegates", kind: "number", label: "Expected number of delegates" },
      { key: "proposed_registration_fee", kind: "number", label: "Proposed registration fee (₹)", helperText: "Subject to AMASI approval." },
      { key: "programme_outline", kind: "textarea", label: "Proposed programme outline", helperText: "Final programme only after AMASI approval." },
      { key: "faculty_travel_mode", kind: "radio", label: "How will AMASI faculty travel be arranged?", required: true, options: [
        { value: "reimburse", label: "Faculty book their own travel; organiser reimburses at the venue" },
        { value: "direct_booking", label: "Organiser books airline/train tickets directly, on a mutually suitable itinerary" },
      ], helperText: "Both modes leave accommodation and food with the organiser." },
      { key: "organised_by_state_chapter", kind: "checkbox", label: "Is this event organised by a state chapter?" },
      { key: "small_state_exception_requested", kind: "checkbox", label: "Request AMASI-funded faculty transport under clause 17", helperText: "AMASI will provide to-and-fro transport for 2–3 faculty. Local hospitality, accommodation and food for these faculty remain the organiser's responsibility." },
      { key: "small_state_faculty_count", kind: "number", label: "Number of faculty (2 or 3 only)", min: 2, max: 3 },
      { key: "email_circular_requested", kind: "checkbox", label: "Request an AMASI email circular to members announcing this event", helperText: "AMASI will send it only if the facility is available and the organiser submits event details in the prescribed format at least 3 weeks before the event." },
      { key: "facilities", kind: "facilities-group", items: [
        { key: "halls", kind: "number", label: "Number of halls" },
        { key: "seating_capacity", kind: "number", label: "Total seating capacity" },
        { key: "av_equipment", kind: "checkbox", label: "AV equipment" },
        { key: "av_management", kind: "checkbox", label: "AV technician/management provided" },
        { key: "podium", kind: "checkbox", label: "Podium" },
        { key: "personnel", kind: "checkbox", label: "Support personnel" },
      ] },
      { key: "faculty", kind: "faculty-rows", minRows: 1, maxRows: 20 },
    ],
  },
  rural_program: {
    id: "rural_program", label: "Rural Surgery Camp", description: "Rural Surgery Camp hosting application",
    // No auditorium_facilities here — the actual MOU text (see
    // RURAL_PROGRAM_CLAUSES in mou-pdf.tsx) only requires "a hospital
    // located in a rural setting," not lecture-hall/AV/endotrainer
    // facilities. Those belong to the skill-course types (FMAS/MMAS/DMAS/
    // SLCP), which this originally copied by mistake.
    fields: ["amasi_membership_number", "committee_member_photo", "institution_photo", "zone"],
    mouClauses: RURAL_PROGRAM_CLAUSES,
    mouTitle: "MEMORANDUM OF UNDERSTANDING FOR RURAL SURGERY CAMP",
    mouVersion: 1,
    organizerNameLabel: "Organizing Secretary name",
    minLeadDays: 45,
    requiresVenue: true,
    confirmationNote: "AMASI HQ completes processing within two weeks of receiving the request. Please do not announce or publicise the programme until you receive written approval.",
    agreements: [
      { clauseRef: "4", text: "I confirm the camp will be held in a hospital in a rural setting, not in an urban area." },
      { clauseRef: "5, 6", text: "I will not announce or publicise the programme, or use the AMASI name or logo in any form, until written approval is received from AMASI HQ." },
      { clauseRef: "7", text: "All banners, brochures, print and electronic materials will carry the logos of both AMASI and ASI." },
      { clauseRef: "12", text: "No bank account will be opened in the name of AMASI for this camp under any circumstances." },
      { clauseRef: "19", text: "The organising committee bears full financial responsibility for the camp; AMASI bears no financial liability." },
      { clauseRef: "20", text: "I understand AMASI provides financial assistance up to ₹1,00,000 only, released against original bills and vouchers." },
      { clauseRef: "16", text: "The organising committee will arrange to-and-fro transport for AMASI-provided faculty from the nearest railhead or airport, and their accommodation and food." },
      { clauseRef: "17", text: "No audiovisual material promoting the meetings, conferences or workshops of any other professional body will be displayed at the venue without informing AMASI." },
      { clauseRef: "18", text: "The camp will not be used for personal propaganda, promotion of a private hospital, political propaganda, or any purpose other than service to the population." },
      { clauseRef: "21, 22", text: "I will forward the detailed programme, the list of organising committee members, and the schedule of lectures and operations at least 3 weeks before the camp." },
      { clauseRef: "23", text: "I will provide full details of the available facilities to the Hon. Secretary at least one month in advance." },
      { clauseRef: "24", text: "I will submit a report to the Hon. Secretary within 15 days of the camp, including photographs, location, a description of the beneficiaries, and the total number of surgeries performed." },
      { clauseRef: "25", text: "I understand that my OTP-verified acceptance of the MOU on this form is my signature on it as Organizing Secretary, and that the MOU takes effect once AMASI approves this application." },
      { clauseRef: "existing", text: "I certify that all information provided is accurate and that I have the authority to submit this application on behalf of my institution." },
    ],
    typeSpecificFields: [
      { key: "amasi_year_of_joining", kind: "number", label: "Year of joining AMASI", min: 1993, max: new Date().getFullYear() },
      { key: "designation", kind: "text", label: "Designation at institution" },
      { key: "venue_setting", kind: "radio", label: "Setting", required: true, options: [
        { value: "Rural", label: "Rural" }, { value: "Semi-urban", label: "Semi-urban" }, { value: "Urban", label: "Urban" },
      ], blockValue: { value: "Urban", message: "Clause 4 of the MOU requires the camp to be held in a hospital in a rural setting. Urban venues cannot be accepted." } },
      { key: "institution_type", kind: "radio", label: "Institution type", required: true, options: [
        { value: "own", label: "Own institution" }, { value: "guest", label: "Guest institution" }, { value: "private", label: "Private institution (individual)" },
      ] },
      { key: "joint_programme", kind: "checkbox", label: "This is a joint programme with another association", helperText: "Add a consent letter for each partner association below." },
      { key: "consent_guest_institution", kind: "conditional-upload", docType: "consent_guest_institution", label: "Consent letter from Head of the guest institution", requiredWhen: { field: "institution_type", equals: "guest" } },
      { key: "brief_institution", kind: "conditional-upload", docType: "brief_institution", label: "Brief about the institution", requiredWhen: { field: "institution_type", equals: "private" } },
      { key: "partner_associations", kind: "association-rows", maxRows: 10 },
      { key: "expected_beneficiaries", kind: "number", label: "Expected number of beneficiaries" },
      { key: "target_population", kind: "textarea", label: "Target population / catchment description", maxLength: 500 },
      { key: "expected_surgeries", kind: "number", label: "Expected number of surgeries" },
      { key: "proposed_registration_fee", kind: "number", label: "Proposed registration fee (₹)", helperText: "Subject to AMASI approval." },
      { key: "programme_outline", kind: "textarea", label: "Proposed programme outline", helperText: "Final programme only after AMASI approval." },
      { key: "financial_assistance_requested", kind: "checkbox", label: "Requesting AMASI financial assistance (up to ₹1,00,000)" },
      { key: "nearest_airport", kind: "text", label: "Nearest airport" },
      { key: "nearest_airport_km", kind: "number", label: "Distance to nearest airport (km)" },
      { key: "nearest_railhead", kind: "text", label: "Nearest railhead" },
      { key: "nearest_railhead_km", kind: "number", label: "Distance to nearest railhead (km)" },
      { key: "facilities", kind: "facilities-group", items: [
        { key: "hall_a", kind: "checkbox", label: "Hall A" },
        { key: "hall_b", kind: "checkbox", label: "Hall B" },
        { key: "av_equipment", kind: "checkbox", label: "AV equipment" },
        { key: "endotrainers", kind: "checkbox", label: "Endotrainers" },
        { key: "operation_theatres", kind: "number", label: "Operation theatres" },
        { key: "ot_tables", kind: "number", label: "OT tables" },
        { key: "anaesthesia_support", kind: "checkbox", label: "Anaesthesia support" },
        { key: "sterilisation_facility", kind: "checkbox", label: "Sterilisation facility" },
        { key: "inpatient_beds", kind: "number", label: "Inpatient beds" },
      ] },
      { key: "faculty", kind: "faculty-rows", minRows: 1, maxRows: 20 },
    ],
  },
  nextgen: {
    id: "nextgen", label: "NextGen Organizer", description: "AMASI NextGen: Nurturing the Future hosting application",
    fields: ["committee_member_photo", "zone"],
  },
  meet_the_master: {
    id: "meet_the_master", label: "Meet the Master", description: "A Day with a Master hosting application",
    fields: ["event_name", "expected_participants", "live_surgery_demo", "zone"],
    pendingContent: true,
  },
  zonal_event: {
    id: "zonal_event", label: "Zonal Event", description: "A zone-specific AMASI event",
    fields: ["event_name", "zone", "expected_participants"],
    pendingContent: true,
  },
}

export function getEventTypeConfig(id: string): (EventTypeUiConfig | MouEventTypeConfig) | null {
  return (EVENT_TYPE_CONFIG as Record<string, EventTypeUiConfig | MouEventTypeConfig>)[id] ?? null
}

export function isMouEventTypeConfig(config: EventTypeUiConfig | MouEventTypeConfig): config is MouEventTypeConfig {
  return "typeSpecificFields" in config
}
