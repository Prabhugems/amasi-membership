import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { getAuthUrl, getAccessToken, zohoApi } from "@/lib/zoho"

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const action = request.nextUrl.searchParams.get("action")

    if (action === "status") {
      const token = await getAccessToken()
      return Response.json({ connected: !!token })
    }

    if (action === "lists") {
      const data = await zohoApi("/getmailinglists?resfmt=JSON&range=100")
      return Response.json(data)
    }

    return Response.json({ error: "Unknown action" }, { status: 400 })
  } catch (error: any) {
    console.error("[zoho] GET error:", error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { action } = body

    // --- Connect: return OAuth URL ---
    if (action === "connect") {
      const url = getAuthUrl()
      return Response.json({ url })
    }

    // --- Disconnect: delete tokens ---
    if (action === "disconnect") {
      const supabase = createAdminClient()
      await supabase.from("zoho_tokens").delete().eq("id", "default")
      return Response.json({ success: true })
    }

    // --- Add single contact ---
    if (action === "add_contact") {
      const { email, firstName, lastName, phone, membershipType, listKey } = body
      if (!email || !listKey) {
        return Response.json({ error: "email and listKey are required" }, { status: 400 })
      }

      const contactInfo: Record<string, string> = {
        "Contact Email": email,
      }
      if (firstName) contactInfo["First Name"] = firstName
      if (lastName) contactInfo["Last Name"] = lastName
      if (phone) contactInfo["Phone"] = phone
      if (membershipType) contactInfo["Membership Type"] = membershipType

      const data = await zohoApi("/json/listsubscribe", {
        method: "POST",
        body: new URLSearchParams({
          resfmt: "JSON",
          listkey: listKey,
          contactinfo: JSON.stringify(contactInfo),
        }),
      })

      return Response.json(data)
    }

    // --- Sync all members to a Zoho list ---
    if (action === "sync") {
      const { listKey } = body
      if (!listKey) {
        return Response.json({ error: "listKey is required" }, { status: 400 })
      }

      const supabase = createAdminClient()

      // Fetch all members with real emails
      const { data: members, error } = await supabase
        .from("members")
        .select("email, name, phone, membership_type")
        .not("email", "like", "noemail-%")
        .not("email", "is", null)

      if (error) {
        return Response.json({ error: "Failed to fetch members" }, { status: 500 })
      }

      const validMembers = (members || []).filter((m) => m.email)
      let synced = 0
      let failed = 0

      // Process in batches of 10
      for (let i = 0; i < validMembers.length; i += 10) {
        const batch = validMembers.slice(i, i + 10)

        const contactDetails = batch.map((m) => {
          const parts = (m.name || "").split(" ")
          return {
            "Contact Email": m.email,
            "First Name": parts[0] || "",
            "Last Name": parts.slice(1).join(" ") || "",
            "Phone": m.phone || "",
            "Membership Type": m.membership_type || "",
          }
        })

        try {
          await zohoApi("/json/addlistsubscribersinbulk", {
            method: "POST",
            body: new URLSearchParams({
              resfmt: "JSON",
              listkey: listKey,
              emailids: JSON.stringify(contactDetails),
            }),
          })
          synced += batch.length
        } catch (err) {
          console.error(`[zoho] Batch sync error at offset ${i}:`, err)
          failed += batch.length
        }
      }

      return Response.json({ success: true, synced, failed, total: validMembers.length })
    }

    return Response.json({ error: "Unknown action" }, { status: 400 })
  } catch (error: any) {
    console.error("[zoho] POST error:", error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
