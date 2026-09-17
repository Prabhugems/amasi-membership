import type { ApplicationTypeId } from "./types"
import { AMASICON_CLAUSES, RURAL_PROGRAM_CLAUSES, WORKSHOP_CLAUSES } from "./mou-pdf"
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
  // Hides a type from the /mou landing page and its application route while
  // its MOU text is still being drafted. No type is hidden today (Meet the
  // Master and Zonal Event went live 2026-09-10 with application-driven
  // terms — see getArticleVars in mou-pdf.tsx); kept for future types.
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
  // Replaces the default "facility details one month in advance / signed MOU
  // 15 days before" lead-time rejection message, for types whose MOU sets a
  // different horizon (AMASICON: 12 months, clause 41).
  leadTimeMessage?: string
  // Labels for the two common date inputs when "Preferred date" doesn't fit
  // (AMASICON asks for the proposed conference date, a year or more out).
  dateLabels?: { primary: string; alternate: string }
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
    fields: ["amasi_membership_number", "event_name", "expected_participants", "live_surgery_demo", "zone"],
    mouClauses: WORKSHOP_CLAUSES,
    mouTitle: "MEMORANDUM OF UNDERSTANDING FOR WORKSHOP/CME/CONFERENCE (OTHER THAN AMASICON)",
    mouVersion: 1,
    organizerNameLabel: "Organizing Secretary name",
    minLeadDays: 10,
    leadTimeMessage: "Please choose an event date at least 10 days from today.",
    requiresVenue: true,
    confirmationNote: "AMASI HQ completes processing within two weeks of receiving the request. Please do not announce or publicise the programme until you receive written approval.",
    eventSubtypeWarning: "The MOU covers events other than AMASICON. Annual conference bids have their own application at /mou/amasicon.",
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
      { clauseRef: "13 (facilities)", text: "The organising committee will provide halls of adequate capacity, audiovisual equipment and its management, a suitable podium, and personnel for assistance." },
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
  amasicon: {
    id: "amasicon", label: "AMASICON — Annual Conference", description: "Bid to host the annual national conference of AMASI. Valid bids are placed before the next General Body Meeting, where the proposed Organizing Secretary presents the case in person.",
    // expected_participants doubles as "expected delegates"; event_name is
    // the conference name the bid is for (e.g. "AMASICON 2028").
    fields: ["amasi_membership_number", "event_name", "expected_participants", "zone"],
    mouClauses: AMASICON_CLAUSES,
    mouTitle: "MEMORANDUM OF UNDERSTANDING FOR AMASICON",
    mouVersion: 1,
    organizerNameLabel: "Proposed Organizing Secretary name",
    // Clause 41: the MOU must be signed at least 12 months before the agreed
    // conference date. OTP acceptance on this form is that signature, so the
    // proposed date must be at least a year out at submission.
    minLeadDays: 365,
    leadTimeMessage: "Clause 41 of the AMASICON MOU requires it to be signed at least 12 months before the agreed conference date. Please propose a date at least 365 days away.",
    dateLabels: { primary: "Proposed conference date (first day)", alternate: "Alternate date" },
    // A bid is placed a year or more out — the exact venue is usually not
    // fixed yet (clause 6 leaves it to the OC subject to EC endorsement).
    // The host city is captured as a required type-specific field instead.
    requiresVenue: false,
    confirmationNote: "Valid AMASICON invitations are placed before the next General Body Meeting of AMASI, where you will present your bid in person. AMASI HQ will write to you once the GBM date is fixed. Please do not announce or publicise the bid until then.",
    agreements: [
      { clauseRef: "bid", text: "I will personally present this bid at the General Body Meeting of AMASI when the item is taken up, and I accept that the General Body's decision is final." },
      { clauseRef: "4", text: "If any official body other than AMASI (e.g. a local or state chapter of ASI) is involved in organising the conference, AMASI's prior intimation and approval will be taken." },
      { clauseRef: "7", text: "All banners, brochures, print and electronic materials will carry the logos of both AMASI and ASI." },
      { clauseRef: "8", text: "AMASI decides the scientific programme — speakers, subjects, timings, halls and chairpersons. The organising committee will provide halls of adequate capacity, audiovisual equipment and its management, a podium in each hall, and personnel for assistance." },
      { clauseRef: "9, 10", text: "Registration fees will be as decided by the General Body of AMASI. The exemption list approved by the EC will be honoured, and no complimentary registrations or accommodation will be given at the conference's cost without AMASI's agreement." },
      { clauseRef: "11, 12", text: "EC members may register at the lowest rate offered and will be given airport/railway transfers. Local hospitality will be provided to the exemption list, and free accommodation, food, equipment, a stall near registration and a secure room will be provided to AMASI office staff." },
      { clauseRef: "13, 14, 15, 16", text: "Exactly one bank account will be opened in the name of AMASICON (year), operated by the Treasurer with at least two signatures. Every collection — registration, advertisement, stalls, sponsorship — will be deposited in it, payment details will be printed in every circular, and receipts will be issued within 7 days." },
      { clauseRef: "17", text: "The list of office bearers, committee chairpersons, Finance Committee members and the account signatory will be sent to the Hon. Secretary at least one year before the conference." },
      { clauseRef: "21, 23", text: "The organising committee will abide by AMASI's deadlines and will provide full details of the available facilities to the Hon. Secretary at least 9 months in advance." },
      { clauseRef: "24", text: "Circulars to members will carry accommodation, travel, weather, sightseeing and travel-agent details and the fee table, and the AMASI membership of every delegate claiming the member rate will be verified before acceptance." },
      { clauseRef: "25, 26, 31", text: "The inaugurator will be chosen in consultation with the President; the inauguration, FMAS convocation, General Body Meeting and EC meetings will be arranged as instructed by AMASI and per AMASI protocol; and a dinner will be hosted for the EC, past Presidents, their spouses and special invitees." },
      { clauseRef: "29, 30", text: "Full details of stalls and sponsorships, including amounts collected, will be submitted to the Hon. Secretary before the conference begins; all such collections go to the conference account only." },
      { clauseRef: "32, 33, 34, 35", text: "The Organizing Chairman, Organizing Secretary, Treasurer, Joint Secretary and Finance Committee members will all be full members of AMASI. Meticulous accounts will be kept; unaudited provisional accounts will reach the Hon. Secretary within three months and audited accounts within six months, and AMASI's auditors will be given every document they ask for." },
      { clauseRef: "36", text: "Seed money of up to ₹10 lakh advanced by AMASI will be returned in full from the conference account within one month of the conference." },
      { clauseRef: "37", text: "Within three months of the conference, ₹5 lakh or 30% of registration fees, whichever is higher, will be remitted to AMASI HQ with the provisional accounts. The minimum guarantee to AMASI is ₹20 lakh of surplus, and larger surpluses will be shared exactly as the MOU sets out." },
      { clauseRef: "38, 39, 40", text: "The delegate list will be sent to the central office in electronic form; any unpaid amount due to AMASI is a debt subject to the EC's disciplinary procedures; and a report with photographs, two copies of the inaugural video and all publications will reach the Hon. Secretary within one month." },
      { clauseRef: "41", text: "I understand that my OTP-verified acceptance of the MOU on this form is my signature on it as Organizing Secretary, that it takes effect once the General Body awards the conference, and that if it is not in place at least 12 months before the agreed date the invitation stands cancelled." },
      { clauseRef: "existing", text: "I certify that all information provided is accurate and that I have the authority to submit this bid on behalf of the proposed organising committee." },
    ],
    typeSpecificFields: [
      { key: "amasi_year_of_joining", kind: "number", label: "Year of joining AMASI", required: true, min: 1993, max: new Date().getFullYear() },
      { key: "designation", kind: "text", label: "Designation at institution" },
      { key: "organizing_chairman", kind: "text", label: "Proposed Organizing Chairman", required: true, helperText: "Must be a full member of AMASI (clause 32)." },
      { key: "organizing_treasurer", kind: "text", label: "Proposed Treasurer", helperText: "Must be a full member of AMASI (clause 32)." },
      { key: "host_city", kind: "text", label: "Proposed host city", required: true },
      { key: "proposed_month", kind: "text", label: "Preferred month / window", helperText: "e.g. second week of September. The proposed date above is your first choice." },
      { key: "local_support", kind: "textarea", label: "Why this city — connectivity, hotel inventory, institutional backing", required: true, maxLength: 2000 },
      { key: "previous_conferences", kind: "textarea", label: "Major conferences this team has hosted earlier", maxLength: 1000 },
      { key: "supporting_city_chapter", kind: "text", label: "Supporting city chapter of ASI (if any)" },
      { key: "supporting_state_chapter", kind: "text", label: "Supporting state chapter of ASI (if any)" },
      { key: "supporting_others", kind: "text", label: "Other supporting associations (if any)" },
      { key: "joint_programme", kind: "checkbox", label: "Another official body (e.g. an ASI chapter) will formally co-organise the conference", helperText: "Clause 4 — needs AMASI's prior approval. Add a consent letter for each partner association below." },
      { key: "partner_associations", kind: "association-rows", maxRows: 10 },
      { key: "government_teaching_hospital", kind: "checkbox", label: "The conference will be hosted by a government teaching hospital", helperText: "Affects how the organising committee's share of any surplus may be used (clause 37)." },
      { key: "programme_outline", kind: "textarea", label: "Proposed pre- or post-conference workshops (if any)", helperText: "The main scientific programme is decided by AMASI (clause 8). Workshop accounts sit under the conference account (clause 18)." },
      { key: "facilities", kind: "facilities-group", items: [
        { key: "halls", kind: "number", label: "Number of halls" },
        { key: "seating_capacity", kind: "number", label: "Main hall seating capacity" },
        { key: "trade_exhibition_area", kind: "checkbox", label: "Trade exhibition area" },
        { key: "live_surgery_relay", kind: "checkbox", label: "Live surgery relay from an operating theatre" },
        { key: "av_equipment", kind: "checkbox", label: "AV equipment in every hall" },
        { key: "hotel_rooms_nearby", kind: "number", label: "Hotel rooms within 5 km" },
      ] },
    ],
  },
  nextgen: {
    id: "nextgen", label: "NextGen Organizer", description: "AMASI NextGen: Nurturing the Future hosting application",
    fields: ["committee_member_photo", "zone"],
  },
  meet_the_master: {
    id: "meet_the_master", label: "Meet the Master", description: "A Day with a Master — host a one-day interactive programme built around an invited Master surgeon. Programme, fee and faculty are proposed here and fixed by AMASI HQ in the approval.",
    fields: ["event_name", "expected_participants", "live_surgery_demo", "zone"],
  },
  zonal_event: {
    id: "zonal_event", label: "Zonal Event", description: "A zone-specific AMASI academic event (CME, workshop, symposium or hands-on session). The zone's Chairperson is notified; programme, fee and faculty are fixed by AMASI HQ in the approval.",
    fields: ["event_name", "zone", "expected_participants"],
  },
}

export function getEventTypeConfig(id: string): (EventTypeUiConfig | MouEventTypeConfig) | null {
  return (EVENT_TYPE_CONFIG as Record<string, EventTypeUiConfig | MouEventTypeConfig>)[id] ?? null
}

export function isMouEventTypeConfig(config: EventTypeUiConfig | MouEventTypeConfig): config is MouEventTypeConfig {
  return "typeSpecificFields" in config
}
