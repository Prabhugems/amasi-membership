export interface MembershipType {
  id: string
  name: string
  shortName: string
  appPrefix: string
  fee: number
  feeCurrency: "INR" | "USD"
  processingFeePercent: number
  eligibility: string
  description: string
  requiredDocs: DocType[]
  requiresASI: boolean
  requiresPG: boolean
  requiresMBBS: boolean
  requiresHOD: boolean
  requiresActiveLicense: boolean
  votingRights: boolean
}

export type DocType =
  | "mci_certificate"
  | "pg_degree_certificate"
  | "mbbs_degree_certificate"
  | "asi_member_certificate"
  | "active_license"
  | "letter_hod"
  | "profile"

export const DOC_LABELS: Record<DocType, string> = {
  mci_certificate: "MCI / State Medical Council Certificate",
  pg_degree_certificate: "PG Degree Certificate",
  mbbs_degree_certificate: "MBBS Degree Certificate",
  asi_member_certificate: "ASI Membership Certificate",
  active_license: "Active Practice License",
  letter_hod: "Letter from HOD",
  profile: "Profile Photo",
}

export const MEMBERSHIP_TYPES: MembershipType[] = [
  {
    id: "LM",
    name: "Life Member",
    shortName: "LM",
    appPrefix: "L",
    fee: 4130,
    feeCurrency: "INR",
    processingFeePercent: 2.5,
    eligibility: "General surgeon practicing in India or SAARC countries, must be ASI member",
    description:
      "Full membership with voting rights. Can contest elections and participate in policy making.",
    requiredDocs: ["mci_certificate", "pg_degree_certificate", "asi_member_certificate", "profile"],
    requiresASI: true,
    requiresPG: true,
    requiresMBBS: false,
    requiresHOD: false,
    requiresActiveLicense: false,
    votingRights: true,
  },
  {
    id: "ALM",
    name: "Associate Life Member",
    shortName: "ALM",
    appPrefix: "AL",
    fee: 4130,
    feeCurrency: "INR",
    processingFeePercent: 2.5,
    eligibility: "Qualified surgeon, ASI membership not required",
    description:
      "Associate membership. Can convert to Life Member upon obtaining ASI membership.",
    requiredDocs: ["mci_certificate", "pg_degree_certificate", "profile"],
    requiresASI: false,
    requiresPG: true,
    requiresMBBS: false,
    requiresHOD: false,
    requiresActiveLicense: false,
    votingRights: false,
  },
  {
    id: "ACM",
    name: "Associate Candidate Member",
    shortName: "ACM",
    appPrefix: "AC",
    fee: 4130,
    feeCurrency: "INR",
    processingFeePercent: 2.5,
    eligibility: "Doctors currently pursuing postgraduate training",
    description:
      "For PG trainees. Becomes eligible for full Life Member upon completing qualifications.",
    requiredDocs: ["mci_certificate", "mbbs_degree_certificate", "letter_hod", "profile"],
    requiresASI: false,
    requiresPG: false,
    requiresMBBS: true,
    requiresHOD: true,
    requiresActiveLicense: false,
    votingRights: false,
  },
  {
    id: "ILM",
    name: "International Life Member",
    shortName: "ILM",
    appPrefix: "IL",
    fee: 300,
    feeCurrency: "USD",
    processingFeePercent: 2.5,
    eligibility: "Surgeons practicing outside India",
    description: "For international surgeons interested in minimal access surgery.",
    requiredDocs: ["active_license", "pg_degree_certificate", "profile"],
    requiresASI: false,
    requiresPG: true,
    requiresMBBS: false,
    requiresHOD: false,
    requiresActiveLicense: true,
    votingRights: false,
  },
]

export function getMembershipType(id: string): MembershipType | undefined {
  return MEMBERSHIP_TYPES.find((t) => t.id === id)
}

