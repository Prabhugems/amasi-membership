/**
 * AI Approval Engine
 * Scores an application 0-100% based on document verification.
 * Auto-approves if score >= 80% and payment is paid.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { EXTRACTION_SKIPPED_KEYS, normalizeDocumentKey } from "@/lib/document-keys"
import { verifyWithNmcCached, type NmcCacheSource } from "@/lib/nmc-cache"

const BLOCKED_DEGREES = [
  "bams", "bums", "bhms", "bds", "bpt", "bot", "bnys",
  "md ayurveda", "md homeopathy", "md unani", "md siddha",
  "ms ayurveda", "ms homeopathy", "ms unani",
]

const VALID_SURGICAL_DEGREES = [
  "ms", "m.s", "mch", "m.ch", "dnb", "d.n.b",
  "frcs", "mrcs", "fics", "facs",
]

/** Normalize a string for comparison */
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/^(dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?|shri\.?)\s*/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Levenshtein distance between two strings */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/** Calculate similarity between two strings (0-1) using Levenshtein + token sort */
function similarity(a: string, b: string): number {
  const s1 = normalize(a)
  const s2 = normalize(b)
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1

  // Check if one contains the other (handles abbreviations like "R. Kumar" vs "Rajesh Kumar")
  if (s1.includes(s2) || s2.includes(s1)) return 0.9

  // Token sort — sort words alphabetically then compare (handles word order differences)
  const sorted1 = s1.split(" ").sort().join(" ")
  const sorted2 = s2.split(" ").sort().join(" ")
  if (sorted1 === sorted2) return 1

  // Levenshtein ratio on full strings
  const maxLen = Math.max(s1.length, s2.length)
  const fullRatio = 1 - levenshtein(s1, s2) / maxLen

  // Levenshtein ratio on token-sorted strings
  const sortedRatio = 1 - levenshtein(sorted1, sorted2) / Math.max(sorted1.length, sorted2.length)

  // Word overlap (Jaccard)
  const words1 = new Set(s1.split(" "))
  const words2 = new Set(s2.split(" "))
  const intersection = [...words1].filter(w => words2.has(w) && w.length > 2)
  const union = new Set([...words1, ...words2])
  const jaccard = union.size > 0 ? intersection.length / union.size : 0

  // First name match bonus
  const firstName1 = s1.split(" ")[0]
  const firstName2 = s2.split(" ")[0]
  const firstNameBonus = firstName1 === firstName2 ? 0.15
    : (1 - levenshtein(firstName1, firstName2) / Math.max(firstName1.length, firstName2.length)) > 0.8 ? 0.1
    : 0

  // Best of all methods + first name bonus
  return Math.min(1, Math.max(fullRatio, sortedRatio, jaccard) + firstNameBonus)
}

export interface ApprovalCheck {
  check: string
  passed: boolean
  score: number     // 0-100
  weight: number    // importance weight
  detail: string
}

export type NmcStatus = "verified" | "name_mismatch" | "not_found" | "skipped"

export interface NmcVerification {
  status: NmcStatus
  checked_at: string              // ISO timestamp
  returned_name: string | null
  returned_council: string | null
  returned_degree: string | null
}

export interface ApprovalResult {
  totalScore: number        // 0-100
  autoApprove: boolean
  blockingReasons: string[] // which of the 4 checks failed (empty if auto-approved)
  checks: ApprovalCheck[]
  flags: string[]
  nmcVerification: NmcVerification | null
  nmcApiStatus: string | null
  nmcResponseTimeMs: number | null
}

