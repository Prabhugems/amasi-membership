type OCRResult = {
  success: boolean
  text: string
  error?: string
}

export async function extractTextFromImage(imageBuffer: Buffer, filename: string): Promise<OCRResult> {
  const apiKey = process.env.OCR_SPACE_API_KEY?.trim()

  if (!apiKey) {
    return { success: false, text: "", error: "OCR API key not configured" }
  }

  try {
    const ext = filename.split(".").pop()?.toLowerCase() || "jpg"
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", bmp: "image/bmp", tiff: "image/tiff",
      webp: "image/webp", pdf: "application/pdf",
    }
    const mimeType = mimeTypes[ext] || "image/jpeg"
    const base64Image = `data:${mimeType};base64,${imageBuffer.toString("base64")}`

    const formData = new FormData()
    formData.append("base64Image", base64Image)
    formData.append("apikey", apiKey)
    formData.append("language", "eng")
    formData.append("isOverlayRequired", "false")
    formData.append("detectOrientation", "true")
    formData.append("scale", "true")
    formData.append("OCREngine", "2")

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: formData,
    })

    const result = await response.json()

    if (result.IsErroredOnProcessing) {
      return { success: false, text: "", error: result.ErrorMessage?.[0] || "OCR processing failed" }
    }

    if (result.ParsedResults && result.ParsedResults.length > 0) {
      const extractedText = result.ParsedResults.map((r: any) => r.ParsedText).join("\n")
      return { success: true, text: extractedText }
    }

    return { success: false, text: "", error: "No text found in image" }
  } catch (error: any) {
    return { success: false, text: "", error: error.message || "OCR request failed" }
  }
}

export function isOCREnabled(): boolean {
  return !!process.env.OCR_SPACE_API_KEY?.trim()
}
