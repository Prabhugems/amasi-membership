// Vercel serverless function bodies are capped at ~4.5 MB total. A multipart
// resubmit can include 2–3 images plus the JSON payload, so each image must
// land well under that. Target ~1.5 MB per image; reject oversized PDFs (we
// can't recompress those in the browser).
const TARGET_BYTES = 1_500_000
const MAX_PDF_BYTES = 4_000_000
const MAX_DIMENSION = 2400

export type CompressResult =
  | { ok: true; file: File; wasCompressed: boolean }
  | { ok: false; reason: string }

export async function compressImageIfNeeded(file: File): Promise<CompressResult> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) {
      return {
        ok: false,
        reason: `${file.name} is ${(file.size / 1_000_000).toFixed(1)} MB — PDFs must be under 4 MB. Please re-export at lower quality or split it.`,
      }
    }
    return { ok: true, file, wasCompressed: false }
  }

  if (!file.type.startsWith("image/")) {
    return { ok: true, file, wasCompressed: false }
  }

  if (file.size <= TARGET_BYTES) {
    return { ok: true, file, wasCompressed: false }
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Browser refused to decode — fall back to original; server-side validation
    // will catch a truly malformed file.
    return { ok: true, file, wasCompressed: false }
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const targetWidth = Math.round(bitmap.width * scale)
  const targetHeight = Math.round(bitmap.height * scale)

  const canvas = document.createElement("canvas")
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    return { ok: true, file, wasCompressed: false }
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()

  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    )
    if (blob && blob.size <= TARGET_BYTES) {
      const newName = file.name.replace(/\.(png|jpe?g|webp|heic|heif)$/i, "") + ".jpg"
      return {
        ok: true,
        file: new File([blob], newName, { type: "image/jpeg" }),
        wasCompressed: true,
      }
    }
  }

  return {
    ok: false,
    reason: `${file.name} could not be compressed below 1.5 MB. Please use a clearer but smaller photo (try your phone camera in lower-resolution mode).`,
  }
}
