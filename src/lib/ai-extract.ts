import type { ApplicationFormData } from "./membership-types"
import { STATE_TO_ZONE } from "./membership-types"

export interface ExtractionResult {
  field: string
  value: string
  confidence: "high" | "medium" | "low"
  source: string
}

export function extractFromMCICertificate(text: string): ExtractionResult[] {
  const results: ExtractionResult[] = []
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const fullText = text.toLowerCase()

  // Extract registration number - look for patterns like REG NO, REGISTRATION NO, etc
  const regPatterns = [
    /(?:reg(?:istration)?\.?\s*(?:no|number)\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i,
    /(?:certificate\s*no\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i,
    /([A-Z]{2,5}(?:MC|MR|FM|SMC)[A-Z]*\d{3,})/i,
    /(\d{4,}\/?\d*)/,
  ]
  for (const pattern of regPatterns) {
    const match = text.match(pattern)
    if (match) {
      results.push({
        field: "mciCouncilNumber",
        value: match[1].trim(),
        confidence: "high",
        source: "MCI Certificate",
      })
      break
    }
  }

  // Extract name - usually after "Name:", "Dr.", etc
  const namePatterns = [
    /(?:name\s*[:\-]?\s*)((?:Dr\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    /(?:certif(?:y|ied)\s+that\s+)((?:Dr\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    /(Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
  ]
  for (const pattern of namePatterns) {
    const match = text.match(pattern)
    if (match) {
      const name = match[1].replace(/^Dr\.?\s*/i, "").trim()
      const parts = name.split(/\s+/)
      if (parts.length >= 1) {
        results.push({ field: "firstName", value: parts[0], confidence: "high", source: "MCI Certificate" })
        if (parts.length >= 3) {
          results.push({ field: "middleName", value: parts[1], confidence: "medium", source: "MCI Certificate" })
          results.push({ field: "lastName", value: parts.slice(2).join(" "), confidence: "medium", source: "MCI Certificate" })
        } else if (parts.length === 2) {
          results.push({ field: "lastName", value: parts[1], confidence: "high", source: "MCI Certificate" })
        }
      }
      break
    }
  }

  // Extract state from council name
  const stateNames = Object.keys(STATE_TO_ZONE)
  for (const state of stateNames) {
    if (fullText.includes(state.toLowerCase())) {
      results.push({ field: "mciCouncilState", value: state, confidence: "high", source: "MCI Certificate" })
      results.push({ field: "state", value: state, confidence: "medium", source: "MCI Certificate" })
      results.push({ field: "zone", value: STATE_TO_ZONE[state], confidence: "medium", source: "MCI Certificate" })
      break
    }
  }

  // Detect gender from salutation or text
  if (/\b(mr|male|son|father)\b/i.test(text)) {
    results.push({ field: "gender", value: "Male", confidence: "medium", source: "MCI Certificate" })
  } else if (/\b(ms|mrs|miss|female|daughter|mother)\b/i.test(text)) {
    results.push({ field: "gender", value: "Female", confidence: "medium", source: "MCI Certificate" })
  }

  // Extract father's name
  const fatherMatch = text.match(/(?:(?:s\/o|d\/o|son of|daughter of|father(?:'s)?\s*name)\s*[:\-]?\s*)((?:Mr\.?\s+|Shri\.?\s+|Late\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i)
  if (fatherMatch) {
    results.push({ field: "fatherName", value: fatherMatch[1].trim(), confidence: "high", source: "MCI Certificate" })
  }

  // Extract DOB
  const dobMatch = text.match(/(?:(?:d\.?o\.?b|date\s+of\s+birth|born)\s*[:\-]?\s*)(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})/i)
  if (dobMatch) {
    const parts = dobMatch[1].split(/[\-\/\.]/)
    if (parts.length === 3) {
      const year = parts[2].length === 2 ? `19${parts[2]}` : parts[2]
      const month = parts[1].padStart(2, "0")
      const day = parts[0].padStart(2, "0")
      results.push({ field: "dob", value: `${year}-${month}-${day}`, confidence: "medium", source: "MCI Certificate" })
    }
  }

  return results
}

export function extractFromDegreeCertificate(text: string): ExtractionResult[] {
  const results: ExtractionResult[] = []
  const fullText = text.toLowerCase()

  // Detect if PG or UG
  const pgDegrees = [
    "ms", "m.s", "md", "m.d", "mch", "m.ch", "dnb", "d.n.b",
    "diploma", "master of surgery", "master of science",
  ]
  const isPG = pgDegrees.some((d) => fullText.includes(d))

  // Extract degree name
  const degreePatterns = [
    /(M\.?S\.?\s*(?:\(|in\s+)?[A-Za-z\s]+(?:\))?)/i,
    /(M\.?Ch\.?\s*(?:\(|in\s+)?[A-Za-z\s]+(?:\))?)/i,
    /(D\.?N\.?B\.?\s*(?:\(|in\s+)?[A-Za-z\s]+(?:\))?)/i,
    /(M\.?D\.?\s*(?:\(|in\s+)?[A-Za-z\s]+(?:\))?)/i,
    /(M\.?B\.?B\.?S\.?)/i,
  ]
  for (const pattern of degreePatterns) {
    const match = text.match(pattern)
    if (match) {
      const prefix = isPG ? "eduPostgrad" : "eduUndergrad"
      results.push({
        field: `${prefix}Degree`,
        value: match[1].trim(),
        confidence: "high",
        source: "Degree Certificate",
      })
      break
    }
  }

  // Extract university
  const uniPatterns = [
    /(?:university\s+of\s+)([A-Za-z\s]+)/i,
    /([A-Za-z\s]+university)/i,
  ]
  for (const pattern of uniPatterns) {
    const match = text.match(pattern)
    if (match) {
      const prefix = isPG ? "eduPostgrad" : "eduUndergrad"
      results.push({
        field: `${prefix}University`,
        value: match[1].trim(),
        confidence: "high",
        source: "Degree Certificate",
      })
      break
    }
  }

  // Extract college
  const collegePatterns = [
    /([A-Za-z\s]+(?:medical|college|institute)[A-Za-z\s]*)/i,
  ]
  for (const pattern of collegePatterns) {
    const match = text.match(pattern)
    if (match) {
      const prefix = isPG ? "eduPostgrad" : "eduUndergrad"
      results.push({
        field: `${prefix}College`,
        value: match[1].trim().slice(0, 80),
        confidence: "medium",
        source: "Degree Certificate",
      })
      break
    }
  }

  // Extract year
  const yearMatch = text.match(/\b(19\d{2}|20[0-2]\d)\b/g)
  if (yearMatch) {
    const years = yearMatch.map(Number).sort()
    const latestYear = years[years.length - 1]
    const prefix = isPG ? "eduPostgrad" : "eduUndergrad"
    results.push({
      field: `${prefix}Year`,
      value: String(latestYear),
      confidence: "medium",
      source: "Degree Certificate",
    })
  }

  // Also extract name from degree certificate
  const namePatterns = [
    /(?:conferred\s+(?:upon|on|to)\s+)((?:Dr\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    /(?:awarded\s+to\s+)((?:Dr\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    /(?:certif(?:y|ied)\s+that\s+)((?:Dr\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
  ]
  for (const pattern of namePatterns) {
    const match = text.match(pattern)
    if (match) {
      const name = match[1].replace(/^Dr\.?\s*/i, "").trim()
      const parts = name.split(/\s+/)
      if (parts[0]) {
        results.push({ field: "firstName", value: parts[0], confidence: "medium", source: "Degree Certificate" })
      }
      break
    }
  }

  return results
}

export function extractFromASICertificate(text: string): ExtractionResult[] {
  const results: ExtractionResult[] = []

  // Extract ASI membership number
  const membershipPatterns = [
    /(?:membership\s*(?:no|number)\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i,
    /(?:member\s*(?:no|id)\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i,
    /(?:asi\s*(?:no|number)\.?\s*[:\-]?\s*)([A-Z0-9\/\-]+)/i,
  ]
  for (const pattern of membershipPatterns) {
    const match = text.match(pattern)
    if (match) {
      results.push({
        field: "asiMembershipNo",
        value: match[1].trim(),
        confidence: "high",
        source: "ASI Certificate",
      })
      break
    }
  }

  return results
}

export function applyExtractions(
  current: ApplicationFormData,
  extractions: ExtractionResult[]
): ApplicationFormData {
  const updated = { ...current }
  for (const ext of extractions) {
    const key = ext.field as keyof ApplicationFormData
    // Only apply if the field is empty or extraction is high confidence
    if (key in updated && typeof updated[key] === "string") {
      const currentVal = updated[key] as string
      if (!currentVal || ext.confidence === "high") {
        (updated as any)[key] = ext.value
      }
    }
  }
  return updated
}
