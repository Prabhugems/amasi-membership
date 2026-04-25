import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getCredentialForMember, getTemplate } from "@/lib/credentials/queries"
import type { CredentialType } from "@/lib/credentials/types"

const VALID_TYPES: CredentialType[] = ["FMAS", "DIPMAS", "MMAS", "COURSE_CERT"]

export async function GET(request: NextRequest) {
  const idParam = request.nextUrl.searchParams.get("id")
  const typeParam = (request.nextUrl.searchParams.get("type") || "").toUpperCase()

  if (!idParam) {
    return Response.json({ status: false, message: "id required" }, { status: 400 })
  }
  if (!VALID_TYPES.includes(typeParam as CredentialType)) {
    return Response.json({ status: false, message: "invalid type" }, { status: 400 })
  }
  const amasiNumber = parseInt(idParam, 10)
  if (!Number.isFinite(amasiNumber)) {
    return Response.json({ status: false, message: "id must be numeric" }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`credential:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
  }

  try {
    const db = createAdminClient()
    const credential = await getCredentialForMember(db, amasiNumber, typeParam as CredentialType)
    if (!credential) {
      return Response.json(
        { status: false, message: "Credential not found" },
        { status: 404 }
      )
    }

    const template = await getTemplate(db, credential.credentialType, credential.year)
    if (!template) {
      console.error(
        `[api/credential] member ${amasiNumber} has ${typeParam} ${credential.year} but no template`
      )
      return Response.json(
        { status: false, message: "Template missing for this credential year" },
        { status: 500 }
      )
    }

    const { data: member, error: mErr } = await db
      .from("members")
      .select("name, amasi_number, email")
      .eq("amasi_number", amasiNumber)
      .single()
    if (mErr || !member) {
      return Response.json({ status: false, message: "Member not found" }, { status: 404 })
    }

    return Response.json({
      status: true,
      credential: {
        type: credential.credentialType,
        year: credential.year,
        skillCourseId: credential.skillCourseId,
        amasiNumber: member.amasi_number,
        name: member.name,
        email: member.email,
        templateUrl: template.templatePath,
        presidentName: template.presidentName,
        convocationPlace: template.convocationPlace,
        convocationDate: template.convocationDate,
      },
    })
  } catch (e) {
    console.error("[api/credential] error", e)
    return Response.json({ status: false, message: "Server error" }, { status: 500 })
  }
}