export async function scoreApplication(
  formData: Record<string, any>,
  uploads: Record<string, { status: string; extracted: Record<string, any>; message?: string }>,
  paymentPaid: boolean,
  supabase?: SupabaseClient,
): Promise<ApprovalResult> {
  const checks: ApprovalCheck[] = []
  const flags: string[] = []

  // Normalize upload keys so legacy keys (pg_certificate) resolve correctly
  const normalizedUploads: typeof uploads = {}
  for (const [key, value] of Object.entries(uploads)) {
    normalizedUploads[normalizeDocumentKey(key)] = value
  }

  // --- 1. Name Match Across Documents (weight: 20) ---
  const formName = [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(" ")
  const docNames: { doc: string; name: string }[] = []

  for (const [docType, upload] of Object.entries(normalizedUploads)) {
    const extractedName = upload.extracted?.full_name || upload.extracted?.name || upload.extracted?.applicant_name
    if (extractedName) {
      docNames.push({ doc: docType, name: extractedName })
    }
  }

  if (docNames.length >= 2) {
    // Cross-match all document names
    let nameMatches = 0
    let nameTotal = 0
    for (let i = 0; i < docNames.length; i++) {
      for (let j = i + 1; j < docNames.length; j++) {
        const sim = similarity(docNames[i].name, docNames[j].name)
        nameMatches += sim
        nameTotal++
        if (sim < 0.6) {
          flags.push(`Name mismatch: "${docNames[i].name}" (${docNames[i].doc}) vs "${docNames[j].name}" (${docNames[j].doc})`)
        }
      }
    }
    const avgNameMatch = nameTotal > 0 ? (nameMatches / nameTotal) * 100 : 0
    checks.push({
      check: "Name consistency across documents",
      passed: avgNameMatch >= 70,
      score: Math.round(avgNameMatch),
      weight: 20,
      detail: `${docNames.length} documents compared, ${Math.round(avgNameMatch)}% match`,
    })
  } else if (docNames.length === 1) {
    const sim = similarity(formName, docNames[0].name) * 100
    checks.push({
      check: "Name matches form data",
      passed: sim >= 60,
      score: Math.round(sim),
      weight: 20,
      detail: `Form: "${formName}" vs Doc: "${docNames[0].name}" — ${Math.round(sim)}% match`,
    })
    if (sim < 60) flags.push(`Name on document doesn't match form: "${docNames[0].name}" vs "${formName}"`)
  } else {
    checks.push({ check: "Name verification", passed: false, score: 0, weight: 25, detail: "No name found in documents" })
    flags.push("Could not verify name from documents")
  }

  // --- 2. Degree Validation (weight: 25) ---
  const pgDegree = normalize(formData.eduPostgradDegree || "")
  const isBlocked = BLOCKED_DEGREES.some(d => pgDegree.includes(d))
  const isSurgical = VALID_SURGICAL_DEGREES.some(d => pgDegree.includes(d))

  // Check degree from OCR matches form
  // Claude Vision returns degree_name + specialisation; fallback OCR returns degree — check both
  const pgExtracted = normalizedUploads.pg_degree_certificate?.extracted
  const rawOcrDegree = pgExtracted?.degree_name || pgExtracted?.degree || ""
  const ocrSpecialisation = pgExtracted?.specialisation || ""
  // Build the full OCR degree string for display and comparison
  const fullOcrDegree = ocrSpecialisation ? `${rawOcrDegree} (${ocrSpecialisation})` : rawOcrDegree
  const ocrDegree = normalize(fullOcrDegree)
  let degreeMatchScore = 0

  if (isBlocked) {
    degreeMatchScore = 0
    flags.push(`Blocked degree: ${formData.eduPostgradDegree} (Ayurvedic/Homeopathy/Non-surgical)`)
  } else if (!pgDegree) {
    degreeMatchScore = 0
    flags.push("No PG degree specified")
  } else if (ocrDegree) {
    // Pass RAW strings to similarity() — it normalizes internally.
    // Pre-normalized strings get double-normalized, stripping "ms" prefix
    // (intended for "Ms." honorific but matching "M.S." degree).
    const degreeSim = similarity(formData.eduPostgradDegree || "", fullOcrDegree)
    degreeMatchScore = degreeSim * 100
    if (degreeSim < 0.5) {
      flags.push(`Degree mismatch: Form says "${formData.eduPostgradDegree}" but certificate shows "${fullOcrDegree}"`)
    }
  } else if (isSurgical) {
    degreeMatchScore = 70 // Surgical degree but no OCR to cross-check
  } else {
    degreeMatchScore = 50 // Unknown degree, no OCR
    flags.push(`Degree "${formData.eduPostgradDegree}" needs manual verification`)
  }

  checks.push({
    check: "PG Degree validation",
    passed: degreeMatchScore >= 60 && !isBlocked,
    score: Math.round(degreeMatchScore),
    weight: 25,
    detail: isBlocked
      ? `BLOCKED: ${formData.eduPostgradDegree}`
      : ocrDegree
        ? `Form: "${formData.eduPostgradDegree}" vs Certificate: "${fullOcrDegree}" — ${Math.round(degreeMatchScore)}%`
        : `${formData.eduPostgradDegree} — ${isSurgical ? "valid surgical" : "unverified"}`,
  })

  // --- 3. College/University Match (weight: 15) ---
  const formCollege = normalize(formData.eduPostgradCollege || "")
  // Claude Vision returns institution_name; fallback OCR returns college — check both
  const ocrCollege = normalize(pgExtracted?.institution_name || pgExtracted?.college || "")
  const formUni = normalize(formData.eduPostgradUniversity || "")
  // Claude Vision returns university_name; fallback OCR returns university — check both
  const ocrUni = normalize(pgExtracted?.university_name || pgExtracted?.university || "")

  let collegeScore = 0
  if (formCollege && ocrCollege) {
    const collegeSim = similarity(formCollege, ocrCollege)
    collegeScore += collegeSim * 50
    if (collegeSim < 0.5) flags.push(`College mismatch: Form "${formData.eduPostgradCollege}" vs Certificate "${pgExtracted?.institution_name || pgExtracted?.college}"`)
  } else if (formCollege) {
    collegeScore += 30 // Has college but no OCR to verify
  }

  if (formUni && ocrUni) {
    const uniSim = similarity(formUni, ocrUni)
    collegeScore += uniSim * 50
    if (uniSim < 0.5) flags.push(`University mismatch: Form "${formData.eduPostgradUniversity}" vs Certificate "${pgExtracted?.university_name || pgExtracted?.university}"`)
  } else if (formUni) {
    collegeScore += 30
  }

  checks.push({
    check: "College & University match",
    passed: collegeScore >= 50,
    score: Math.round(collegeScore),
    weight: 15,
    detail: `College: ${formCollege || "N/A"} ${ocrCollege ? `vs "${ocrCollege}"` : "(no OCR)"} | University: ${formUni || "N/A"} ${ocrUni ? `vs "${ocrUni}"` : "(no OCR)"}`,
  })

  // --- 4. MCI/Registration Match (weight: 15) ---
  const formMci = normalize(formData.mciCouncilNumber || "")
  const ocrMci = normalize(normalizedUploads.mci_certificate?.extracted?.registration_number || "")
  let mciScore = 0
  let mciWeight = 15

  // ILM applicants don't need MCI registration — skip this check
  if (formData.membershipType === "ILM") {
    mciScore = 0
    mciWeight = 0
  } else if (formMci && ocrMci) {
    const mciSim = formMci === ocrMci ? 100 : similarity(formMci, ocrMci) * 100
    mciScore = mciSim
    if (mciSim < 80) flags.push(`MCI number mismatch: Form "${formData.mciCouncilNumber}" vs Certificate "${normalizedUploads.mci_certificate?.extracted?.registration_number}"`)
  } else if (formMci) {
    mciScore = 50 // Has number but no OCR verification
  } else {
    flags.push("No MCI/Council number provided")
  }

  checks.push({
    check: "MCI/Council registration verification",
    passed: mciScore >= 60,
    score: Math.round(mciScore),
    weight: mciWeight,
    detail: formData.membershipType === "ILM"
      ? "Skipped for ILM applicants"
      : formMci && ocrMci
        ? `Form: "${formData.mciCouncilNumber}" vs Certificate: "${normalizedUploads.mci_certificate?.extracted?.registration_number}" — ${Math.round(mciScore)}%`
        : formMci ? "Number provided, no OCR verification" : "No MCI number",
  })

  // --- 5. Document Verification Status (weight: 10) ---
  // Filter out photo/profile uploads — they skip OCR by design.
  // Derived from DOCUMENT_TYPES metadata (single source of truth in document-keys.ts).
  const ocrEntries = Object.entries(normalizedUploads).filter(
    ([key]) => !EXTRACTION_SKIPPED_KEYS.includes(normalizeDocumentKey(key))
  )
  const totalDocs = ocrEntries.length
  const verifiedDocs = ocrEntries.filter(([, u]) => u.status === "extracted").length
  const pendingDocs = ocrEntries.filter(([, u]) => u.status === "uploaded").length
  const rejectedDocs = ocrEntries.filter(([, u]) => u.status === "rejected" || u.status === "blocked").length

  const docScore = totalDocs > 0 ? (verifiedDocs / totalDocs) * 100 : 0
  if (pendingDocs > 0) flags.push(`${pendingDocs} document(s) pending manual verification`)
  if (rejectedDocs > 0) flags.push(`${rejectedDocs} document(s) rejected by AI`)

  checks.push({
    check: "Document AI verification",
    passed: docScore >= 80,
    score: Math.round(docScore),
    weight: 10,
    detail: `${verifiedDocs}/${totalDocs} verified by AI${pendingDocs > 0 ? `, ${pendingDocs} pending` : ""}${rejectedDocs > 0 ? `, ${rejectedDocs} rejected` : ""}`,
  })

  // --- 6. NMC Verification with Cache (weight: 20, or 0 when skipped) ---
  const formMciNumber = (formData.mciCouncilNumber || "").trim()
  const formMciState = formData.mciCouncilState || ""
  let nmcScore = 0
  let nmcWeight = 20
  let nmcPassed = false
  let nmcDetail = "Not checked"
  let nmcVerification: NmcVerification | null = null
  let nmcApiStatus: NmcCacheSource | null = null
  let nmcResponseTimeMs: number | null = null

  // ILM applicants don't have NMC registration — skip entirely
  if (formData.membershipType === "ILM") {
    nmcWeight = 0
    nmcPassed = true
    nmcScore = 0
    nmcDetail = "Skipped for ILM applicants (international members)"
    nmcApiStatus = "skipped_ilm"
  } else if (formMciNumber && supabase) {
    const nmcResult = await verifyWithNmcCached(supabase, formMciNumber, formMciState)
    const checkedAt = new Date().toISOString()
    nmcApiStatus = nmcResult.source
    nmcResponseTimeMs = nmcResult.responseTimeMs

    if (!nmcResult.reachable) {
      // Gov API down AND no cache — skip, don't penalize. Weight 0 renormalizes totalScore to /80.
      nmcScore = 0
      nmcWeight = 0
      nmcPassed = true
      nmcDetail = "NMC service unreachable — verification skipped, re-verify manually"
      flags.push("NMC service unreachable — verification skipped; admin to re-verify manually")
      nmcVerification = {
        status: "skipped",
        checked_at: checkedAt,
        returned_name: null,
        returned_council: null,
        returned_degree: null,
      }
    } else if (!nmcResult.found) {
      nmcScore = 0
      nmcPassed = false
      nmcDetail = `MCI #${formMciNumber} not found in NMC database`
      flags.push(`MCI number ${formMciNumber} not found in NMC Indian Medical Register`)
      nmcVerification = {
        status: "not_found",
        checked_at: checkedAt,
        returned_name: null,
        returned_council: null,
        returned_degree: null,
      }
    } else {
      const staleNote = nmcResult.stale ? " (stale cache — NMC API was down)" : ""
      const sourceNote = nmcResult.source === "live_cache_hit" ? " (cached)" : nmcResult.source === "stale_cache_hit" ? " (stale cache)" : ""
      const nmcNameSim = similarity(formName, nmcResult.name)
      if (nmcNameSim < 0.5) {
        nmcScore = 60
        nmcPassed = true
        nmcDetail = `NMC name mismatch: Form "${formName}" vs NMC "${nmcResult.name}" — ${nmcResult.council} (${nmcResult.degree})${sourceNote}`
        flags.push(`NMC name mismatch: Form "${formName}" vs NMC "${nmcResult.name}"`)
        nmcVerification = {
          status: "name_mismatch",
          checked_at: checkedAt,
          returned_name: nmcResult.name,
          returned_council: nmcResult.council,
          returned_degree: nmcResult.degree,
        }
      } else {
        nmcScore = 100
        nmcPassed = true
        nmcDetail = `NMC Verified: ${nmcResult.name} — ${nmcResult.council} (${nmcResult.degree})${sourceNote}`
        if (nmcResult.stale) {
          flags.push("NMC verification from stale cache — data may not reflect current registration status")
        }
        nmcVerification = {
          status: "verified",
          checked_at: checkedAt,
          returned_name: nmcResult.name,
          returned_council: nmcResult.council,
          returned_degree: nmcResult.degree,
        }
      }
    }
  } else if (formMciNumber && !supabase) {
    // No supabase client — fall back to "not checked" (e.g. standalone test scripts)
    nmcDetail = "NMC verification skipped (no database connection)"
    nmcWeight = 0
    nmcPassed = true
    nmcApiStatus = "unreachable_no_cache"
  } else {
    nmcDetail = "No MCI number provided"
  }

  checks.push({
    check: "NMC Live Verification",
    passed: nmcPassed,
    score: nmcScore,
    weight: nmcWeight,
    detail: nmcDetail,
  })

  // --- Calculate total weighted score (auto-renormalizes when NMC skipped → weight 0) ---
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0)
  const weightedScore = checks.reduce((sum, c) => sum + (c.score * c.weight / 100), 0)
  const totalScore = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0

  // --- Auto-approve decision: strict 4-check rule ---
  // Each core check must pass independently. Total score is still shown to admins
  // but no longer determines auto-approval.
  const nameCheck = checks.find(c => c.check.startsWith("Name"))
  const degreeCheck = checks.find(c => c.check === "PG Degree validation")
  const collegeCheck = checks.find(c => c.check === "College & University match")
  const mciCheck = checks.find(c => c.check === "MCI/Council registration verification")
  const docCheck = checks.find(c => c.check === "Document AI verification")

  // Build list of blocking reasons for ai_decisions logging
  const blockingReasons: string[] = []

  // Check 1: Name consistency >= 80%
  if (!nameCheck || nameCheck.score < 80) {
    blockingReasons.push("name_similarity_below_80")
  }

  // Check 2: College/University >= 85%
  if (!collegeCheck || collegeCheck.score < 85) {
    blockingReasons.push("college_match_below_85")
  }

  // Check 3: PG Degree must pass AND score >= 80%
  if (!degreeCheck || !degreeCheck.passed || degreeCheck.score < 80) {
    blockingReasons.push("degree_check_failed")
  }

  // Check 4: MCI registration >= 95% (skipped for ILM — mciCheck.weight === 0)
  if (mciCheck && mciCheck.weight > 0 && mciCheck.score < 95) {
    blockingReasons.push("mci_mismatch")
  }

  // All required documents must be extracted (not "uploaded" or missing)
  if (!docCheck || docCheck.score < 100) {
    blockingReasons.push("missing_required_documents")
  }

  // Blocked degree is a hard stop
  if (isBlocked) {
    blockingReasons.push("blocked_degree")
  }

  // NMC name mismatch is a blocking flag (NMC being down is NOT blocking)
  if (nmcVerification?.status === "name_mismatch") {
    blockingReasons.push("nmc_name_mismatch")
  }

  // Payment must be confirmed
  if (!paymentPaid) {
    blockingReasons.push("payment_pending")
  }

  const autoApprove = paymentPaid && blockingReasons.length === 0

  return {
    totalScore,
    autoApprove,
    blockingReasons,
    checks,
    flags,
    nmcVerification,
    nmcApiStatus,
    nmcResponseTimeMs,
  }
}
