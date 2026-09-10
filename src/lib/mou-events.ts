/**
 * Event catalogue for the "apply to host an AMASI academic event" flow.
 *
 * Client-safe (no server imports). One entry per event type listed on
 * https://amasi.org/application-forms-mous-for-academic-events/. The slugs
 * are URL segments under /mou/<slug>; four of them (fmas, nextgen, mmas, slcp)
 * are already linked from the AMASI website, so they must not change.
 *
 * Each entry declares the event-specific questions (`fields`) stored in
 * `mou_applications.details`, the declarations the applicant must accept, and
 * a plain-language summary of the MOU obligations shown before submit.
 * Server-side validation in src/lib/mou-applications.ts is driven by the same
 * config so the form and the API can't drift.
 */

export const MOU_EVENT_TYPES = [
  "amasicon",
  "workshop",
  "rural-camp",
  "fmas",
  "mmas",
  "nextgen",
  "slcp",
] as const
export type MouEventType = (typeof MOU_EVENT_TYPES)[number]

export function isMouEventType(value: unknown): value is MouEventType {
  return typeof value === "string" && (MOU_EVENT_TYPES as readonly string[]).includes(value)
}

export type MouFieldKind = "text" | "textarea" | "number" | "select"

export interface MouField {
  key: string
  label: string
  kind: MouFieldKind
  required?: boolean
  help?: string
  placeholder?: string
  options?: { value: string; label: string }[]
  /** Grid width on sm+ screens. Defaults to "half". */
  span?: "half" | "full"
  maxLength?: number
  min?: number
  max?: number
}

export interface MouDeclaration {
  key: string
  text: string
}

/** How the proposed schedule is captured. */
export type MouScheduleMode = "year" | "date" | "date-range"

export interface MouEventConfig {
  slug: MouEventType
  /** Full display name. */
  name: string
  /** Compact name for tables and badges. */
  shortName: string
  /** Eyebrow shown above the page title. */
  eyebrow: string
  description: string
  /** Who decides: Executive Committee or General Body Meeting. */
  decidedBy: "ec" | "gbm"
  /** Public MOU PDF on amasi.org, or null when HQ issues the MOU on approval. */
  mouUrl: string | null
  scheduleMode: MouScheduleMode
  fields: MouField[]
  declarations: MouDeclaration[]
  /** Plain-language summary of the MOU obligations. */
  keyTerms: string[]
}

const AMASI_UPLOADS = "https://amasi.org/wp-content/uploads/2025/06"

const COURSE_HOST_FIELDS: MouField[] = [
  {
    key: "host_institution",
    label: "Host institution",
    kind: "text",
    required: true,
    span: "full",
    placeholder: "Hospital / college where the course will run",
    maxLength: 200,
  },
  {
    key: "course_coordinator",
    label: "Local course coordinator",
    kind: "text",
    required: true,
    placeholder: "Name and designation",
    maxLength: 160,
  },
  {
    key: "expected_participants",
    label: "Expected participants",
    kind: "number",
    required: true,
    min: 1,
    max: 5000,
  },
  {
    key: "training_facilities",
    label: "Training facilities available",
    kind: "textarea",
    required: true,
    span: "full",
    help: "Operating theatres, simulation or wet lab, audio-visual setup, seating capacity.",
    maxLength: 2000,
  },
  {
    key: "previous_amasi_events",
    label: "AMASI events hosted earlier (if any)",
    kind: "textarea",
    span: "full",
    maxLength: 1000,
  },
]

const COURSE_DECLARATIONS: MouDeclaration[] = [
  {
    key: "hq_consultation",
    text: "The programme, faculty and brochure will be finalised in consultation with, and approved by, AMASI HQ before anything is announced.",
  },
  {
    key: "mou_sign",
    text: "If approved, I will sign the MOU issued by AMASI HQ on every page and return it before the event is announced. The event is sanctioned only once HQ receives the signed MOU.",
  },
  {
    key: "faculty_members",
    text: "All faculty will be bonafide AMASI members; any faculty from other specialities will be intimated to AMASI in advance.",
  },
]

