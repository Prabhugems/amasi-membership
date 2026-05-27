// Static geo lookup for the legacy mobile shim.
//
// The Flutter v1.0.4+2 binary expects numeric ids in apply-form country/state
// dropdowns. The legacy backend served these from MySQL `countries` / `states`
// tables. amasi-membership doesn't keep that structure — we expose a static
// list here so /api/get_country and /api/get_state can respond, and shim
// member_two translates the numeric ids back to names before writing the
// draft (so the web portal continues to see strings like "India" / "Tamil Nadu").
//
// Scope for the initial cutover: India (101) + the 5 most common origin
// countries for AMASI international applicants. State coverage is India-only;
// other countries return an empty list (Flutter UI shows an empty dropdown).
// Expand as needed.

export type ShimCountry = {
  id: number
  country_name: string
  country_code: string
  status: 1
}

export type ShimState = {
  id: number
  country_id: number
  name: string
  status: 1
}

export const COUNTRIES: ShimCountry[] = [
  { id: 101, country_name: "India", country_code: "+91", status: 1 },
  { id: 233, country_name: "United States", country_code: "+1", status: 1 },
  { id: 230, country_name: "United Kingdom", country_code: "+44", status: 1 },
  { id: 38, country_name: "Canada", country_code: "+1", status: 1 },
  { id: 13, country_name: "Australia", country_code: "+61", status: 1 },
  { id: 195, country_name: "Singapore", country_code: "+65", status: 1 },
  { id: 144, country_name: "Nepal", country_code: "+977", status: 1 },
  { id: 18, country_name: "Bangladesh", country_code: "+880", status: 1 },
  { id: 184, country_name: "Sri Lanka", country_code: "+94", status: 1 },
  { id: 220, country_name: "United Arab Emirates", country_code: "+971", status: 1 },
]

export const STATES: ShimState[] = [
  // India (28 states + 8 UTs)
  { id: 4001, country_id: 101, name: "Andhra Pradesh", status: 1 },
  { id: 4002, country_id: 101, name: "Arunachal Pradesh", status: 1 },
  { id: 4003, country_id: 101, name: "Assam", status: 1 },
  { id: 4004, country_id: 101, name: "Bihar", status: 1 },
  { id: 4005, country_id: 101, name: "Chhattisgarh", status: 1 },
  { id: 4006, country_id: 101, name: "Goa", status: 1 },
  { id: 4007, country_id: 101, name: "Gujarat", status: 1 },
  { id: 4008, country_id: 101, name: "Haryana", status: 1 },
  { id: 4009, country_id: 101, name: "Himachal Pradesh", status: 1 },
  { id: 4010, country_id: 101, name: "Jharkhand", status: 1 },
  { id: 4011, country_id: 101, name: "Karnataka", status: 1 },
  { id: 4012, country_id: 101, name: "Kerala", status: 1 },
  { id: 4013, country_id: 101, name: "Madhya Pradesh", status: 1 },
  { id: 4014, country_id: 101, name: "Maharashtra", status: 1 },
  { id: 4015, country_id: 101, name: "Manipur", status: 1 },
  { id: 4016, country_id: 101, name: "Meghalaya", status: 1 },
  { id: 4017, country_id: 101, name: "Mizoram", status: 1 },
  { id: 4018, country_id: 101, name: "Nagaland", status: 1 },
  { id: 4019, country_id: 101, name: "Odisha", status: 1 },
  { id: 4020, country_id: 101, name: "Punjab", status: 1 },
  { id: 4021, country_id: 101, name: "Rajasthan", status: 1 },
  { id: 4022, country_id: 101, name: "Sikkim", status: 1 },
  { id: 4023, country_id: 101, name: "Tamil Nadu", status: 1 },
  { id: 4024, country_id: 101, name: "Telangana", status: 1 },
  { id: 4025, country_id: 101, name: "Tripura", status: 1 },
  { id: 4026, country_id: 101, name: "Uttar Pradesh", status: 1 },
  { id: 4027, country_id: 101, name: "Uttarakhand", status: 1 },
  { id: 4028, country_id: 101, name: "West Bengal", status: 1 },
  { id: 4029, country_id: 101, name: "Andaman and Nicobar Islands", status: 1 },
  { id: 4030, country_id: 101, name: "Chandigarh", status: 1 },
  { id: 4031, country_id: 101, name: "Dadra and Nagar Haveli and Daman and Diu", status: 1 },
  { id: 4032, country_id: 101, name: "Delhi", status: 1 },
  { id: 4033, country_id: 101, name: "Jammu and Kashmir", status: 1 },
  { id: 4034, country_id: 101, name: "Ladakh", status: 1 },
  { id: 4035, country_id: 101, name: "Lakshadweep", status: 1 },
  { id: 4036, country_id: 101, name: "Puducherry", status: 1 },
]

export function findCountry(id: number): ShimCountry | null {
  return COUNTRIES.find((c) => c.id === id) ?? null
}

export function findState(id: number): ShimState | null {
  return STATES.find((s) => s.id === id) ?? null
}

export function statesForCountry(countryId: number): ShimState[] {
  return STATES.filter((s) => s.country_id === countryId)
}
