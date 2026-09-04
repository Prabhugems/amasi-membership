import type { ApplicationTypeId } from "./types"

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

// Common to every type regardless of this list: organizer_name, email,
// phone_number, primary_institution, preferred_date_1/2, venue_*,
// agree_terms, certify_accurate, authority_confirm. Only the EXTRA
// fields per type are listed here — src/components/mou/application-form.tsx
// always renders the common set, then conditionally renders these.
export const EVENT_TYPE_CONFIG: Record<ApplicationTypeId, EventTypeUiConfig> = {
  fmas: {
    id: "fmas", label: "FMAS Course", description: "Fellowship in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  mmas: {
    id: "mmas", label: "MMAS Course", description: "Mastery in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  dmas: {
    id: "dmas", label: "DMAS Course", description: "Diploma in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  slcp: {
    id: "slcp", label: "Safe Laparoscopic Cholecystectomy Programme", description: "SLCP hosting application",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo",
      "high_speed_internet", "expected_participants", "live_surgery_demo"],
  },
  workshop: {
    id: "workshop", label: "Workshop / CME / Conference", description: "AMASI workshop, CME, or conference hosting application",
    fields: ["event_name", "expected_participants", "live_surgery_demo"],
  },
  rural_program: {
    id: "rural_program", label: "Rural Surgery Camp", description: "Rural Surgery Camp hosting application",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  nextgen: {
    id: "nextgen", label: "NextGen Organizer", description: "AMASI NextGen: Nurturing the Future hosting application",
    fields: ["committee_member_photo"],
  },
  meet_the_master: {
    id: "meet_the_master", label: "Meet the Master", description: "A Day with a Master hosting application",
    fields: ["event_name", "expected_participants", "live_surgery_demo"],
    pendingContent: true,
  },
  zonal_event: {
    id: "zonal_event", label: "Zonal Event", description: "A zone-specific AMASI event",
    fields: ["event_name", "zone", "expected_participants"],
    pendingContent: true,
  },
}

export function getEventTypeConfig(id: string): EventTypeUiConfig | null {
  return (EVENT_TYPE_CONFIG as Record<string, EventTypeUiConfig>)[id] ?? null
}