const COURSE_KEY_TERMS = [
  "AMASI alone sanctions use of its name and logo; both AMASI and ASI logos must appear on all print and digital material.",
  "Brochure design, programme and faculty selection need AMASI HQ approval.",
  "No bank account may be opened in the name of AMASI for the event.",
  "The host bears the full financial responsibility for the event.",
  "A report with photographs must reach the Hon. Secretary within 15 days of the event.",
]

export const MOU_EVENTS: Record<MouEventType, MouEventConfig> = {
  amasicon: {
    slug: "amasicon",
    name: "AMASICON — Annual Conference of AMASI",
    shortName: "AMASICON",
    eyebrow: "Annual conference",
    description:
      "Invite AMASI to hold its annual national conference in your city. Valid invitations are placed before the next General Body Meeting, where the organizing secretary presents the bid in person.",
    decidedBy: "gbm",
    mouUrl: `${AMASI_UPLOADS}/MOU-for-AMASICON.pdf`,
    scheduleMode: "year",
    fields: [
      {
        key: "organizing_chairman",
        label: "Proposed Organizing Chairman",
        kind: "text",
        required: true,
        placeholder: "Name (must be a full member of AMASI)",
        maxLength: 160,
      },
      {
        key: "proposed_month",
        label: "Preferred month / dates",
        kind: "text",
        placeholder: "e.g. second week of September",
        maxLength: 120,
      },
      {
        key: "expected_delegates",
        label: "Expected delegates",
        kind: "number",
        required: true,
        min: 100,
        max: 20000,
      },
      {
        key: "venue_capacity",
        label: "Venue halls and capacity",
        kind: "textarea",
        required: true,
        span: "full",
        help: "Main hall, parallel halls, live-surgery relay, trade exhibition area.",
        maxLength: 2000,
      },
      {
        key: "local_support",
        label: "Why this city, and local support available",
        kind: "textarea",
        required: true,
        span: "full",
        help: "Connectivity, hotel inventory, institutional backing, prior conferences hosted.",
        maxLength: 3000,
      },
    ],
    declarations: [
      {
        key: "mou_read",
        text: "I have gone through the draft MOU for AMASICON and, if selected, will abide by all its clauses.",
      },
      {
        key: "gbm_presentation",
        text: "I will personally present this bid at the General Body Meeting of AMASI when the item is taken up.",
      },
      {
        key: "oc_members",
        text: "The Organizing Chairman, Organizing Secretary, Treasurer, Joint Secretary and Finance Committee members will all be full members of AMASI.",
      },
    ],
    keyTerms: [
      "The MOU must be signed at least 12 months before the conference date, or the invitation lapses.",
      "AMASI decides the scientific programme; the organizing committee provides halls, audio-visual and staff.",
      "One dedicated bank account in the name of AMASICON (year), with GST and TAN registration; all collections go through it.",
      "AMASI advances seed money of up to ₹10 lakh, returnable within one month of the conference.",
      "Within three months: remit ₹5 lakh or 30% of registration fees, whichever is higher, with provisional accounts. Minimum guarantee to AMASI is ₹20 lakh of surplus; larger surpluses are shared as per the MOU.",
      "Office bearers list due one year before; facility details due nine months before; audited accounts within six months after.",
      "Local hospitality for the exemption list and AMASI office staff; EC members register at the lowest rate offered.",
    ],
  },

  workshop: {
    slug: "workshop",
    name: "Workshop / CME / Conference",
    shortName: "Workshop / CME",
    eyebrow: "Academic event",
    description:
      "Organise a workshop, CME or conference under the AMASI banner (other than AMASICON). The Executive Committee decides; HQ completes processing within two weeks of a complete application.",
    decidedBy: "ec",
    mouUrl: `${AMASI_UPLOADS}/MOU-for-Workshop-CME-Conference.pdf`,
    scheduleMode: "date-range",
    fields: [
      {
        key: "event_format",
        label: "Format",
        kind: "select",
        required: true,
        options: [
          { value: "workshop", label: "Workshop" },
          { value: "cme", label: "CME" },
          { value: "conference", label: "Conference" },
        ],
      },
      {
        key: "expected_participants",
        label: "Expected participants",
        kind: "number",
        required: true,
        min: 1,
        max: 5000,
      },
      {
        key: "theme",
        label: "Theme and proposed topics",
        kind: "textarea",
        required: true,
        span: "full",
        maxLength: 3000,
      },
      {
        key: "proposed_registration_fee",
        label: "Proposed registration fee (₹)",
        kind: "number",
        help: "Subject to AMASI approval.",
        min: 0,
        max: 100000,
      },
      {
        key: "non_amasi_faculty",
        label: "Faculty from other specialities (if any)",
        kind: "text",
        placeholder: "e.g. anaesthetist, gynaecologist",
        maxLength: 500,
      },
    ],
    declarations: [
      {
        key: "mou_read",
        text: "I have gone through the draft MOU for workshop/CME/conference and, if selected, will abide by all its clauses.",
      },
      {
        key: "faculty_members",
        text: "All faculty will be bonafide AMASI members; any faculty from other specialities will be intimated to AMASI in advance.",
      },
    ],
    keyTerms: [
      "Permission must be obtained from the Secretary, AMASI HQ before the programme is announced.",
      "Programme, speakers and registration fee are finalised only after AMASI approval.",
      "The organizer bears all costs, including travel, stay and food for AMASI faculty (AMASI covers travel for 2–3 faculty for state chapters of J&K, Uttarakhand, Himachal, Tripura, Meghalaya, Manipur, Nagaland, Arunachal, Mizoram and Sikkim).",
      "No bank account may be opened in the name of AMASI. No personal, hospital or political promotion at the event.",
      "Facility details due one month before; full programme and OC list due three weeks before; MOU signed at least 15 days before or the invitation lapses.",
      "Report with photographs within 15 days of the event.",
    ],
  },

  "rural-camp": {
    slug: "rural-camp",
    name: "Rural Surgery Camp",
    shortName: "Rural camp",
    eyebrow: "Community service",
    description:
      "Run a surgical camp in a hospital in a rural setting with AMASI faculty. AMASI supports approved camps with financial assistance of up to ₹1 lakh against original bills.",
    decidedBy: "ec",
    mouUrl: `${AMASI_UPLOADS}/MOU-for-Rural-Surgery-Camp.pdf`,
    scheduleMode: "date-range",
    fields: [
      {
        key: "hospital_name",
        label: "Hospital where the camp will be held",
        kind: "text",
        required: true,
        span: "full",
        maxLength: 200,
      },
      {
        key: "hospital_location",
        label: "Village / taluk / district",
        kind: "text",
        required: true,
        maxLength: 200,
      },
      {
        key: "nearest_railhead",
        label: "Nearest railway station / airport",
        kind: "text",
        required: true,
        maxLength: 160,
      },
      {
        key: "target_population",
        label: "Target population and how they benefit",
        kind: "textarea",
        required: true,
        span: "full",
        maxLength: 2000,
      },
      {
        key: "expected_surgeries",
        label: "Expected number of surgeries",
        kind: "number",
        required: true,
        min: 1,
        max: 5000,
      },
      {
        key: "facilities",
        label: "Operating theatre, anaesthesia and post-op facilities",
        kind: "textarea",
        required: true,
        span: "full",
        maxLength: 2000,
      },
    ],
    declarations: [
      {
        key: "mou_read",
        text: "I have gone through the draft MOU for rural surgical camp and, if selected, will abide by all its clauses.",
      },
      {
        key: "full_responsibility",
        text: "I take complete responsibility for organizing and executing the camp.",
      },
      {
        key: "rural_setting",
        text: "The camp will be held in a hospital located in a rural setting, not in an urban area.",
      },
    ],
    keyTerms: [
      "Permission must be obtained from the Secretary, AMASI HQ before the camp is announced.",
      "The organizer arranges instruments, disposables and staff, and may seek donations in cash or kind.",
      "AMASI faculty reach the nearest railhead or airport at their own cost; the organizer covers onward travel, stay and food.",
      "AMASI reimburses up to ₹1 lakh on original bills and vouchers.",
      "Facility details due one month before; programme and OC list due three weeks before; MOU signed at least 15 days before.",
      "Report with photographs, location, beneficiaries and number of surgeries within 15 days.",
    ],
  },

  fmas: {
    slug: "fmas",
    name: "FMAS Skill Course",
    shortName: "FMAS course",
    eyebrow: "Skill course",
    description:
      "Host a Fellowship in Minimal Access Surgery (FMAS) skill course at your institution. The Executive Committee decides; the MOU is issued by AMASI HQ on approval.",
    decidedBy: "ec",
    mouUrl: null,
    scheduleMode: "date-range",
    fields: COURSE_HOST_FIELDS,
    declarations: COURSE_DECLARATIONS,
    keyTerms: COURSE_KEY_TERMS,
  },

  mmas: {
    slug: "mmas",
    name: "MMAS Course",
    shortName: "MMAS course",
    eyebrow: "Skill course",
    description:
      "Host a Mastery in Minimal Access Surgery (MMAS) module — online lectures plus a physical meet — jointly designed by AMASI and the College of MAS.",
    decidedBy: "ec",
    mouUrl: null,
    scheduleMode: "date-range",
    fields: [
      {
        key: "specialization",
        label: "MMAS module",
        kind: "select",
        required: true,
        options: [
          { value: "colorectal", label: "MMAS Colorectal" },
          { value: "hpb", label: "MMAS HPB" },
          { value: "hernia", label: "MMAS Hernia" },
          { value: "upper-gi-bariatric", label: "MMAS Upper GI & Bariatric" },
        ],
      },
      ...COURSE_HOST_FIELDS,
    ],
    declarations: COURSE_DECLARATIONS,
    keyTerms: COURSE_KEY_TERMS,
  },

  nextgen: {
    slug: "nextgen",
    name: "The NextGen — Nurturing the Future",
    shortName: "NextGen",
    eyebrow: "Young surgeons programme",
    description:
      "Organise a NextGen programme for residents and young surgeons in your zone. The Executive Committee decides; the MOU is issued by AMASI HQ on approval.",
    decidedBy: "ec",
    mouUrl: null,
    scheduleMode: "date",
    fields: [
      {
        key: "host_institution",
        label: "Host institution",
        kind: "text",
        required: true,
        span: "full",
        maxLength: 200,
      },
      {
        key: "local_coordinator",
        label: "Local coordinator",
        kind: "text",
        required: true,
        placeholder: "Name and designation",
        maxLength: 160,
      },
      {
        key: "expected_participants",
        label: "Expected participants",
        kind: "number",
        required: true,
        min: 1,
        max: 2000,
      },
      {
        key: "target_audience",
        label: "Target audience",
        kind: "textarea",
        required: true,
        span: "full",
        help: "Which colleges / residency programmes / young surgeon groups will be invited.",
        maxLength: 2000,
      },
      {
        key: "training_facilities",
        label: "Hall, audio-visual and hands-on facilities",
        kind: "textarea",
        required: true,
        span: "full",
        maxLength: 2000,
      },
    ],
    declarations: COURSE_DECLARATIONS,
    keyTerms: COURSE_KEY_TERMS,
  },

  slcp: {
    slug: "slcp",
    name: "Safe Laparoscopic Cholecystectomy Programme (SLCP)",
    shortName: "SLCP",
    eyebrow: "Safety programme",
    description:
      "Host an AMASI SLCP — live surgical demonstrations, seven-plus hours of CME, panels and videos on safe laparoscopic gallbladder surgery. The Executive Committee decides; the MOU is issued by AMASI HQ on approval.",
    decidedBy: "ec",
    mouUrl: null,
    scheduleMode: "date-range",
    fields: [
      {
        key: "host_institution",
        label: "Host institution",
        kind: "text",
        required: true,
        span: "full",
        maxLength: 200,
      },
      {
        key: "course_coordinator",
        label: "Local coordinator",
        kind: "text",
        required: true,
        placeholder: "Name and designation",
        maxLength: 160,
      },
      {
        key: "expected_participants",
        label: "Expected participants",
        kind: "number",
        required: true,
        min: 1,
        max: 5000,
      },
      {
        key: "live_surgery",
        label: "Live surgery relay available?",
        kind: "select",
        required: true,
        options: [
          { value: "yes", label: "Yes — OT with relay to the hall" },
          { value: "no", label: "No — recorded videos only" },
        ],
      },
      {
        key: "training_facilities",
        label: "Operating theatre, relay and hall facilities",
        kind: "textarea",
        required: true,
        span: "full",
        maxLength: 2000,
      },
    ],
    declarations: COURSE_DECLARATIONS,
    keyTerms: COURSE_KEY_TERMS,
  },
}