export function calculateFee(type: MembershipType): {
  baseFee: number
  processingFee: number
  totalFee: number
  currency: string
} {
  const baseFee = type.fee
  const processingFee = Math.round(baseFee * (type.processingFeePercent / 100))
  return {
    baseFee,
    processingFee,
    totalFee: baseFee + processingFee,
    currency: type.feeCurrency === "INR" ? "\u20B9" : "$",
  }
}

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const

export const STATE_TO_ZONE: Record<string, string> = {
  "Tamil Nadu": "South Zone", "Kerala": "South Zone", "Karnataka": "South Zone",
  "Andhra Pradesh": "South Zone", "Telangana": "South Zone", "Puducherry": "South Zone",
  "Lakshadweep": "South Zone",
  "Delhi": "North Zone", "Uttar Pradesh": "North Zone", "Haryana": "North Zone",
  "Punjab": "North Zone", "Himachal Pradesh": "North Zone", "Uttarakhand": "North Zone",
  "Jammu and Kashmir": "North Zone", "Ladakh": "North Zone", "Chandigarh": "North Zone",
  "Rajasthan": "North Zone",
  "Maharashtra": "West Zone", "Gujarat": "West Zone", "Goa": "West Zone",
  "Madhya Pradesh": "West Zone", "Chhattisgarh": "West Zone",
  "Dadra and Nagar Haveli and Daman and Diu": "West Zone",
  "West Bengal": "East Zone", "Odisha": "East Zone", "Bihar": "East Zone",
  "Jharkhand": "East Zone", "Assam": "East Zone", "Meghalaya": "East Zone",
  "Tripura": "East Zone", "Manipur": "East Zone", "Mizoram": "East Zone",
  "Nagaland": "East Zone", "Arunachal Pradesh": "East Zone", "Sikkim": "East Zone",
  "Andaman and Nicobar Islands": "East Zone",
}

export interface ApplicationFormData {
  membershipType: string
  salutation: string
  firstName: string
  middleName: string
  lastName: string
  dob: string
  gender: string
  email: string
  mobileCode: string
  mobile: string
  fatherName: string
  nationality: string
  streetLine1: string
  streetLine2: string
  city: string
  state: string
  pin: string
  zone: string
  country: string
  eduUndergradDegree: string
  eduUndergradCollege: string
  eduUndergradUniversity: string
  eduUndergradYear: string
  eduPostgradDegree: string
  eduPostgradCollege: string
  eduPostgradUniversity: string
  eduPostgradYear: string
  eduSuperspecialtyDegree: string
  eduSuperspecialtyCollege: string
  eduSuperspecialtyUniversity: string
  eduSuperspecialtyYear: string
  mciCouncilNumber: string
  mciCouncilState: string
  imrRegNo: string
  asiMembershipNo: string
  asiState: string
  documents: Record<string, DocumentUpload>
}

export interface DocumentUpload {
  file: File | null
  preview: string
  ocrResult: OCRVerification | null
  uploading: boolean
}

export interface OCRVerification {
  verified: boolean
  extractedText: string
  matchedField: string
  confidence: "high" | "medium" | "low"
  message: string
}

export const INITIAL_FORM_DATA: ApplicationFormData = {
  membershipType: "",
  salutation: "Dr.",
  firstName: "",
  middleName: "",
  lastName: "",
  dob: "",
  gender: "",
  email: "",
  mobileCode: "+91",
  mobile: "",
  fatherName: "",
  nationality: "Indian",
  streetLine1: "",
  streetLine2: "",
  city: "",
  state: "",
  pin: "",
  zone: "",
  country: "India",
  eduUndergradDegree: "",
  eduUndergradCollege: "",
  eduUndergradUniversity: "",
  eduUndergradYear: "",
  eduPostgradDegree: "",
  eduPostgradCollege: "",
  eduPostgradUniversity: "",
  eduPostgradYear: "",
  eduSuperspecialtyDegree: "",
  eduSuperspecialtyCollege: "",
  eduSuperspecialtyUniversity: "",
  eduSuperspecialtyYear: "",
  mciCouncilNumber: "",
  mciCouncilState: "",
  imrRegNo: "",
  asiMembershipNo: "",
  asiState: "",
  documents: {},
}
