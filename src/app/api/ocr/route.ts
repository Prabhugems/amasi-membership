import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import sharp from "sharp"
import { checkRateLimit } from "@/lib/rate-limit"

/** Preprocess images for better OCR — deskew, denoise, contrast enhance */
async function preprocessImage(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const metadata = await sharp(buffer).metadata()
    if (!metadata.width || !metadata.height) return { buffer, mimeType }

    let pipeline = sharp(buffer)

    // 1. Normalize orientation from EXIF (phone photos are often rotated)
    pipeline = pipeline.rotate()

    // 2. Resize if too large (keeps detail but reduces noise, speeds up AI)
    const maxDim = 3000
    if (metadata.width > maxDim || metadata.height > maxDim) {
      pipeline = pipeline.resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    }

    // 3. Enhance contrast and sharpen for better text readability
    pipeline = pipeline
      .normalize()           // Auto-stretch contrast to full range
      .sharpen({             // Sharpen text edges
        sigma: 1.5,
        m1: 1.0,
        m2: 0.5,
      })
      .median(1)             // Light denoise — removes salt-and-pepper noise without blurring text

    // 4. Convert to PNG for lossless quality to AI
    const processed = await pipeline.png({ quality: 95 }).toBuffer()
    return { buffer: processed, mimeType: "image/png" }
  } catch (err: any) {
    console.error("Image preprocessing failed, using original:", err.message)
    return { buffer, mimeType }
  }
}

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
STEP 0 — DOCUMENT IDENTITY CHECK: First determine what type of document this actually is. If it does NOT match the expected type, reject with a specific message telling the user what they uploaded and what they should upload instead.
Common wrong uploads: admission letters, enrollment forms, marksheets, fee receipts, hall tickets, appointment letters.
REJECT (is_valid_medical_document=false) if this is: bank statement, passbook, financial document, Aadhaar, PAN card, passport, ID card, bill, invoice, receipt, admission letter, enrollment form, marksheet, fee receipt, hall ticket, or any non-medical certificate.
If rejected: {"is_valid_medical_document":false,"rejection_reason":"This looks like a [what it actually is]. Please upload your [what is expected] instead.","detected_document_type":"what you think this document actually is"}
`

function buildPrompt(docType: string): string {
  if (docType === "mci_certificate") {
    return `This is an Indian Medical Council or State Medical Council registration certificate. READ THE VISUAL IMAGE CAREFULLY — embedded text in scanned PDFs may have OCR errors. Trust what you SEE in the image, not embedded text.