export function getMouEvent(slug: string): MouEventConfig | null {
  return isMouEventType(slug) ? MOU_EVENTS[slug] : null
}

// ---------------------------------------------------------------------------
// Common (cross-event) vocab shared by the form and the validator
// ---------------------------------------------------------------------------

export const MOU_VENUE_TYPES = [
  {
    value: "institution",
    label: "The institution where I work",
    help: "Attach a consent letter from the Head of the institution.",
  },
  {
    value: "guest",
    label: "A guest institution",
    help: "Attach a consent letter from the Head of the guest institution.",
  },
  {
    value: "private",
    label: "A private hospital / institution",
    help: "Attach a brief about the institution.",
  },
] as const
export type MouVenueType = (typeof MOU_VENUE_TYPES)[number]["value"]

export const MOU_ATTACHMENT_KEYS = [
  "head_consent",
  "institution_brief",
  "partner_consent",
  "letterhead_letter",
  "other",
] as const
export type MouAttachmentKey = (typeof MOU_ATTACHMENT_KEYS)[number]

export const MOU_ATTACHMENT_LABELS: Record<MouAttachmentKey, string> = {
  head_consent: "Consent letter from the Head of the institution",
  institution_brief: "Brief about the institution",
  partner_consent: "Consent letter from the partner association",
  letterhead_letter: "Application letter on your letterhead (optional)",
  other: "Any other supporting document (optional)",
}

