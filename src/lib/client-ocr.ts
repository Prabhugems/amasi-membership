import { createWorker, type Worker } from "tesseract.js"
import {
  extractFromMCICertificate,
  extractFromDegreeCertificate,
  extractFromASICertificate,
  applyExtractions,
} from "./ai-extract"
import type { ExtractionResult } from "./ai-extract"
import type { ApplicationFormData } from "./membership-types"

let workerInstance: Worker | null = null
let workerReady = false

async function getWorker(): Promise<Worker> {
  if (workerInstance && workerReady) return workerInstance
  workerInstance = await createWorker("eng")
  workerReady = true
  return workerInstance
}

// Pre-warm the worker on page load
export function preloadOCR() {
  getWorker().catch(() => {})
}

const MEDICAL_KEYWORDS = [
  "medical", "council", "registration", "certificate", "degree",
  "university", "college", "surgery", "doctor", "medicine",
  "hospital", "mbbs", "diploma", "board", "examination",
  "surgeon", "practitioner", "license", "member", "association",
  "conferred", "awarded", "hereby", "certify", "qualifying",
  "qualification", "registered", "practice", "health", "clinical",
]

export interface OCRProcessResult {
  success: boolean
  text: string
  extractions: ExtractionResult[]
  isIrrelevant: boolean
  message: string
}

export async function processDocument(
  imageUrl: string,
  docType: string,
  formData: ApplicationFormData
): Promise<OCRProcessResult> {
  try {
    const worker = await getWorker()
    const { data: { text } } = await worker.recognize(imageUrl)

    if (!text || text.trim().length < 10) {
      return {
        success: false,
        text: "",
        extractions: [],
        isIrrelevant: true,
        message: "No readable text found. Please upload a clearer image of your document.",
      }
    }

    // Check relevance
    const lowerText = text.toLowerCase()
    const matchedKeywords = MEDICAL_KEYWORDS.filter((kw) => lowerText.includes(kw))

    if (matchedKeywords.length < 2) {
      return {
        success: false,
        text: text.slice(0, 200),
        extractions: [],
        isIrrelevant: true,
        message: "This doesn't look like a medical document. Please upload your actual certificate.",
      }
    }

    // Extract fields based on document type
    let extractions: ExtractionResult[] = []
    if (docType === "mci_certificate") {
      extractions = extractFromMCICertificate(text)
    } else if (docType === "pg_degree_certificate" || docType === "mbbs_degree_certificate") {
      extractions = extractFromDegreeCertificate(text)
    } else if (docType === "asi_member_certificate") {
      extractions = extractFromASICertificate(text)
    }

    return {
      success: true,
      text,
      extractions,
      isIrrelevant: false,
      message: extractions.length > 0
        ? `Extracted ${extractions.length} fields`
        : "Document verified as medical certificate",
    }
  } catch (error: any) {
    return {
      success: false,
      text: "",
      extractions: [],
      isIrrelevant: false,
      message: "Could not process document. Try a clearer image.",
    }
  }
}

export function terminateOCR() {
  if (workerInstance) {
    workerInstance.terminate()
    workerInstance = null
    workerReady = false
  }
}
