// Shim helpers for the legacy AMASI mobile app contract.
//
// The Flutter v1.0.4+2 binary (com.amasi.amasi) talks to membership.amasi.org/api/
// using Laravel-style snake_case endpoints with multipart/form-data bodies. The
// legacy backend (Express+MySQL, application.amasi.org) is gone — these routes
// translate the legacy contract to amasi-membership's internal models.
//
// See migration/MIGRATION_FINDINGS.md and migration/backend-spec.md.

import type { NextRequest } from "next/server"

const STUB_MESSAGE =
  "This feature is temporarily unavailable. Please update to the latest version from the Play Store / App Store to continue."

export function legacyOk<T extends Record<string, unknown>>(
  message: string,
  extra?: T
): Response {
  return Response.json({ status: true, message, ...(extra ?? {}) })
}

export function legacyErr(
  message: string,
  extra?: Record<string, unknown>
): Response {
  return Response.json({ status: false, message, ...(extra ?? {}) })
}

export function stubFeatureUpdating(featureName: string): Response {
  return Response.json({
    status: false,
    message: STUB_MESSAGE,
    feature: featureName,
  })
}

export async function parseLegacyForm(
  request: NextRequest
): Promise<FormData> {
  const ct = request.headers.get("content-type") || ""
  if (ct.includes("application/json")) {
    const fd = new FormData()
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null
    if (!body) return fd
    for (const [k, v] of Object.entries(body)) {
      if (v == null) continue
      if (Array.isArray(v)) v.forEach((entry) => fd.append(`${k}[]`, String(entry)))
      else if (typeof v === "object") fd.append(k, JSON.stringify(v))
      else fd.append(k, String(v))
    }
    return fd
  }
  return request.formData()
}

export function field(form: FormData, name: string): string {
  const v = form.get(name)
  if (v == null) return ""
  return typeof v === "string" ? v : ""
}

export function fieldOrNull(form: FormData, name: string): string | null {
  const v = form.get(name)
  if (v == null) return null
  const s = typeof v === "string" ? v : ""
  return s === "" ? null : s
}

// Flutter Dio occasionally sends array fields either as repeated keys
// (clinic_name, clinic_name, ...) or as indexed keys (clinic_name[0],
// clinic_name[1], ...). Handle both shapes transparently.
export function arrayField(form: FormData, name: string): string[] {
  const repeated = form.getAll(name).map((v) => (typeof v === "string" ? v : ""))
  if (repeated.length > 1) return repeated
  if (repeated.length === 1 && repeated[0] !== "") {
    const single = repeated[0]
    if (single.includes(",") && !single.match(/^[A-Z]+,[A-Z]+$/)) {
      // Single string with commas. Most clinic fields are plain text — only
      // other_inter_organisation is a comma-joined enum. Caller can choose
      // singleArrayField if they want a single-element array regardless.
      return [single]
    }
    return [single]
  }
  const indexed: string[] = []
  for (let i = 0; ; i++) {
    const v = form.get(`${name}[${i}]`)
    if (v == null) break
    indexed.push(typeof v === "string" ? v : "")
  }
  return indexed
}

export function fileField(form: FormData, name: string): File | null {
  const v = form.get(name)
  if (!v || typeof v === "string") return null
  return v as File
}

// Upload a multipart File to the Supabase `uploads` bucket under a deterministic
// per-draft prefix. Returns the public URL. Errors propagate — callers wrap.
// Imports lazily to avoid pulling supabase into the helpers' top of the module
// graph (these helpers are also used by routes that don't talk to storage).
export async function uploadShimFile(
  file: File,
  docKey: string,
  draftId: string
): Promise<string> {
  const { createAdminClient } = await import("@/lib/supabase")
  const supabase = createAdminClient()
  const safeKey = docKey.replace(/[^a-z0-9_-]/gi, "_")
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "")
  const path = `mobile-shim/${draftId}/${safeKey}-${Date.now()}.${ext || "bin"}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await supabase.storage
    .from("uploads")
    .upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    })
  if (error) throw error
  const {
    data: { publicUrl },
  } = supabase.storage.from("uploads").getPublicUrl(path)
  return publicUrl
}

// 6-digit numeric OTP, matching the existing /api/otp/send convention.
export function generateShimOtp(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomInt } = require("node:crypto") as typeof import("node:crypto")
  return String(randomInt(100000, 999999))
}

// Resend wrapper colocated here so the 5 OTP shim routes share one template
// instead of re-templating per route.
export async function sendShimOtpEmail(to: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  const { Resend } = await import("resend")
  const resend = new Resend(key)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
    to,
    subject: "Your AMASI Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a; margin-bottom: 16px;">AMASI Verification</h2>
        <p style="color: #555; font-size: 15px;">Your verification code is:</p>
        <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1a1a1a;">${code}</span>
        </div>
        <p style="color: #555; font-size: 14px;">This code expires in 10 minutes. Do not share it with anyone.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">Association of Minimal Access Surgeons of India</p>
      </div>
    `,
  })
  if (error) throw error
}
