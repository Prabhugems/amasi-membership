import { signToken, verifyToken } from "@/lib/auth"
import type { CredentialType } from "./types"

interface VerifyPayload {
  amasi: number
  type: CredentialType
  // optional sub-issuer note ("admin@amasi.org")
  iss?: string
}

// Sign a public-shareable verification link. The token is HMAC-signed with
// JWT_SECRET, so the public verify page can validate it offline without a DB
// lookup. Default expiry: 30 days. Pass `expiresIn: "1y"` for longer.
export async function signVerifyToken(
  payload: VerifyPayload,
  expiresIn: string = "30d"
): Promise<string> {
  return signToken({ ...payload, scope: "credential-verify" }, expiresIn)
}

// Returns the parsed payload if the token is valid, or null otherwise.
export async function readVerifyToken(token: string): Promise<VerifyPayload | null> {
  const payload = await verifyToken(token)
  if (!payload || payload.scope !== "credential-verify") return null
  if (typeof payload.amasi !== "number" || typeof payload.type !== "string") return null
  return {
    amasi: payload.amasi,
    type: payload.type as CredentialType,
    iss: typeof payload.iss === "string" ? payload.iss : undefined,
  }
}
