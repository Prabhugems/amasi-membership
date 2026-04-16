import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"

const MEMBER_PATH_REGEX = /^members\/[a-f0-9-]{8,}\//i

export async function POST(request: NextRequest) {
  try {
    // Session gate — accept either admin or member session
    const adminSession = await getAdminSession()
    const memberSession = await getMemberSession()
    if (!adminSession && !memberSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { path } = await request.json()
    if (!path || typeof path !== "string") {
      return Response.json({ error: "Missing path" }, { status: 400 })
    }

    // Only allow paths within the uploads bucket
    if (path.includes("..") || path.startsWith("/")) {
      return Response.json({ error: "Invalid path" }, { status: 400 })
    }

    // Defensive path format check — must be members/{uuid-ish}/...
    if (!MEMBER_PATH_REGEX.test(path)) {
      return Response.json({ error: "Invalid path" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // If caller is a member (not admin), enforce path ownership
    if (!adminSession && memberSession) {
      const memberEmail = typeof memberSession.email === "string" ? memberSession.email : null
      if (!memberEmail) {
        return Response.json({ error: "Forbidden" }, { status: 403 })
      }

      const { data: memberRow } = await supabase
        .from("members")
        .select("id")
        .eq("email", memberEmail)
        .maybeSingle()

      const memberId = memberRow?.id
      if (!memberId) {
        return Response.json({ error: "Forbidden" }, { status: 403 })
      }

      const expectedPrefix = `members/${memberId}/`
      if (!path.startsWith(expectedPrefix)) {
        return Response.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const { data, error } = await supabase.storage
      .from("uploads")
      .createSignedUrl(path, 3600) // 1 hour

    if (error || !data?.signedUrl) {
      // Fallback: try public URL if bucket is still public
      const { data: publicData } = supabase.storage.from("uploads").getPublicUrl(path)
      if (publicData?.publicUrl) {
        return Response.json({ url: publicData.publicUrl })
      }
      return Response.json({ error: "Could not generate URL" }, { status: 500 })
    }

    return Response.json({ url: data.signedUrl })
  } catch (error: any) {
    return Response.json({ error: "Failed to generate URL" }, { status: 500 })
  }
}
