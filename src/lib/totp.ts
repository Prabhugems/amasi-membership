import crypto from "crypto"

// ---------- Base32 ----------

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let result = ""

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]
    bits += 8
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 31]
  }

  return result
}

export function base32Decode(encoded: string): Buffer {
  const cleanInput = encoded.replace(/=+$/, "").toUpperCase()
  const bytes: number[] = []
  let bits = 0
  let value = 0

  for (const char of cleanInput) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

// ---------- TOTP Core ----------

function generateHOTP(secret: Buffer, counter: bigint): string {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(counter)

  const hmac = crypto.createHmac("sha1", secret)
  hmac.update(buffer)
  const hash = hmac.digest()

  const offset = hash[hash.length - 1] & 0x0f
  const code =
    (((hash[offset] & 0x7f) << 24) |
      (hash[offset + 1] << 16) |
      (hash[offset + 2] << 8) |
      hash[offset + 3]) %
    1_000_000

  return code.toString().padStart(6, "0")
}

/**
 * Generate a random 20-byte secret and return it base32-encoded.
 */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

/**
 * Build the otpauth:// URI that authenticator apps scan.
 */
export function buildOtpauthUrl(
  secret: string,
  email: string,
  issuer = "AMASI"
): string {
  const label = encodeURIComponent(`${issuer}:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/**
 * Generate a TOTP code for the given base32-encoded secret.
 */
export function generateTOTP(
  base32Secret: string,
  timeStep = 30,
  time?: number
): string {
  const key = base32Decode(base32Secret)
  const counter = BigInt(
    Math.floor((time ?? Date.now() / 1000) / timeStep)
  )
  return generateHOTP(key, counter)
}

/**
 * Verify a user-supplied TOTP code against the secret, allowing for clock
 * drift of +/- `window` steps (default 1, i.e. 30 s each side).
 */
export function verifyTOTP(
  base32Secret: string,
  code: string,
  window = 1
): boolean {
  const now = Math.floor(Date.now() / 1000)
  for (let i = -window; i <= window; i++) {
    const t = now + i * 30
    if (generateTOTP(base32Secret, 30, t) === code) {
      return true
    }
  }
  return false
}
