import { NextRequest } from "next/server"
import https from "node:https"
import tls from "node:tls"
import { checkRateLimit } from "@/lib/rate-limit"
import { SECTIGO_R36_PEM } from "@/lib/certs/sectigo-r36"

const nmcAgent = new https.Agent({
  ca: [...tls.rootCertificates, SECTIGO_R36_PEM],
  keepAlive: true,
})

function callNmcOnce(regNo: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ registrationNo: regNo.trim(), smcId: "" })
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), timeoutMs)
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      fn()
    }

    const req = https.request(
      {
        hostname: "www.nmc.org.in",
        path: "/MCIRest/open/getDataFromService?service=searchDoctor",
        method: "POST",
        agent: nmcAgent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        signal: controller.signal,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("error", (err) => settle(() => reject(err)))
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) {
            settle(() => reject(new Error(`NMC HTTP ${res.statusCode}`)))
            return
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
            settle(() => resolve(parsed))
          } catch {
            settle(() => reject(new Error("NMC returned non-JSON")))
          }
        })
      }
    )
    req.on("error", (err) =>
      settle(() =>
        reject(controller.signal.aborted ? new Error(`NMC timeout after ${timeoutMs}ms`) : err)
      )
    )
    req.end(body)
  })
}

export async function GET(request: NextRequest) {
  // Rate limit: 10 NMC lookups per 15 minutes per IP (protect upstream NMC API)
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`nmc:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
  }

  const regNo = request.nextUrl.searchParams.get("regNo")
  const state = request.nextUrl.searchParams.get("state")

  if (!regNo) {
    return Response.json(
      { status: true, reachable: true, verified: false, doctors: [], message: "Registration number required" },
      { status: 400 }
    )
  }

  // Gov API: either answers <2s or is down. Short non-additive retry.
  let data: unknown
  try {
    data = await callNmcOnce(regNo, 5000)
  } catch (err1) {
    const msg1 = (err1 as Error)?.message
    const code1 = (err1 as NodeJS.ErrnoException)?.code
    console.warn("NMC attempt 1 failed:", code1 || "", msg1)
    await new Promise((r) => setTimeout(r, 2000))
    try {
      data = await callNmcOnce(regNo, 3000)
    } catch (err2) {
      const msg2 = (err2 as Error)?.message
      const code2 = (err2 as NodeJS.ErrnoException)?.code
      console.warn("NMC attempt 2 failed:", code2 || "", msg2)
      return Response.json({
        status: true,
        reachable: false,
        verified: false,
        doctors: [],
        message: "NMC service is temporarily unavailable. Please try again later.",
        debug: process.env.NODE_ENV !== "production" ? `${code2 || ""} ${msg2}`.trim() : undefined,
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

  let doctors = data.map((d: Record<string, unknown>) => ({
    name: ((d.firstName as string) || "").trim(),
    registrationNo: d.registrationNo,
    council: (d.smcName as string) || "",
    degree: (d.doctorDegree as string) || "",
    university: (d.university as string) || "",
    yearOfPassing: (d.yearOfPassing as string) || "",
    parentName: (d.parentName as string) || "",
    dob: (d.birthDateStr as string) || "",
    address: (d.address as string) || (d.addressLine1 as string) || "",
    regDate: (d.regDate as string) || "",
  }))

  if (state) {
    const stateLower = state.toLowerCase()
    const filtered = doctors.filter((d) => d.council.toLowerCase().includes(stateLower))
    if (filtered.length > 0) doctors = filtered
  }

  return Response.json({ status: true, reachable: true, verified: true, doctors })
}
