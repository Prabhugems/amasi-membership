import type { ApplicationTypeId } from "./types"

// National Director FYI recipients, keyed by the application type they hold
// a portfolio for — only the 3 MOU types with a matching seat on the EC
// 2026-28 roster (sql/044_academic_event_director_roles.sql). Every other
// co-opted portfolio (HPB, Hernia, Endoscopy, Colorectal, Newsletter,
// Membership Drive, Proctology, AMASAS Journal, Armed Forces) has no
// corresponding academic_event_types row.
//
// Single source of truth — used both when notifying on submission
// (src/app/api/mou/applications/route.ts) and when escalating an overdue
// post-event report (src/lib/mou-report-reminders.ts). Keep them in sync
// by importing from here rather than redeclaring the map.
export const DIRECTOR_ROLE_BY_APPLICATION_TYPE: Partial<Record<ApplicationTypeId, string>> = {
  fmas: "director_fmas",
  nextgen: "director_nextgen",
  slcp: "director_slcp",
}

// Associate/Assistant Directors under the primary National Director above —
// also FYI'd on submission, per
// sql/045_academic_event_associate_director_roles.sql. fmas has none;
// nextgen has 2 Associate Directors; slcp has 1 Assistant Director. Not
// used for the report escalation — that stays scoped to the primary
// director only, to keep the overdue-report nudge tight.
export const ASSOCIATE_DIRECTOR_ROLES_BY_APPLICATION_TYPE: Partial<Record<ApplicationTypeId, string[]>> = {
  nextgen: ["director_nextgen_associate_1", "director_nextgen_associate_2"],
  slcp: ["director_slcp_assistant"],
}
