import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const pin = request.nextUrl.searchParams.get("pin")
  if (!pin || !/^\d{6}$/.test(pin)) {
    return Response.json({ status: false, message: "Valid 6-digit PIN required" }, { status: 400 })
  }

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`)
    const data = await res.json()

    if (data?.[0]?.Status === "Success" && data[0].PostOffice?.length > 0) {
      const po = data[0].PostOffice[0]
      return Response.json({
        status: true,
        city: po.District || po.Division || "",
        state: po.State || "",
        area: po.Name || "",
        region: po.Region || "",
      })
    }

    return Response.json({ status: false, message: "PIN code not found" })
  } catch {
    return Response.json({ status: false, message: "Lookup failed" }, { status: 500 })
  }
}
