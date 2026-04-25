export type CredentialType = "FMAS" | "DIPMAS" | "MMAS" | "COURSE_CERT"

export interface MemberCredential {
  amasiNumber: number
  credentialType: CredentialType
  year: number
  skillCourseId: number | null
  awardedAt: string | null
  createdAt: string
}

export interface CredentialTemplate {
  credentialType: CredentialType
  year: number
  templatePath: string
  presidentName: string | null
  convocationDate: string | null
  convocationPlace: string | null
  nameTopPct: number | null
  nameFontSizePx: number | null
}

// Shape of an Airtable FMASIANS row (only the fields we care about).
// `skillCourseRecordId` is the Airtable record id (e.g. "recga0FTGLyZDigYd");
// the seed script resolves it to the numeric `Skill course Number` via the
// Skill Course table lookup.
export interface AirtableFmasianRow {
  id: string
  name: string
  amasiNumber: number | null
  yearOfConvocation: number | null
  skillCourseRecordId: string | null
}

// Shape of an Airtable Skill Course row.
export interface AirtableSkillCourseRow {
  id: string
  skillCourseNumber: number
  yearOfFmas: number | null
  presidentName: string | null
  convocationDateAndPlace: string | null
  fmasCertificateAttachmentUrl: string | null
  fmasCertificateFilename: string | null
}
