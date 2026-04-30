// CORS allowlist for /api/* cross-origin browser calls.
//
// Browser-callable endpoints under /api/* must reflect the request Origin so
// every AMASI subdomain (membership, eventz360, future event apps) works. The
// static `headers()` block in next.config.ts can only return one origin value,
// which silently broke eventz360 in 2026-04. See CONTEXT.md "Fragile areas →
// CORS".
//
// To allow an extra non-amasi.org origin (e.g. a partner domain or a Vercel
// preview URL), set CORS_ALLOWED_ORIGINS=https://foo.com,https://bar.com.

function isAmasiSubdomain(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  if (url.port !== "") return false
  const host = url.hostname.toLowerCase()
  return host === "amasi.org" || host.endsWith(".amasi.org")
}

function getEnvAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim()
  if (!raw) return []
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

export function isAllowedCorsOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  if (isAmasiSubdomain(origin)) return true
  return getEnvAllowedOrigins().includes(origin)
}
