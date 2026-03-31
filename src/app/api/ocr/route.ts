import Anthropic from "@anthropic-ai/sdk"

const BLOCKED_DEGREES = [
  "bams", "bums", "bhms", "bds", "bpt", "bot",
  "md ayurveda", "md homeopathy", "md unani",
  "ms ayurveda", "ms homeopathy",
]

const SURGICAL_DEGREES = [
  "ms", "m.s", "mch", "m.ch", "dnb surgery", "dnb surgical",
  "dnb general surgery", "dnb orthopaedics", "dnb ent",
  "dnb ophthalmology", "dnb obstetrics", "dnb gynaecology",
  "frcs", "mrcs",
]

function buildPrompt(docType: string): string {
  if (docType === "mci_certificate") {
    return `Look at this medical council registration certificate image carefully. Extract the DOCTOR'S personal details.

IMPORTANT: The "name" field must be the doctor's FULL PERSONAL NAME (e.g. "VASUDHA BHARGAVI" or "RAJESH KUMAR SHARMA"). Do NOT include titles like "Dr." or any other text — just the person's name as written on the certificate.

Return ONLY this JSON:
{"name":"doctor full personal name ONLY","registration_number":"council registration/certificate number","council_state":"state name only e.g. Andhra Pradesh","date_of_birth":"DD-MM-YYYY if visible or null","gender":"Male or Female if visible or null","father_name":"father name without Mr/Shri prefix or null","is_valid_medical_document":true}

If this image is NOT a medical council certificate, return: {"is_valid_medical_document":false}
Return ONLY valid JSON, nothing else.`
  }
  if (docType === "pg_degree_certificate" || docType === "mbbs_degree_certificate") {
    return `Look at this medical degree certificate image carefully. Extract the details of the person who received the degree.

IMPORTANT: The "name" field must be the person's FULL PERSONAL NAME only (e.g. "VASUDHA BHARGAVI"). Do NOT include "Dr." or any descriptive text.

Return ONLY this JSON:
{"name":"person full name ONLY","degree":"exact degree name e.g. M.S. (General Surgery) or MBBS","university":"university or board name","college":"college or institution name or null","year_of_passing":"4 digit year e.g. 2023 or null","is_valid_medical_document":true}

If this image is NOT a medical degree certificate, return: {"is_valid_medical_document":false}
Return ONLY valid JSON, nothing else.`
  }
  if (docType === "asi_member_certificate") {
    return `This is an ASI membership certificate. Extract as JSON:
{"name":"full name","asi_membership_number":"membership number","is_valid_medical_document":true}
If NOT an ASI certificate, set is_valid_medical_document to false. Return ONLY JSON.`
  }
  if (docType === "letter_hod") {
    return `This is a letter from Head of Department. Extract as JSON:
{"name":"candidate name","institution":"hospital/college","department":"department name","is_valid_medical_document":true}
Return ONLY JSON.`
  }
  if (docType === "active_license") {
    return `This is a medical practice license. Extract as JSON:
{"name":"doctor name","license_number":"license number","is_valid_medical_document":true}
Return ONLY JSON.`
  }
  return ""
}

