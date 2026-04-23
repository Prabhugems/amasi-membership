/**
 * NMC Verification with Cache
 *
 * Wraps the NMC gov API with a 30-day Supabase cache. Fallback chain:
 * 1. Fresh cache hit → return immediately, skip API
 * 2. API call succeeds → write to cache, return fresh result
 * 3. API fails + stale cache exists → return stale cache with warning
 * 4. API fails + no cache → return unreachable (weight drops to 0)
 */

import type { SupabaseClient } from "@supabase/supabase-js"

const CACHE_TTL_DAYS = 30

export type NmcCacheSource =
  | "live_api_success"
  | "live_cache_hit"
  | "stale_cache_hit"
  | "unreachable_no_cache"
  | "skipped_ilm"

export type NmcCachedResult =
  | { reachable: true; found: true; name: string; council: string; degree: string; source: NmcCacheSource; stale: boolean; responseTimeMs: number }
  | { reachable: true; found: false; source: NmcCacheSource; responseTimeMs: number }
  | { reachable: false; source: NmcCacheSource; responseTimeMs: number }

// --- Raw NMC API call (unchanged from ai-approval.ts) ---

async function callNmcOnce(regNo: string, timeoutMs: number): Promise<any> {
  const res = await fetch("https://www.nmc.org.in/MCIRest/open/getDataFromService?service=searchDoctor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationNo: regNo.trim(), smcId: "" }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`NMC HTTP ${res.status}`)
  return res.json()
}

async function callNmcApi(regNo: string): Promise<{ success: true; data: any[] } | { success: false }> {
  try {
    const data = await callNmcOnce(regNo, 5000)
    return { success: true, data: Array.isArray(data) ? data : [] }
  } catch (err1) {
    console.warn("NMC attempt 1 failed:", (err1 as Error)?.message)
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const data = await callNmcOnce(regNo, 3000)
      return { success: true, data: Array.isArray(data) ? data : [] }
    } catch (err2) {
      console.warn("NMC attempt 2 failed:", (err2 as Error)?.message)
      return { success: false }
    }
  }
}

// --- Cache operations ---

interface CacheRow {
  registration_number: string
  state_council: string
  doctor_name: string
  qualification: string | null
  status: string
  raw_response: any
  verified_at: string
  expires_at: string
  source: string
}

async function readCache(supabase: SupabaseClient, regNo: string): Promise<CacheRow | null> {
  const { data, error } = await supabase
    .from("nmc_verification_cache")
    .select("*")
    .eq("registration_number", regNo.trim().toUpperCase())
    .maybeSingle()
  if (error) {
    console.warn("[nmc-cache] cache read error:", error.message)
    return null
  }
  return data
}

async function writeCache(supabase: SupabaseClient, regNo: string, doc: any, rawResponse: any): Promise<void> {
  const now = new Date()
  const expires = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const row = {
    registration_number: regNo.trim().toUpperCase(),
    state_council: doc.smcName || "",
    doctor_name: doc.firstName || "",
    qualification: doc.doctorDegree || null,
    status: "active",
    raw_response: rawResponse,
    verified_at: now.toISOString(),
    expires_at: expires.toISOString(),
    source: "live_api",
  }

  const { error } = await supabase
    .from("nmc_verification_cache")
    .upsert(row, { onConflict: "registration_number" })

  if (error) {
    console.warn("[nmc-cache] cache write error:", error.message)
  }
}

async function writeCacheNotFound(supabase: SupabaseClient, regNo: string): Promise<void> {
  const now = new Date()
  const expires = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const { error } = await supabase
    .from("nmc_verification_cache")
    .upsert({
      registration_number: regNo.trim().toUpperCase(),
      state_council: "",
      doctor_name: "",
      qualification: null,
      status: "not_found",
      raw_response: null,
      verified_at: now.toISOString(),
      expires_at: expires.toISOString(),
      source: "live_api",
    }, { onConflict: "registration_number" })

  if (error) {
    console.warn("[nmc-cache] cache write (not_found) error:", error.message)
  }
}

// --- Main entry point ---

export async function verifyWithNmcCached(
  supabase: SupabaseClient,
  regNo: string,
  state?: string,
): Promise<NmcCachedResult> {
  if (!regNo) return { reachable: true, found: false, source: "live_api_success", responseTimeMs: 0 }

  const start = performance.now()
  const normalizedReg = regNo.trim().toUpperCase()

  // 1. Check cache
  const cached = await readCache(supabase, normalizedReg)
  const now = new Date()

  if (cached && new Date(cached.expires_at) > now) {
    // Fresh cache hit — skip API entirely
    const elapsed = Math.round(performance.now() - start)
    if (cached.status === "not_found") {
      return { reachable: true, found: false, source: "live_cache_hit", responseTimeMs: elapsed }
    }
    return {
      reachable: true,
      found: true,
      name: cached.doctor_name,
      council: cached.state_council,
      degree: cached.qualification || "",
      source: "live_cache_hit",
      stale: false,
      responseTimeMs: elapsed,
    }
  }

  // 2. Call NMC API
  const apiResult = await callNmcApi(normalizedReg)

  if (apiResult.success) {
    const elapsed = Math.round(performance.now() - start)

    if (apiResult.data.length === 0) {
      // Not found — cache the negative result too
      await writeCacheNotFound(supabase, normalizedReg).catch(() => {})
      return { reachable: true, found: false, source: "live_api_success", responseTimeMs: elapsed }
    }

    // Filter by state if provided
    let match = apiResult.data
    if (state) {
      const stateLower = state.toLowerCase()
      const filtered = apiResult.data.filter((d: any) => (d.smcName || "").toLowerCase().includes(stateLower))
      if (filtered.length > 0) match = filtered
    }

    const doc = match[0]

    // Write to cache
    await writeCache(supabase, normalizedReg, doc, apiResult.data).catch(() => {})

    return {
      reachable: true,
      found: true,
      name: doc.firstName || "",
      council: doc.smcName || "",
      degree: doc.doctorDegree || "",
      source: "live_api_success",
      stale: false,
      responseTimeMs: elapsed,
    }
  }

  // 3. API failed — try stale cache fallback
  if (cached) {
    const elapsed = Math.round(performance.now() - start)
    console.warn(`[nmc-cache] API down, serving stale cache for ${normalizedReg} (expired ${cached.expires_at})`)

    if (cached.status === "not_found") {
      return { reachable: true, found: false, source: "stale_cache_hit", responseTimeMs: elapsed }
    }
    return {
      reachable: true,
      found: true,
      name: cached.doctor_name,
      council: cached.state_council,
      degree: cached.qualification || "",
      source: "stale_cache_hit",
      stale: true,
      responseTimeMs: elapsed,
    }
  }

  // 4. API failed, no cache — unreachable
  const elapsed = Math.round(performance.now() - start)
  return { reachable: false, source: "unreachable_no_cache", responseTimeMs: elapsed }
}