${REJECT_INSTRUCTIONS}
If this IS a valid medical council certificate, extract the doctor's full name, registration number, council name, state, date of registration, and renewal/validity date if shown.
Return ONLY this JSON (use null for fields not found, never guess):
{
  "is_valid_medical_document": true,
  "full_name": "doctor's full PERSONAL name (e.g. Rajesh Kumar Singh) — NOT certificate body text like 'has been duly admitted'. Strip Dr./Prof. prefix",
  "registration_number": "registration / enrolment number",
  "council_name": "MCI or state medical council name",
  "state": "issuing state e.g. Tamil Nadu",
  "date_of_registration": "DD/MM/YYYY or YYYY-MM-DD or null",
  "validity_date": "renewal / expiry date if shown, or null",
  "qualification_noted": "degree listed on cert e.g. MBBS, MS (General Surgery) or null",
  "date_of_birth": "YYYY-MM-DD or null",
  "gender": "Male or Female or null",
  "father_name": "father/husband name without Mr/Shri prefix or null",
  "address": "full address if visible or null",
  "city": "city name or null",
  "pin_code": "6-digit PIN if visible or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "pg_degree_certificate") {
    return `This is a postgraduate medical degree certificate from India. READ THE VISUAL IMAGE CAREFULLY — embedded text may have OCR errors (e.g. "degreo" = "degree", "Modisino" = "Medicine", "helsho" = "he/she"). Trust what you SEE in the image, not embedded text.
${REJECT_INSTRUCTIONS}
If this IS a valid PG degree certificate, extract the fields below.

DEGREE NORMALISATION — Indian certificates write degrees in many ways. Read the raw text, then normalise:
  "Master of Surgery" / "M.S." / "MS" / "MS (Gen. Surg.)" → degree_name: "M.S.", specialisation: "General Surgery"
  "Doctor of Medicine" / "M.D." / "MD" / "MD (Medicine)" → degree_name: "M.D.", specialisation from brackets
  "Magister Chirurgiae" / "M.Ch." / "MCh" → degree_name: "M.Ch.", specialisation from brackets
  "Diplomate of National Board" / "D.N.B." / "DNB" → degree_name: "D.N.B.", specialisation from brackets
  "FRCS" / "MRCS" → degree_name as-is
Do NOT return MBBS if the certificate actually says MD, MS, MCh, or DNB. Read carefully.

Return ONLY this JSON (null for fields not found):
{
  "is_valid_medical_document": true,
  "full_name": "person's full PERSONAL name (e.g. Rajesh Kumar) — NOT certificate body text like 'has been duly admitted'. Strip Dr. prefix",
  "degree_name": "NORMALISED degree: M.S. / M.D. / M.Ch. / D.N.B. / FRCS / MRCS",
  "degree_raw_text": "exact text as printed on the certificate for the degree",
  "specialisation": "speciality e.g. General Surgery, Medicine, Orthopaedics",
  "university_name": "awarding university",
  "institution_name": "college/institution name if different from university, or null",
  "year_of_passing": "4-digit convocation year e.g. 2023 or null",
  "document_type": "original or provisional",
  "date_of_birth": "YYYY-MM-DD or null",
  "father_name": "father name or null",
  "gender": "Male or Female or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "mbbs_degree_certificate") {
    return `This is an MBBS degree or provisional certificate from an Indian medical college.
${REJECT_INSTRUCTIONS}
If this IS a valid MBBS certificate, extract: full name, degree (MBBS or provisional), university, college/institution name, and year of passing.
Return ONLY this JSON (null for fields not found):
{
  "is_valid_medical_document": true,
  "full_name": "person's full name WITHOUT Dr. prefix",
  "degree_name": "MBBS or provisional",
  "university_name": "awarding university",
  "institution_name": "medical college name or null",
  "year_of_passing": "4-digit year or null",
  "document_type": "original or provisional",
  "date_of_birth": "YYYY-MM-DD or null",
  "father_name": "father name or null",
  "gender": "Male or Female or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "asi_member_certificate") {
    return `This is an ASI (Association of Surgeons of India) membership certificate or card.
${REJECT_INSTRUCTIONS}
If this IS a valid ASI certificate, extract: member full name, membership ID number, membership type (Life or Annual), validity year or expiry date, and state branch if shown.
Return ONLY this JSON (null for fields not found):
{
  "is_valid_medical_document": true,
  "full_name": "member full name",
  "asi_membership_id": "membership number",
  "membership_type": "Life or Annual or null",
  "validity_year": "year or expiry date or null",
  "branch": "state chapter if shown or null"
}
Return ONLY valid JSON.`
  }
  if (docType === "letter_hod") {
    return `This is a letter from a Head of Department certifying a PG trainee's enrollment.
${REJECT_INSTRUCTIONS}
If this IS a valid HOD letter, extract: applicant name, PG year, department, institution name, HOD name, HOD designation, letter date. Also return boolean flags for letterhead, signature, and stamp presence.
Return ONLY this JSON (null for fields not found):
{
  "is_valid_medical_document": true,
  "applicant_name": "PG trainee / candidate name",
  "pg_year": "year 1 / 2 / 3 or null",
  "department": "surgery department name or null",
  "institution_name": "hospital / college name",
  "hod_name": "signing HOD name or null",
  "hod_designation": "Prof / Assoc Prof etc. or null",
  "letter_date": "YYYY-MM-DD or null",
  "has_letterhead": true or false,
  "has_signature": true or false,
  "has_stamp": true or false
}
Return ONLY valid JSON.`
  }
  if (docType === "active_license") {
    return `This is an international medical practice license or registration certificate.
${REJECT_INSTRUCTIONS}
If this IS a valid medical license, extract: full name, license number, issuing authority, country, specialisation if shown, issue date, expiry date. Return a boolean is_active if the document states active/valid.
Return ONLY this JSON (null for fields not found):
{
  "is_valid_medical_document": true,
  "full_name": "doctor name",
  "license_number": "license / registration number",
  "issuing_authority": "medical board / council name or null",
  "country": "issuing country or null",
  "specialisation": "speciality if shown or null",
  "issue_date": "YYYY-MM-DD or null",
  "expiry_date": "YYYY-MM-DD or null",
  "is_active": true or false
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

  // Extract name (handles ALL-CAPS, mixed case, hyphenated, apostrophes)
  const nameMatch = text.match(/(?:name\s*[:\-]?\s*)((?:Dr\.?\s+)?[A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){1,5})/i)
    || text.match(/(?:certif(?:y|ied)\s+that\s+)((?:Dr\.?\s+)?[A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){1,5})/i)
    || text.match(/(Dr\.?\s+[A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){1,5})/i)
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
    const degreeMatch = text.match(/(M\.?S\.?\s*(?:\([^)]{3,40}\)|in\s+[A-Za-z\s]{3,40}))/i)
      || text.match(/(M\.?Ch\.?\s*(?:\([^)]{3,40}\)|in\s+[A-Za-z\s]{3,40}))/i)
      || text.match(/(D\.?N\.?B\.?\s*(?:\([^)]{3,40}\)|in\s+[A-Za-z\s]{3,40}))/i)
      || text.match(/(M\.?S\.?|M\.?Ch\.?|D\.?N\.?B\.?)/i)
      || text.match(/(M\.?B\.?B\.?S\.?)/i)
    if (degreeMatch) extracted.degree = degreeMatch[1].trim()

    const uniMatch = text.match(/([A-Za-z\s]+university)/i) || text.match(/(?:university\s+of\s+)([A-Za-z\s]+)/i)
    if (uniMatch) extracted.university = uniMatch[1].trim()

    const collegeMatch = text.match(/([A-Za-z\s]{3,50}(?:medical|college|institute)[A-Za-z\s]{0,30})/i)
    if (collegeMatch) extracted.college = collegeMatch[1].trim().replace(/\s+/g, " ").slice(0, 80)

    // Try to find year near contextual keywords first, then fall back
    const contextYearMatch = text.match(/(?:pass(?:ed|ing)|confer(?:red)?|complet(?:ed|ion)|award(?:ed)?|year\s*of\s*passing)\s*[:\-]?\s*(?:\w+\s+)?(19\d{2}|20[0-2]\d)/i)
    if (contextYearMatch) {
      extracted.year_of_passing = contextYearMatch[1]
    } else {
      const yearMatch = text.match(/\b(19\d{2}|20[0-2]\d)\b/g)
      if (yearMatch) {
        // Pick second-to-last if multiple (last is often issue date), otherwise pick the only one
        extracted.year_of_passing = yearMatch.length > 1 ? yearMatch[yearMatch.length - 2] : yearMatch[0]
      }
    }
  }

  // Extract ASI number
  if (docType === "asi_member_certificate") {
    const asiMatch = text.match(/(?:membership\s*(?:no|number)\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i)
    if (asiMatch) extracted.asi_membership_number = asiMatch[1].trim()
  }

  return extracted
}

function checkEligibility(docType: string, extracted: Record<string, any>) {
  const degree = extracted.degree_name || extracted.degree
  if (docType !== "pg_degree_certificate" || !degree) return null

  const fullDegree = extracted.specialisation ? `${degree} (${extracted.specialisation})` : degree
  const degreeLower = fullDegree.toLowerCase()
  const degreeNormalized = degreeLower.replace(/\./g, "").replace(/\s+/g, "")
  const isBlocked = BLOCKED_DEGREES.some((d) => degreeLower.includes(d) || degreeNormalized.includes(d.replace(/\./g, "").replace(/\s+/g, "")))
  const isSurgical = SURGICAL_DEGREES.some((d) => degreeLower.includes(d) || degreeNormalized.includes(d.replace(/\./g, "").replace(/\s+/g, "")))

  if (isBlocked) {
    return {
      eligible: false,
      reason: `${fullDegree} is not eligible for AMASI membership. Only surgical PG degrees (MS, MCh, DNB in surgical specialties) are accepted.`,
    }
  }
  if (degreeNormalized === "mbbs" || degreeNormalized === "mbbs()" ) {
    return {
      eligible: false,
      softBlock: true,
      reason: "AI detected MBBS — if this is actually an MS/MD/MCh/DNB certificate, the AI may have misread it. Click 'Request Admin Review' to continue.",
    }
  }
  if (isSurgical) {
    return { eligible: true, reason: `${fullDegree} is eligible for AMASI membership.` }
  }
  return { eligible: true, reason: `Degree noted: ${fullDegree}. Please ensure this is a surgical specialty.` }
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
    const degree = (extracted.degree_name || extracted.degree || "").toLowerCase()
    const college = (extracted.institution_name || extracted.college || "").toLowerCase()
    const university = (extracted.university_name || extracted.university || "").toLowerCase()

    // Must have a degree name — no degree = not a degree certificate
    if (!degree) {
      return "No degree name could be extracted. This does not appear to be a medical degree certificate."
    }

    if (FINANCIAL_KEYWORDS.some((kw) => degree.includes(kw) || college.includes(kw) || university.includes(kw))) {
      return "Extracted data contains financial terms. This does not appear to be a medical degree certificate."
    }

    // Degree should contain medical terms — normalize dots for matching
    const degreeNormalized = degree.replace(/\./g, "")
    const validDegreeTerms = ["ms", "md", "mch", "dnb", "mbbs", "frcs", "mrcs", "diploma", "surgery", "medicine"]
    const hasValidDegree = validDegreeTerms.some((t) => degreeNormalized.includes(t) || degree.includes(t))
    if (!hasValidDegree) {
      return `"${extracted.degree_name || extracted.degree}" does not appear to be a recognized medical degree.`
    }

    // Must also have a university or college — a degree certificate always has an issuing institution
    if (!college && !university) {
      return "No university or college found. This does not appear to be a medical degree certificate."
    }
  }

  // For MCI certificate: must have a registration number
  if (docType === "mci_certificate") {
    if (!extracted.registration_number && !extracted.full_name && !extracted.name) {
      return "No registration number or doctor name found. This does not appear to be a medical council certificate."
    }
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`ocr:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ success: false, error: "Too many requests. Try again later." }, { status: 429 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const docType = formData.get("docType") as string

    if (!file || !docType) {
      return Response.json({ success: false, error: "Missing file or docType" }, { status: 400 })
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ success: false, error: "File too large. Maximum 5 MB." }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Validate magic bytes — only accept JPEG, PNG, PDF
    const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8
    const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
    const isPDF = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
    if (!isJPEG && !isPNG && !isPDF) {
      return Response.json({ success: false, error: "Invalid file format. Only JPG, PNG, and PDF are accepted." }, { status: 400 })
    }

    // Preprocess images — deskew, denoise, contrast enhance (PDFs sent as document type)
    let sendBuffer: Buffer<ArrayBuffer> = buffer
    let sendMimeType = file.type || "image/jpeg"
    if (!isPDF) {
      const processed = await preprocessImage(buffer, sendMimeType)
      sendBuffer = Buffer.from(processed.buffer)
      sendMimeType = processed.mimeType
    }

    const base64 = sendBuffer.toString("base64")

    let extracted: Record<string, any> = {}
    let usedClaude = false

    // Try Claude Vision first
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
    if (apiKey) {
      try {
        const client = new Anthropic({ apiKey })
        let prompt = buildPrompt(docType)
        if (!prompt) {
          return Response.json({ success: false, error: "Unknown document type" }, { status: 400 })
        }

        const message = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [
              isPDF
                ? { type: "document", source: { type: "base64", media_type: "application/pdf" as const, data: base64 } }
                : { type: "image", source: { type: "base64", media_type: sendMimeType as any, data: base64 } },
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
        console.error("Claude Vision failed, falling back to OCR.space:", claudeError.message)
      }
    }

    // Fallback to OCR.space
    if (!usedClaude) {
      try {
        extracted = await fallbackOCR(buffer, file.name, docType)
      } catch (ocrErr: any) {
        console.error("OCR.space fallback also failed:", ocrErr.message)
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

    // Certificate expiry validation
    const expiryWarnings: string[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    function parseExtractedDate(dateStr: string | null | undefined): Date | null {
      if (!dateStr || dateStr === "null") return null
      // Try YYYY-MM-DD
      let m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (m) return new Date(+m[1], +m[2] - 1, +m[3])
      // Try DD/MM/YYYY or DD-MM-YYYY
      m = dateStr.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/)
      if (m) return new Date(+m[3], +m[2] - 1, +m[1])
      return null
    }

    if (docType === "mci_certificate") {
      const validityDate = parseExtractedDate(extracted.validity_date || extracted.valid_upto)
      if (validityDate && validityDate < today) {
        const monthsAgo = Math.round((today.getTime() - validityDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
        expiryWarnings.push(`MCI/SMC certificate expired ${monthsAgo} month(s) ago. Please upload a renewed certificate, or contact your state medical council for renewal.`)
      }
    }
    if (docType === "asi_member_certificate") {
      const validityYear = extracted.validity_year
      if (validityYear) {
        const year = parseInt(String(validityYear).match(/\d{4}/)?.[0] || "0")
        if (year > 0 && year < today.getFullYear()) {
          expiryWarnings.push(`ASI certificate is from ${year}. Please upload your current year (${today.getFullYear()}) certificate. Download it from the ASI member portal.`)
        }
      }
    }
    if (docType === "active_license") {
      const expiryDate = parseExtractedDate(extracted.expiry_date || extracted.valid_upto)
      if (expiryDate && expiryDate < today) {
        expiryWarnings.push("Practice license has expired. Please upload a valid, current license from your medical board.")
      }
      if (extracted.is_active === false) {
        expiryWarnings.push("License is marked as inactive. Please upload an active license.")
      }
    }
    if (docType === "letter_hod") {
      const letterDate = parseExtractedDate(extracted.letter_date)
      if (letterDate) {
        const daysSince = Math.round((today.getTime() - letterDate.getTime()) / (1000 * 60 * 60 * 24))
        if (daysSince > 180) {
          expiryWarnings.push(`HOD letter is ${Math.round(daysSince / 30)} months old. Please request a fresh letter from your Head of Department — it must be dated within the last 6 months.`)
        }
      }
      if (extracted.has_letterhead === false) expiryWarnings.push("No official letterhead detected. Letter must be on institutional letterhead.")
      if (extracted.has_signature === false) expiryWarnings.push("No signature detected. Letter must be signed by the HOD.")
    }

    if (expiryWarnings.length > 0) {
      extracted._expiry_warnings = expiryWarnings
    }

    // Eligibility check
    const eligibility = checkEligibility(docType, extracted)

    // Upload file to Supabase Storage for admin review
    let fileUrl: string | null = null
    try {
      const { createAdminClient } = await import("@/lib/supabase")
      const supabase = createAdminClient()
      const ext = isPDF ? "pdf" : isPNG ? "png" : "jpg"
      const fileName = `${docType}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(fileName, buffer, {
          contentType: file.type || (isPDF ? "application/pdf" : isPNG ? "image/png" : "image/jpeg"),
          upsert: false,
        })

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(fileName)
        fileUrl = urlData?.publicUrl || null
      } else {
        console.error("Document upload error:", uploadError.message)
      }
    } catch (uploadErr: any) {
      // Non-blocking — OCR result still returned even if storage fails
      console.error("Document storage error:", uploadErr.message)
    }

    return Response.json({
      success: true,
      extracted,
      eligibility,
      expiryWarnings: expiryWarnings.length > 0 ? expiryWarnings : undefined,
      docType,
      engine: usedClaude ? "claude-vision" : "tesseract",
      fileUrl,
    })
  } catch (error: any) {
    console.error("OCR API error:", error)
    return Response.json({ success: false, error: "Could not process this document. Please try a clearer image." }, { status: 500 })
  }
}
