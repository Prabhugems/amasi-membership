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
    const memberSession = adminSession ? null : await getMemberSession()
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

    // IDOR protection: if caller is a member (not admin), verify ownership
    if (!adminSession && memberSession) {
      const memberEmail = typeof memberSession.email === "string" ? memberSession.email : null
      if (!memberEmail) {
        return Response.json({ error: "Forbidden" }, { status: 403 })
      }
      const supabaseCheck = createAdminClient()
      const { data: memberRow } = await supabaseCheck
        .from("members")
        .select("id")
        .eq("email", memberEmail)
        .maybeSingle()
      if (!memberRow || memberRow.id !== memberId) {
        return Response.json({ error: "Forbidden" }, { status: 403 })
      }
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

    // Validate file type by magic bytes (not just extension)
    const headerBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    const isJPEG = headerBytes[0] === 0xFF && headerBytes[1] === 0xD8
    const isPNG = headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4E && headerBytes[3] === 0x47
    const isPDF = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && headerBytes[2] === 0x44 && headerBytes[3] === 0x46
    if (!isJPEG && !isPNG && !isPDF) {
      return Response.json(
        { status: false, message: "Invalid file format. Only JPG, PNG, and PDF files are accepted." },
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

    // Store the path (not public URL) — use signed URLs for access
    const docUrl = storagePath

    // Update the member's document column with storage path
    const { error: updateError } = await supabase
      .from("members")
      .update({ [docType]: docUrl, updated_at: new Date().toISOString() })
      .eq("id", memberId)

    if (updateError) {
      console.error("DB update error:", updateError)
      return Response.json(
        { status: false, message: "File uploaded but failed to update record" },
        { status: 500 }
      )
    }

    // Generate a signed URL for immediate use (valid 1 hour)
    const { data: signedData } = await supabase.storage
      .from("uploads")
      .createSignedUrl(storagePath, 3600)

    return Response.json({ status: true, url: signedData?.signedUrl || docUrl, storagePath: docUrl })
  } catch (error: any) {
    console.error("Upload error:", error)
    return Response.json(
      { status: false, message: "Upload failed" },
      { status: 500 }
    )
  }
}