/** Which attachments are mandatory given the venue and partnership answers. */
export function requiredMouAttachments(input: {
  venueType: MouVenueType | ""
  jointWithAssociation: boolean
}): MouAttachmentKey[] {
  const keys: MouAttachmentKey[] = []
  if (input.venueType === "institution" || input.venueType === "guest") keys.push("head_consent")
  if (input.venueType === "private") keys.push("institution_brief")
  if (input.jointWithAssociation) keys.push("partner_consent")
  return keys
}

export const MOU_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "mou_sent",
  "mou_signed",
  "rejected",
  "withdrawn",
] as const
export type MouStatus = (typeof MOU_STATUSES)[number]

export function isMouStatus(value: unknown): value is MouStatus {
  return typeof value === "string" && (MOU_STATUSES as readonly string[]).includes(value)
}

export const MOU_STATUS_META: Record<
  MouStatus,
  { label: string; dot: string; applicantText: string }
> = {
  submitted: {
    label: "submitted",
    dot: "bg-warning",
    applicantText: "Received by AMASI HQ. Processing normally takes up to two weeks.",
  },
  under_review: {
    label: "under review",
    dot: "bg-primary",
    applicantText: "Being considered by the Executive Committee.",
  },
  approved: {
    label: "approved",
    dot: "bg-success",
    applicantText: "Approved. AMASI HQ will send you the MOU signed by the Hon. Secretary.",
  },
  mou_sent: {
    label: "MOU sent",
    dot: "bg-primary",
    applicantText:
      "The MOU has been sent to you. Print two copies, sign every page and return one copy to HQ.",
  },
  mou_signed: {
    label: "sanctioned",
    dot: "bg-success",
    applicantText: "Signed MOU received. The event is sanctioned.",
  },
  rejected: {
    label: "not approved",
    dot: "bg-destructive",
    applicantText: "Not approved this time. See the note from AMASI HQ.",
  },
  withdrawn: {
    label: "withdrawn",
    dot: "bg-muted-foreground",
    applicantText: "Withdrawn.",
  },
}

/** Statuses that count as "open" — a member can't file a second one for the same event while one is open. */
export const MOU_OPEN_STATUSES: readonly MouStatus[] = ["submitted", "under_review"]

export const MOU_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const MOU_MAX_ATTACHMENTS = 8
