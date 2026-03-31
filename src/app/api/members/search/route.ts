import { NextRequest } from "next/server"
import { fetchMemberByEmailOrPhone } from "@/lib/api"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get("q")

  if (!query) {
    return Response.json({ status: false, message: "Query parameter 'q' is required", data: [] }, { status: 400 })
  }

  try {
    const result = await fetchMemberByEmailOrPhone(query)
    return Response.json(result)
  } catch {
    return Response.json({ status: false, message: "Failed to fetch member data", data: [] }, { status: 500 })
  }
}
