import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

async function fetchAllBatched<T>(
  queryFn: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: any }>,
  batchSize = 1000,
  hardCap = 50000
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (offset < hardCap) {
    const { data: batch, error } = await queryFn(offset, batchSize)
    if (error) throw new Error(error.message)
    if (!batch || batch.length === 0) break
    rows.push(...batch)
    if (batch.length < batchSize) break
    offset += batchSize
  }
  return rows
}

export async function GET() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()

    const memberRows = await fetchAllBatched<{ joining_date: string | null }>(
      (offset, limit) =>
        supabase
          .from("members")
          .select("joining_date")
          .range(offset, offset + limit - 1)
    )

    // Count new members per year
    const yearCounts: Record<number, number> = {}
    for (const m of memberRows) {
      if (m.joining_date) {
        const year = new Date(m.joining_date).getFullYear()
        yearCounts[year] = (yearCounts[year] || 0) + 1
      }
    }

    // Build sorted yearly data with cumulative totals
    const years = Object.keys(yearCounts)
      .map(Number)
      .sort((a, b) => a - b)

    let cumulative = 0
    const yearly = years.map((year) => {
      cumulative += yearCounts[year]
      return { year, new: yearCounts[year], cumulative }
    })

    return Response.json({ yearly })
  } catch (err) {
    console.error("Retention API error:", err)
    return Response.json(
      { error: "Failed to fetch retention data" },
      { status: 500 }
    )
  }
}
