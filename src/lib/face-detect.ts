"use client"

/**
 * Profile photo validation using canvas pixel analysis.
 * Checks for: skin tone presence, color complexity, and image quality.
 * No external dependencies needed.
 */

export function preloadFaceDetection() {
  // No preloading needed for canvas-based detection
}

export async function detectFace(
  imageElement: HTMLImageElement
): Promise<{ hasFace: boolean; faceCount: number; message: string }> {
  try {
    const w = imageElement.naturalWidth || imageElement.width
    const h = imageElement.naturalHeight || imageElement.height

    // Basic dimension checks
    if (w < 80 || h < 80) {
      return { hasFace: false, faceCount: 0, message: "Image too small. Upload a clear passport-size photo (min 80x80px)." }
    }

    const aspectRatio = w / h
    if (aspectRatio > 4 || aspectRatio < 0.25) {
      return { hasFace: false, faceCount: 0, message: "This doesn't look like a portrait photo. Please upload a passport-size photo." }
    }

    // Analyze pixels
    const canvas = document.createElement("canvas")
    const size = 100 // Sample at 100x100
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(imageElement, 0, 0, size, size)
    const imageData = ctx.getImageData(0, 0, size, size).data

    let skinPixels = 0
    let totalPixels = 0
    let darkPixels = 0
    let lightPixels = 0
    const colors = new Set<string>()

    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i]
      const g = imageData[i + 1]
      const b = imageData[i + 2]
      totalPixels++

      // Count unique color buckets (quantized)
      colors.add(`${Math.floor(r / 32)},${Math.floor(g / 32)},${Math.floor(b / 32)}`)

      // Detect skin tone pixels (works across skin colors)
      // Based on RGB skin color model
      const isSkin =
        r > 60 && g > 40 && b > 20 &&
        r > g && r > b &&
        Math.abs(r - g) > 10 &&
        r - b > 15 &&
        !(r > 220 && g > 210 && b > 200) // not near-white

      if (isSkin) skinPixels++
      if (r < 40 && g < 40 && b < 40) darkPixels++
      if (r > 240 && g > 240 && b > 240) lightPixels++
    }

    const skinRatio = skinPixels / totalPixels
    const darkRatio = darkPixels / totalPixels
    const lightRatio = lightPixels / totalPixels
    const uniqueColors = colors.size

    // Signature detection: very few colors (mostly black/dark on white/light)
    if (uniqueColors < 15 && (darkRatio + lightRatio) > 0.7) {
      return {
        hasFace: false,
        faceCount: 0,
        message: "This appears to be a signature or simple graphic, not a photo. Please upload a passport-size photo of yourself.",
      }
    }

    // Too monotone (solid color, blank image)
    if (uniqueColors < 10) {
      return {
        hasFace: false,
        faceCount: 0,
        message: "This doesn't appear to be a photo. Please upload a clear passport-size photo of yourself.",
      }
    }

    // Check for skin tone presence (a face photo should have 10%+ skin pixels)
    if (skinRatio < 0.05) {
      return {
        hasFace: false,
        faceCount: 0,
        message: "No face detected in this image. Please upload a clear passport-size photo showing your face.",
      }
    }

    // Mostly dark (document scan, dark image)
    if (darkRatio > 0.6) {
      return {
        hasFace: false,
        faceCount: 0,
        message: "Image is too dark. Please upload a well-lit passport-size photo.",
      }
    }

    // Passed all checks - likely a face photo
    return {
      hasFace: true,
      faceCount: 1,
      message: "Profile photo accepted",
    }
  } catch {
    return { hasFace: false, faceCount: 0, message: "Could not analyze image. Please try another photo." }
  }
}
