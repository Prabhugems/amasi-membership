import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

/**
 * GET /api/tickets/csat?token=...&rating=1-5
 * Called from email links — records rating and redirects to thank-you page.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get("token")
    const ratingStr = searchParams.get("rating")

    if (!token || !ratingStr) {
      return Response.json({ error: "Missing token or rating" }, { status: 400 })
    }

    const rating = parseInt(ratingStr, 10)
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return Response.json({ error: "Rating must be 1-5" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Look up ticket by csat_token
    const { data: ticket, error: lookupErr } = await supabase
      .from("support_tickets")
      .select("id, csat_rating, csat_token")
      .eq("csat_token", token)
      .single()

    if (lookupErr || !ticket) {
      return Response.json({ error: "Invalid or expired token" }, { status: 404 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://amasi-membership.vercel.app"

    // Already rated
    if (ticket.csat_rating !== null) {
      return Response.redirect(`${baseUrl}/support/feedback?already=1&rating=${ticket.csat_rating}`)
    }

    // Save rating
    const { error: updateErr } = await supabase
      .from("support_tickets")
      .update({ csat_rating: rating })
      .eq("id", ticket.id)

    if (updateErr) {
      return Response.json({ error: "Failed to save rating" }, { status: 500 })
    }

    return Response.redirect(`${baseUrl}/support/feedback?rating=${rating}&token=${token}`)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tickets/csat
 * Accepts { token, rating, comment } for the optional comment form.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, rating, comment } = body

    if (!token) {
      return Response.json({ error: "Missing token" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Look up ticket
    const { data: ticket, error: lookupErr } = await supabase
      .from("support_tickets")
      .select("id, csat_rating, csat_token")
      .eq("csat_token", token)
      .single()

    if (lookupErr || !ticket) {
      return Response.json({ error: "Invalid or expired token" }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}

    // Allow setting rating via POST if not already rated
    if (rating !== undefined) {
      const r = parseInt(String(rating), 10)
      if (isNaN(r) || r < 1 || r > 5) {
        return Response.json({ error: "Rating must be 1-5" }, { status: 400 })
      }
      if (ticket.csat_rating === null) {
        updates.csat_rating = r
      }
    }

    // Always allow adding/updating comment
    if (comment && typeof comment === "string") {
      updates.csat_comment = comment.slice(0, 2000)
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 })
    }

    const { error: updateErr } = await supabase
      .from("support_tickets")
      .update(updates)
      .eq("id", ticket.id)

    if (updateErr) {
      return Response.json({ error: "Failed to save feedback" }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
