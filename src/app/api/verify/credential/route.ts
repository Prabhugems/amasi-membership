import type { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { readVerifyToken } from "@/lib/credentials/verify-token"

interface VerifyResponse {
  valid: boolean
  reason?: string
  member?: {
    name: string | null
    amasi_number: number
    profile_photo: string | null
  }
  credential?: {
    type: "FMAS" | "MMAS" | "DIPMAS" | "COURSE_CERT"
    course_id: number | null
    course_name: string | null
    course_place: string | null
    year: number
    awarded_at: string | null
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) {
    return Response.json({ valid: false, reason: "Missing token" } satisfies VerifyResponse, { status: 400 })
  }

  const payload = await readVerifyToken(token)
  if (!payload) {
    return Response.json({ valid: false, reason: "Invalid or expired link" } satisfies VerifyResponse, { status: 400 })
  }

  const db = createAdminClient()

  // Pull the most recent matching credential for this member + type.
  const { data: cred, error: credErr } = await db
    .from("member_credentials")
    .select("amasi_number, credential_type, year, skill_course_id, awarded_at")
    .eq("amasi_number", payload.amasi)
    .eq("credential_type", payload.type)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (credErr) {
    return Response.json({ valid: false, reason: "Lookup failed" } satisfies VerifyResponse, { status: 500 })
  }
  if (!cred) {
    return Response.json({ valid: false, reason: "Credential not found" } satisfies VerifyResponse, { status: 404 })
  }

  const [memberRes, courseRes] = await Promise.all([
    db
      .from("members")
      .select("amasi_number, name, profile_photo")
      .eq("amasi_number", cred.amasi_number)
      .maybeSingle(),
    cred.skill_course_id !== null
      ? db
          .from("skill_courses")
          .select("id, name, place")
          .eq("id", cred.skill_course_id)
          .eq("credential_type", cred.credential_type)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const member = memberRes.data
  const course = courseRes.data as { id: number; name: string; place: string | null } | null

  return Response.json({
    valid: true,
    member: {
      name: member?.name ?? null,
      amasi_number: cred.amasi_number,
      profile_photo: member?.profile_photo ?? null,
    },
    credential: {
      type: cred.credential_type,
      course_id: cred.skill_course_id,
      course_name: course?.name ?? null,
      course_place: course?.place ?? null,
      year: cred.year,
      awarded_at: cred.awarded_at,
    },
  } satisfies VerifyResponse)
}
