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

const REJECT_INSTRUCTIONS = `
REJECT (is_valid_medical_document=false) if this is: bank statement, passbook, financial document, Aadhaar, PAN card, passport, ID card, bill, invoice, receipt, or any non-medical document.
If rejected: {"is_valid_medical_document":false,"rejection_reason":"brief reason"}
`

function buildPrompt(docType: string): string {
  if (docType === "mci_certificate") {
    return `Analyze this image. Is this a Medical Council Registration Certificate (MCI/NMC/State Medical Council)?
${REJECT_INSTRUCTIONS}
If YES — extract EVERY detail you can find. Read the entire document thoroughly.
Return ONLY this JSON (use null for fields not found, never guess):
{
  "is_valid_medical_document": true,
  "name": "doctor's full personal name WITHOUT Dr./Prof. prefix",
  "registration_number": "registration/certificate number",
  "council_state": "state name e.g. Tamil Nadu",
  "date_of_birth": "YYYY-MM-DD format or null",
  "gender": "Male or Female or null",
  "father_name": "father/husband name without Mr/Shri prefix or null",
  "qualifications": "all qualifications listed e.g. MBBS, MS (General Surgery) or null",
  "address": "full address if visible or null",
  "city": "city name or null",
  "state": "state from address or null",
  "pin_code": "6-digit PIN if visible or null",
  "registration_date": "YYYY-MM-DD or null",
  "valid_upto": "YYYY-MM-DD or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "pg_degree_certificate" || docType === "mbbs_degree_certificate") {
    return `Analyze this image. Is this a medical degree certificate (MBBS/MS/MCh/MD/DNB/FRCS/diploma)?
${REJECT_INSTRUCTIONS}
If YES — extract EVERY detail. Read thoroughly.
Return ONLY this JSON (null for fields not found):
{
  "is_valid_medical_document": true,
  "name": "person's full name WITHOUT Dr. prefix",
  "degree": "exact degree e.g. M.S. (General Surgery) or M.B.B.S.",
  "university": "university name",
  "college": "college/institution name or null",
  "year_of_passing": "4-digit year e.g. 2023 or null",
  "date_of_birth": "YYYY-MM-DD or null",
  "father_name": "father name or null",
  "gender": "Male or Female or null",
  "roll_number": "roll/exam number or null",
  "date_of_convocation": "YYYY-MM-DD or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "asi_member_certificate") {
    return `Analyze this image. Is this an ASI (Association of Surgeons of India) membership certificate?
${REJECT_INSTRUCTIONS}
If YES:
{
  "is_valid_medical_document": true,
  "name": "member full name",
  "asi_membership_number": "membership number",
  "asi_state": "state chapter or null",
  "membership_type": "Life/Annual/etc or null",
  "date_of_issue": "YYYY-MM-DD or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "letter_hod") {
    return `Analyze this image. Is this a letter from a Head of Department / hospital authority?
${REJECT_INSTRUCTIONS}
If YES:
{
  "is_valid_medical_document": true,
  "name": "candidate/doctor name",
  "institution": "hospital/college name",
  "department": "department name or null",
  "designation": "candidate's designation or null",
  "from_date": "YYYY-MM-DD or null",
  "to_date": "YYYY-MM-DD or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "active_license") {
    return `Analyze this image. Is this a medical practice license or renewal certificate?
${REJECT_INSTRUCTIONS}
If YES:
{
  "is_valid_medical_document": true,
  "name": "doctor name",
  "license_number": "license/registration number",
  "valid_from": "YYYY-MM-DD or null",
  "valid_upto": "YYYY-MM-DD or null",
  "council_state": "issuing council state or null"
}
Return ONLY valid JSON.`
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

const FINANCIAL_KEYWORDS = [
  "bank", "axis", "hdfc", "icici", "sbi", "kotak", "account", "balance",
  "transaction", "debit", "credit", "passbook", "statement", "neft", "imps",
  "upi", "atm", "cheque", "loan", "emi", "inr", "rupees", "savings",
  "current account", "fixed deposit", "ifsc", "branch", "neo for corporates",
]

const ID_KEYWORDS = [
  "aadhaar", "aadhar", "pan card", "passport", "voter", "election",
  "driving license", "ration card",
]

function detectSuspiciousExtraction(docType: string, extracted: Record<string, any>): string | null {
  // Combine all extracted text values for keyword scanning
  const allText = Object.values(extracted)
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase()

  // Check for financial document keywords
  const financialMatches = FINANCIAL_KEYWORDS.filter((kw) => allText.includes(kw))
  if (financialMatches.length >= 2) {
    return "This appears to be a financial/bank document, not a medical certificate."
  }

  // Check for ID document keywords
  const idMatches = ID_KEYWORDS.filter((kw) => allText.includes(kw))
  if (idMatches.length >= 1) {
    return "This appears to be an identity document, not a medical certificate."
  }

  // For PG degree: check if "degree" field contains bank/financial terms
  if (docType === "pg_degree_certificate" || docType === "mbbs_degree_certificate") {
    const degree = (extracted.degree || "").toLowerCase()
    const college = (extracted.college || "").toLowerCase()
    const university = (extracted.university || "").toLowerCase()

    // Must have a degree name — no degree = not a degree certificate
    if (!degree) {
      return "No degree name could be extracted. This does not appear to be a medical degree certificate."
    }

    if (FINANCIAL_KEYWORDS.some((kw) => degree.includes(kw) || college.includes(kw) || university.includes(kw))) {
      return "Extracted data contains financial terms. This does not appear to be a medical degree certificate."
    }

    // Degree should contain medical terms
    const validDegreeTerms = ["ms", "md", "mch", "dnb", "mbbs", "frcs", "mrcs", "diploma", "surgery", "medicine", "m.s", "m.d", "m.ch", "d.n.b"]
    const hasValidDegree = validDegreeTerms.some((t) => degree.includes(t))
    if (!hasValidDegree) {
      return `"${extracted.degree}" does not appear to be a recognized medical degree.`
    }

    // Must also have a university or college — a degree certificate always has an issuing institution
    if (!college && !university) {
      return "No university or college found. This does not appear to be a medical degree certificate."
    }
  }

  // For MCI certificate: must have a registration number
  if (docType === "mci_certificate") {
    if (!extracted.registration_number && !extracted.name) {
      return "No registration number or doctor name found. This does not appear to be a medical council certificate."
    }
  }

  return null
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
        console.error("Claude Vision failed, falling back to Tesseract:", claudeError.message)
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

    // Server-side sanity check: catch obvious non-medical documents the AI missed
    if (extracted.is_valid_medical_document) {
      const suspicious = detectSuspiciousExtraction(docType, extracted)
      if (suspicious) {
        extracted.is_valid_medical_document = false
        extracted.rejection_reason = suspicious
      }
    }

    // Check validity
    if (!extracted.is_valid_medical_document) {
      return Response.json({
        success: false,
        isIrrelevant: true,
        extracted,
        message: extracted.rejection_reason || "This doesn't appear to be a valid medical document. Please upload the correct certificate.",
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
