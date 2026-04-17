import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 10 uploads per 15 min per IP to prevent storage abuse
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = checkRateLimit(`ticket-upload:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ error: "Too many uploads. Try again later." }, { status: 429 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const ticketPath = formData.get("path") as string | null // e.g. "tickets/TKT-xxx/filename.pdf"

    if (!file || file.size === 0) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: "File exceeds 10 MB limit" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return Response.json(
        { error: "Only PNG, JPG, WebP, and PDF files are allowed" },
        { status: 400 }
      )
    }

    if (!ticketPath || typeof ticketPath !== "string" || !ticketPath.startsWith("tickets/")) {
      return Response.json({ error: "Invalid upload path" }, { status: 400 })
    }

    // Prevent path traversal
    if (ticketPath.includes("..") || ticketPath.startsWith("/")) {
      return Response.json({ error: "Invalid path" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const fileBuffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await supabase.storage
      .from("uploads")
      .upload(ticketPath, fileBuffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadErr) {
      console.error("Ticket file upload failed:", uploadErr.message)
      return Response.json({ error: "Upload failed" }, { status: 500 })
    }

    // Generate a long-lived signed URL (30 days)
    const { data: signedData } = await supabase.storage
      .from("uploads")
      .createSignedUrl(ticketPath, 86400 * 30)

    const url = signedData?.signedUrl
    if (!url) {
      // Fallback to public URL
      const { data: publicData } = supabase.storage.from("uploads").getPublicUrl(ticketPath)
      return Response.json({
        url: publicData?.publicUrl || "",
        filename: file.name,
        size: file.size,
      })
    }

    return Response.json({
      url,
      filename: file.name,
      size: file.size,
    })
  } catch (err) {
    console.error("Ticket upload error:", err)
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
