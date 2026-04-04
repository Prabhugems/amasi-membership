import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getMemberSession, getAdminSession } from "@/lib/auth"

const VALID_DOC_TYPES = new Set([
  "profile_photo",
  "mci_certificate",
  "pg_degree_certificate",
  "asi_member_certificate",
  "mbbs_degree_certificate",
  "active_license",
  "letter_hod",
])

export async function POST(request: NextRequest) {
  try {
    const adminSession = await getAdminSession()
    const memberSession = await getMemberSession()
    if (!adminSession && !memberSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const memberId = formData.get("memberId") as string | null
    const docType = formData.get("docType") as string | null

    if (!file || !memberId || !docType) {
      return Response.json(
        { status: false, message: "Missing file, memberId, or docType" },
        { status: 400 }
      )
    }

    if (!VALID_DOC_TYPES.has(docType)) {
      return Response.json(
        { status: false, message: "Invalid document type" },
        { status: 400 }
      )
    }

    // Validate file size (5 MB max)
    if (file.size > 5 * 1024 * 1024) {
      return Response.json(
        { status: false, message: "File too large. Maximum 5 MB." },
        { status: 400 }
      )
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "bin"
    const timestamp = Date.now()
    const storagePath = `members/${memberId}/${docType}_${timestamp}.${ext}`

    const supabase = createAdminClient()

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error("Storage upload error:", uploadError)
      return Response.json(
        { status: false, message: "Failed to upload file" },
        { status: 500 }
      )
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from("uploads")
      .getPublicUrl(storagePath)

    const publicUrl = urlData.publicUrl

    // Update the member's document column
    const { error: updateError } = await supabase
      .from("members")
      .update({ [docType]: publicUrl, updated_at: new Date().toISOString() })
      .eq("id", memberId)

    if (updateError) {
      console.error("DB update error:", updateError)
      return Response.json(
        { status: false, message: "File uploaded but failed to update record" },
        { status: 500 }
      )
    }

    return Response.json({ status: true, url: publicUrl })
  } catch (error: any) {
    console.error("Upload error:", error)
    return Response.json(
      { status: false, message: "Upload failed" },
      { status: 500 }
    )
  }
}
