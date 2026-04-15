import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const { path } = await request.json()
    if (!path || typeof path !== "string") {
      return Response.json({ error: "Missing path" }, { status: 400 })
    }

    // Only allow paths within the uploads bucket
    if (path.includes("..") || path.startsWith("/")) {
      return Response.json({ error: "Invalid path" }, { status: 400 })
    }

    const supabase = createAdminClient()
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
