import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const regNo = request.nextUrl.searchParams.get("regNo")
  const state = request.nextUrl.searchParams.get("state")

  if (!regNo) {
    return Response.json(
      { status: false, message: "Registration number required" },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(
      "https://www.nmc.org.in/MCIRest/open/getDataFromService?service=searchDoctor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationNo: regNo.trim(), smcId: "" }),
        // Allow longer timeout — NMC can be slow
        signal: AbortSignal.timeout(15000),
      }
    )

    if (!res.ok) {
      return Response.json(
        { status: false, message: "NMC service unavailable" },
        { status: 502 }
      )
    }

    const data = await res.json()

    if (!Array.isArray(data) || data.length === 0) {
      return Response.json({
        status: true,
        verified: false,
        doctors: [],
        message: "No doctor found with this registration number",
      })
    }

    // Map and clean results
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

    // Filter by state if provided
    if (state) {
      const stateLower = state.toLowerCase()
      const filtered = doctors.filter((d: any) =>
        d.council.toLowerCase().includes(stateLower)
      )
      if (filtered.length > 0) doctors = filtered
    }

    return Response.json({ status: true, verified: true, doctors })
  } catch (error: any) {
    // Handle SSL or network errors gracefully
    const message =
      error?.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      error?.cause?.code === "CERT_HAS_EXPIRED" ||
      error?.code === "ERR_TLS_CERT_ALTNAME_INVALID"
        ? "NMC website has SSL certificate issues. Verification temporarily unavailable."
        : "Unable to verify with NMC. Please try again."

    console.error("NMC verify error:", error?.message || error)
    return Response.json({ status: false, message }, { status: 500 })
  }
}
