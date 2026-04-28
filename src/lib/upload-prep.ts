/**
 * Browser-only file preparation for /apply uploads.
 *
 * Pipeline:
 *   1. Reject non-image, non-PDF files early.
 *   2. PDF: keep as-is when small enough; reject when too large (no
 *      compression — point users to smallpdf.com).
 *   3. HEIC/HEIF: dynamic-import heic-to and convert to JPEG, then
 *      fall through to the image-compression branch.
 *   4. Image: canvas-resize + recompress (JPEG@0.85, max 2400px long
 *      edge, halve dimensions on retry) until under MAX_BYTES or the
 *      retry cap is hit.
 *
 * Returned `userMessage` is intended to be shown verbatim to the
 * user. Reasons are stable codes the caller can branch on.
 *
 * NEVER import this module from a server component or route handler:
 * canvas, FileReader, heic-to all assume a browser environment.
 */

const MAX_BYTES = 3_500_000        // 3.5 MB target after prep (Vercel route handler is ~4.5 MB)
const MAX_PIXEL_DIM = 2400         // long edge cap for canvas resize
const JPEG_QUALITY = 0.85
const MAX_COMPRESSION_PASSES = 3   // halve dimensions up to this many times before giving up

export type PrepFailureReason =
  | "unsupported_format"
  | "pdf_too_large"
  | "heic_decode_failed"
  | "compression_failed"

export type PrepResult =
  | { ok: true; file: File }
  | { ok: false; reason: PrepFailureReason; userMessage: string }

const HEIC_MIME = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]
const HEIC_EXT = /\.(heic|heif)$/i

function isHeicFile(file: File): boolean {
  if (HEIC_MIME.includes(file.type.toLowerCase())) return true
  if (HEIC_EXT.test(file.name)) return true
  // Some iOS shares set type to empty string with a .heic extension; the regex
  // above catches them. Some browsers normalise to image/jpeg before calling
  // us; those pass straight through and we never reach this branch.
  return false
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name)
}

function isImageMime(file: File): boolean {
  return file.type.startsWith("image/")
}

/**
 * Resize an image File via Canvas. Halves the long edge and quality on each
 * retry until the output is <= MAX_BYTES or the retry cap is reached.
 */
async function compressImage(file: File): Promise<PrepResult> {
  let dim = MAX_PIXEL_DIM
  let quality = JPEG_QUALITY
  let lastBlob: Blob | null = null

  for (let attempt = 0; attempt < MAX_COMPRESSION_PASSES; attempt++) {
    try {
      const blob = await drawAndExport(file, dim, quality)
      lastBlob = blob
      if (blob.size <= MAX_BYTES) {
        return {
          ok: true,
          file: new File([blob], renameToJpg(file.name), { type: "image/jpeg" }),
        }
      }
      // Too big. Halve dimensions for the next pass; keep quality stable to
      // preserve readability of certificate text.
      dim = Math.max(800, Math.round(dim * 0.7))
      quality = Math.max(0.6, quality - 0.05)
    } catch (err) {
      console.error("[upload-prep] canvas compression failed:", err)
      return {
        ok: false,
        reason: "compression_failed",
        userMessage: "We couldn't prepare this image. Please try a different photo.",
      }
    }
  }

  // Out of retries. Return the smallest we managed if it's any improvement,
  // otherwise reject — the caller will surface compression_failed.
  if (lastBlob && lastBlob.size <= MAX_BYTES) {
    return {
      ok: true,
      file: new File([lastBlob], renameToJpg(file.name), { type: "image/jpeg" }),
    }
  }
  return {
    ok: false,
    reason: "compression_failed",
    userMessage: "This image is too large to upload. Please use a smaller photo.",
  }
}

function renameToJpg(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, "")
  return `${base || "upload"}.jpg`
}

/**
 * Draw a File onto a canvas at the requested long edge and export as JPEG.
 * Throws on any browser-side failure (decode, OOM, security).
 */
function drawAndExport(file: File, longEdge: number, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const w0 = img.naturalWidth
        const h0 = img.naturalHeight
        if (!w0 || !h0) {
          URL.revokeObjectURL(url)
          reject(new Error("zero-dimension image"))
          return
        }
        const scale = Math.min(1, longEdge / Math.max(w0, h0))
        const w = Math.max(1, Math.round(w0 * scale))
        const h = Math.max(1, Math.round(h0 * scale))
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error("canvas 2d context unavailable"))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url)
            if (!blob) reject(new Error("canvas.toBlob returned null"))
            else resolve(blob)
          },
          "image/jpeg",
          quality,
        )
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("image decode failed"))
    }
    img.src = url
  })
}

/**
 * Convert a HEIC/HEIF file to JPEG via heic-to. Lazy-imports so the
 * 22 MB heic-to bundle never enters the initial JS chunk.
 */
async function convertHeicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import("heic-to")
  const jpegBlob = await heicTo({
    blob: file,
    type: "image/jpeg",
    quality: JPEG_QUALITY,
  })
  return new File([jpegBlob], renameToJpg(file.name), { type: "image/jpeg" })
}

export async function prepareFileForUpload(file: File): Promise<PrepResult> {
  // 1. PDF
  if (isPdfFile(file)) {
    if (file.size <= MAX_BYTES) {
      return { ok: true, file }
    }
    return {
      ok: false,
      reason: "pdf_too_large",
      userMessage:
        "This PDF is too large. Please compress it (try smallpdf.com) and upload again.",
    }
  }

  // 2. HEIC/HEIF — convert then fall through to the image branch
  if (isHeicFile(file)) {
    let asJpeg: File
    try {
      asJpeg = await convertHeicToJpeg(file)
    } catch (err) {
      console.error("[upload-prep] HEIC decode failed:", err)
      return {
        ok: false,
        reason: "heic_decode_failed",
        userMessage:
          "We couldn't read this HEIC photo. Please save it as a JPG and try again.",
      }
    }
    if (asJpeg.size <= MAX_BYTES) return { ok: true, file: asJpeg }
    return compressImage(asJpeg)
  }

  // 3. Plain image — compress if needed
  if (isImageMime(file)) {
    if (file.size <= MAX_BYTES) return { ok: true, file }
    return compressImage(file)
  }

  // 4. Anything else (docx, txt, video…)
  return {
    ok: false,
    reason: "unsupported_format",
    userMessage:
      "This format isn't supported. Please upload a JPG, PNG, HEIC, or PDF.",
  }
}
