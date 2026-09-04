// The 10 states where AMASI funds 2-3 faculty's to-and-fro transport for a
// state-chapter-organised Workshop/CME/Conference (clause 17 of the
// Workshop/CME/Conference MOU — see WORKSHOP_CLAUSES in mou-pdf.tsx).
// Named export, not inlined into event-type-config.ts, because the EC
// changes this list from time to time (per the workshop spec's explicit
// "keep the eligible-state list in config, not in the component"
// requirement) — one place to edit. Spelling matches INDIAN_STATES exactly
// (src/lib/membership-types.ts) so a straight equality check against
// venue_state works with no normalization step.
export const SMALL_STATE_CHAPTER_STATES: string[] = [
  "Jammu and Kashmir",
  "Uttarakhand",
  "Himachal Pradesh",
  "Tripura",
  "Meghalaya",
  "Manipur",
  "Nagaland",
  "Arunachal Pradesh",
  "Mizoram",
  "Sikkim",
]