// Fallback: use OCR.space API + regex extraction
async function fallbackOCR(buffer: Buffer, filename: string, docType: string): Promise<Record<string, any>> {
  const ocrKey = process.env.OCR_SPACE_API_KEY?.trim()
  if (!ocrKey) throw new Error("No OCR API key configured")

  const ext = filename.split(".").pop()?.toLowerCase() || "jpg"
  const mimeTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf" }
  const mimeType = mimeTypes[ext] || "image/jpeg"
  const base64Image = `data:${mimeType};base64,${buffer.toString("base64")}`

  const ocrForm = new FormData()
  ocrForm.append("base64Image", base64Image)
  ocrForm.append("apikey", ocrKey)
  ocrForm.append("language", "eng")
  ocrForm.append("isOverlayRequired", "false")
  ocrForm.append("detectOrientation", "true")
  ocrForm.append("scale", "true")
  ocrForm.append("OCREngine", "2")

  const ocrRes = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: ocrForm })
  const ocrResult = await ocrRes.json()

  let text = ""
  if (ocrResult.ParsedResults?.length > 0) {
    text = ocrResult.ParsedResults.map((r: any) => r.ParsedText).join("\n")
  }

  if (!text || text.trim().length < 20) {
    return { is_valid_medical_document: false }
  }

  const lowerText = text.toLowerCase()
  const medicalKeywords = ["medical", "council", "registration", "certificate", "degree",
    "university", "college", "surgery", "doctor", "medicine", "hospital", "mbbs",
    "board", "surgeon", "conferred", "awarded", "certify", "qualification", "registered"]
  const matched = medicalKeywords.filter((kw) => lowerText.includes(kw))
  if (matched.length < 2) {
    return { is_valid_medical_document: false }
  }

  const extracted: Record<string, any> = { is_valid_medical_document: true }

  // Extract name
  const nameMatch = text.match(/(?:name\s*[:\-]?\s*)((?:Dr\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i)
    || text.match(/(?:certif(?:y|ied)\s+that\s+)((?:Dr\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i)
    || text.match(/(Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/)
  if (nameMatch) extracted.name = nameMatch[1].trim()

  // Extract registration number
  if (docType === "mci_certificate") {
    const regMatch = text.match(/(?:reg(?:istration)?\.?\s*(?:no|number)\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i)
      || text.match(/([A-Z]{2,5}(?:MC|MR|FM|SMC)[A-Z]*\d{3,})/i)
    if (regMatch) extracted.registration_number = regMatch[1].trim()

    // Extract state
    const stateNames = ["Andhra Pradesh", "Tamil Nadu", "Karnataka", "Kerala", "Maharashtra",
      "Delhi", "West Bengal", "Gujarat", "Rajasthan", "Uttar Pradesh", "Madhya Pradesh",
      "Bihar", "Odisha", "Telangana", "Punjab", "Haryana", "Jharkhand", "Chhattisgarh", "Goa"]
    for (const state of stateNames) {
      if (lowerText.includes(state.toLowerCase())) {
        extracted.council_state = state + " Medical Council"
        break
      }
    }
  }

  // Extract degree
  if (docType === "pg_degree_certificate" || docType === "mbbs_degree_certificate") {
    const degreeMatch = text.match(/(M\.?S\.?\s*(?:\(|in\s+)?[A-Za-z\s]+(?:\))?)/i)
      || text.match(/(M\.?Ch\.?\s*(?:\(|in\s+)?[A-Za-z\s]+(?:\))?)/i)
      || text.match(/(D\.?N\.?B\.?\s*(?:\(|in\s+)?[A-Za-z\s]+(?:\))?)/i)
      || text.match(/(M\.?B\.?B\.?S\.?)/i)
    if (degreeMatch) extracted.degree = degreeMatch[1].trim()

    const uniMatch = text.match(/([A-Za-z\s]+university)/i) || text.match(/(?:university\s+of\s+)([A-Za-z\s]+)/i)
    if (uniMatch) extracted.university = uniMatch[1].trim()

    const collegeMatch = text.match(/([A-Za-z\s]+(?:medical|college|institute)[A-Za-z\s]*)/i)
    if (collegeMatch) extracted.college = collegeMatch[1].trim().slice(0, 80)

    const yearMatch = text.match(/\b(19\d{2}|20[0-2]\d)\b/g)
    if (yearMatch) extracted.year_of_passing = yearMatch[yearMatch.length - 1]
  }

  // Extract ASI number
  if (docType === "asi_member_certificate") {
    const asiMatch = text.match(/(?:membership\s*(?:no|number)\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i)
    if (asiMatch) extracted.asi_membership_number = asiMatch[1].trim()
  }

  return extracted
}

function checkEligibility(docType: string, extracted: Record<string, any>) {
  if (docType !== "pg_degree_certificate" || !extracted.degree) return null

  const degreeLower = extracted.degree.toLowerCase()
  const isBlocked = BLOCKED_DEGREES.some((d) => degreeLower.includes(d))
  const isSurgical = SURGICAL_DEGREES.some((d) => degreeLower.includes(d))

  if (isBlocked) {
    return {
      eligible: false,
      reason: `${extracted.degree} is not eligible for AMASI membership. Only surgical PG degrees (MS, MCh, DNB in surgical specialties) are accepted.`,
    }
  }
  if (degreeLower === "mbbs" || degreeLower === "m.b.b.s" || degreeLower === "m.b.b.s.") {
    return {
      eligible: false,
      reason: "MBBS alone is not sufficient. You need a postgraduate surgical degree (MS/MCh/DNB) for membership.",
    }
  }
  if (isSurgical) {
    return { eligible: true, reason: `${extracted.degree} is eligible for AMASI membership.` }
  }
  return { eligible: true, reason: `Degree noted: ${extracted.degree}. Please ensure this is a surgical specialty.` }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const docType = formData.get("docType") as string

    if (!file || !docType) {
      return Response.json({ success: false, error: "Missing file or docType" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString("base64")
    const mimeType = file.type || "image/jpeg"

    let extracted: Record<string, any> = {}
    let usedClaude = false

    // Try Claude Vision first
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
    if (apiKey) {
      try {
        const client = new Anthropic({ apiKey })
        const prompt = buildPrompt(docType)
        if (!prompt) {
          return Response.json({ success: false, error: "Unknown document type" }, { status: 400 })
        }

        const message = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType as any, data: base64 } },
              { type: "text", text: prompt },
            ],
          }],
        })

        const responseText = message.content[0].type === "text" ? message.content[0].text : ""
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          extracted = JSON.parse(jsonMatch[0])
          usedClaude = true
        }
      } catch (claudeError: any) {
        console.log("Claude Vision failed, falling back to Tesseract:", claudeError.message)
      }
    }

    // Fallback to Tesseract OCR
    if (!usedClaude) {
      try {
        extracted = await fallbackOCR(buffer, file.name, docType)
      } catch (tessError: any) {
        console.error("Tesseract also failed:", tessError.message)
        return Response.json({ success: false, error: "Could not process document" }, { status: 500 })
      }
    }

    // Check validity
    if (!extracted.is_valid_medical_document) {
      return Response.json({
        success: false,
        isIrrelevant: true,
        extracted,
        message: "This doesn't appear to be a valid medical document. Please upload the correct certificate.",
      })
    }

    // Eligibility check
    const eligibility = checkEligibility(docType, extracted)

    return Response.json({
      success: true,
      extracted,
      eligibility,
      docType,
      engine: usedClaude ? "claude-vision" : "tesseract",
    })
  } catch (error: any) {
    console.error("OCR API error:", error)
    return Response.json({ success: false, error: error.message || "OCR processing failed" }, { status: 500 })
  }
}
