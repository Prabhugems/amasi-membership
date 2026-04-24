export type CampaignCategory = "marketing" | "statutory"

export type CampaignStatus = "draft" | "sending" | "paused" | "completed"

export interface MemberSegmentRow {
  id: string
  amasi_number: number
  name: string | null
  email: string
  pg_degree: string | null
  profile_photo: string | null
  date_of_birth: string | null
  membership_type: string | null
  marketing_opt_out_at: string | null
}

export const MEMBER_SEGMENT_COLUMNS =
  "id,amasi_number,name,email,pg_degree,profile_photo,date_of_birth,membership_type,marketing_opt_out_at"

export interface TemplateEntry {
  key: string
  name: string
  category: CampaignCategory
  targetFields: (keyof MemberSegmentRow)[]
  buildSegment: (
    query: any
  ) => any
  subject: (m: MemberSegmentRow) => string
  html: (m: MemberSegmentRow, ctx: { baseUrl: string }) => string
}

export interface CampaignRow {
  id: string
  template_key: string
  name: string
  category: CampaignCategory
  target_fields: string[]
  status: CampaignStatus
  created_by: string | null
  created_at: string
  completed_at: string | null
}

export interface CampaignRecipientRow {
  id: string
  campaign_id: string
  member_id: string
  email: string
  amasi_number: number | null
  name: string | null
  sent_at: string | null
  send_error: string | null
  update_detected_at: string | null
  created_at: string
}
