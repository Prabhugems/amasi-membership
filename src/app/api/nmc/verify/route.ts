import { NextRequest } from "next/server"

async function callNmcOnce(regNo: string, timeoutMs: number) {
  const res = await fetch(
    "https://www.nmc.org.in/MCIRest/open/getDataFromService?service=searchDoctor",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationNo: regNo.trim(), smcId: "" }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  )
  if (!res.ok) throw new Error(`NMC HTTP ${res.status}`)
  return res.json()
}

export async function GET(request: NextRequest) {
  const regNo = request.nextUrl.searchParams.get("regNo")
  const state = request.nextUrl.searchParams.get("state")

  if (!regNo) {
    return Response.json(
      { status: true, reachable: true, verified: false, doctors: [], message: "Registration number required" },
      { status: 400 }
    )
  }

  // Gov API: either answers <2s or is down. Short non-additive retry.
  let data: any
  try {
    data = await callNmcOnce(regNo, 5000)
  } catch (err1) {
    console.warn("NMC attempt 1 failed:", (err1 as Error)?.message)
    await new Promise((r) => setTimeout(r, 2000))
    try {
      data = await callNmcOnce(regNo, 3000)
    } catch (err2) {
      console.warn("NMC attempt 2 failed:", (err2 as Error)?.message)
      return Response.json({
        status: true,
        reachable: false,
        verified: false,
        doctors: [],
        message: "NMC service is temporarily unavailable. Please try again later.",
      })
    }
  }

  if (!Array.isArray(data) || data.length === 0) {
    return Response.json({
      status: true,
      reachable: true,
      verified: false,
      doctors: [],
      message: "No doctor found with this registration number",
    })
  }

  let doctors = data.map((d: any) => ({
    name: (d.firstName || "").trim(),
    registrationNo: d.registrationNo,
    council: d.smcName || "",
    degree: d.doctorDegree || "",
    university: d.university || "",
    yearOfPassing: d.yearOfPassing || "",
    parentName: d.parentName || "",
    dob: d.birthDateStr || "",
    address: d.address || d.addressLine1 || "",
    regDate: d.regDate || "",
  }))

  if (state) {
    const stateLower = state.toLowerCase()
    const filtered = doctors.filter((d: any) => d.council.toLowerCase().includes(stateLower))
    if (filtered.length > 0) doctors = filtered
  }

  return Response.json({ status: true, reachable: true, verified: true, doctors })
}
