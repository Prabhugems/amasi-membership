/**
 * AI Approval Engine
 * Scores an application 0-100% based on document verification.
 * Auto-approves if score >= 80% and payment is paid.
 */

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

/** Calculate similarity between two strings (0-1) */
function similarity(a: string, b: string): number {
  const s1 = normalize(a)
  const s2 = normalize(b)
  if (!s1 || !s2) return 0
  if (s1 === s2) return 1

  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.9

  // Check word overlap
  const words1 = new Set(s1.split(" "))
  const words2 = new Set(s2.split(" "))
  const intersection = [...words1].filter(w => words2.has(w) && w.length > 2)
  const union = new Set([...words1, ...words2])
  const jaccard = intersection.length / union.size

  // Check first name match (most important)
  const firstName1 = s1.split(" ")[0]
  const firstName2 = s2.split(" ")[0]
  const firstNameMatch = firstName1 === firstName2 ? 0.5 : 0

  return Math.min(1, jaccard + firstNameMatch)
}

export interface ApprovalCheck {
  check: string
  passed: boolean
  score: number     // 0-100
  weight: number    // importance weight
  detail: string
}

export interface ApprovalResult {
  totalScore: number        // 0-100
  autoApprove: boolean
  checks: ApprovalCheck[]
  flags: string[]
}

/** Call NMC API to verify doctor registration */
async function verifyWithNmc(regNo: string, state?: string): Promise<{ verified: boolean; name?: string; council?: string; degree?: string }> {
  if (!regNo) return { verified: false }
  try {
    const res = await fetch("https://www.nmc.org.in/MCIRest/open/getDataFromService?service=searchDoctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationNo: regNo.trim(), smcId: "" }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { verified: false }
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return { verified: false }

    let match = data
    if (state) {
      const stateLower = state.toLowerCase()
      const filtered = data.filter((d: any) => (d.smcName || "").toLowerCase().includes(stateLower))
      if (filtered.length > 0) match = filtered
    }

    const doc = match[0]
    return { verified: true, name: doc.firstName, council: doc.smcName, degree: doc.doctorDegree }
  } catch {
    return { verified: false }
  }
}

export async function scoreApplication(
  formData: Record<string, any>,
  uploads: Record<string, { status: string; extracted: Record<string, any>; message?: string }>,
  paymentPaid: boolean
): ApprovalResult {
  const checks: ApprovalCheck[] = []
  const flags: string[] = []

  // --- 1. Name Match Across Documents (weight: 20) ---
  const formName = [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(" ")
  const docNames: { doc: string; name: string }[] = []

  for (const [docType, upload] of Object.entries(uploads)) {
    if (upload.extracted?.name) {
      docNames.push({ doc: docType, name: upload.extracted.name })
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
  const ocrDegree = normalize(uploads.pg_degree_certificate?.extracted?.degree || "")
  let degreeMatchScore = 0

  if (isBlocked) {
    degreeMatchScore = 0
    flags.push(`Blocked degree: ${formData.eduPostgradDegree} (Ayurvedic/Homeopathy/Non-surgical)`)
  } else if (!pgDegree) {
    degreeMatchScore = 0
    flags.push("No PG degree specified")
  } else if (ocrDegree) {
    const degreeSim = similarity(pgDegree, ocrDegree)
    degreeMatchScore = degreeSim * 100
    if (degreeSim < 0.5) {
      flags.push(`Degree mismatch: Form says "${formData.eduPostgradDegree}" but certificate shows "${uploads.pg_degree_certificate?.extracted?.degree}"`)
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
        ? `Form: "${formData.eduPostgradDegree}" vs Certificate: "${uploads.pg_degree_certificate?.extracted?.degree}" — ${Math.round(degreeMatchScore)}%`
        : `${formData.eduPostgradDegree} — ${isSurgical ? "valid surgical" : "unverified"}`,
  })

  // --- 3. College/University Match (weight: 15) ---
  const formCollege = normalize(formData.eduPostgradCollege || "")
  const ocrCollege = normalize(uploads.pg_degree_certificate?.extracted?.college || "")
  const formUni = normalize(formData.eduPostgradUniversity || "")
  const ocrUni = normalize(uploads.pg_degree_certificate?.extracted?.university || "")

  let collegeScore = 0
  if (formCollege && ocrCollege) {
    const collegeSim = similarity(formCollege, ocrCollege)
    collegeScore += collegeSim * 50
    if (collegeSim < 0.5) flags.push(`College mismatch: Form "${formData.eduPostgradCollege}" vs Certificate "${uploads.pg_degree_certificate?.extracted?.college}"`)
  } else if (formCollege) {
    collegeScore += 30 // Has college but no OCR to verify
  }

  if (formUni && ocrUni) {
    const uniSim = similarity(formUni, ocrUni)
    collegeScore += uniSim * 50
    if (uniSim < 0.5) flags.push(`University mismatch: Form "${formData.eduPostgradUniversity}" vs Certificate "${uploads.pg_degree_certificate?.extracted?.university}"`)
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
  const ocrMci = normalize(uploads.mci_certificate?.extracted?.registration_number || "")
  let mciScore = 0

  if (formMci && ocrMci) {
    const mciSim = formMci === ocrMci ? 100 : similarity(formMci, ocrMci) * 100
    mciScore = mciSim
    if (mciSim < 80) flags.push(`MCI number mismatch: Form "${formData.mciCouncilNumber}" vs Certificate "${uploads.mci_certificate?.extracted?.registration_number}"`)
  } else if (formMci) {
    mciScore = 50 // Has number but no OCR verification
  } else {
    flags.push("No MCI/Council number provided")
  }

  checks.push({
    check: "MCI/Council registration verification",
    passed: mciScore >= 60,
    score: Math.round(mciScore),
    weight: 15,
    detail: formMci && ocrMci
      ? `Form: "${formData.mciCouncilNumber}" vs Certificate: "${uploads.mci_certificate?.extracted?.registration_number}" — ${Math.round(mciScore)}%`
      : formMci ? "Number provided, no OCR verification" : "No MCI number",
  })

  // --- 5. Document Verification Status (weight: 10) ---
  const totalDocs = Object.keys(uploads).length
  const verifiedDocs = Object.values(uploads).filter(u => u.status === "extracted").length
  const pendingDocs = Object.values(uploads).filter(u => u.status === "uploaded").length
  const rejectedDocs = Object.values(uploads).filter(u => u.status === "rejected" || u.status === "blocked").length

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

  // --- 6. NMC Live Verification (weight: 20) ---
  const formMciNumber = (formData.mciCouncilNumber || "").trim()
  const formMciState = formData.mciCouncilState || ""
  let nmcScore = 0
  let nmcDetail = "Not checked"

  if (formMciNumber) {
    const nmcResult = await verifyWithNmc(formMciNumber, formMciState)
    if (nmcResult.verified) {
      nmcScore = 100
      nmcDetail = `NMC Verified: ${nmcResult.name} — ${nmcResult.council} (${nmcResult.degree})`
      // Cross-check name
      const nmcNameSim = similarity(formName, nmcResult.name || "")
      if (nmcNameSim < 0.5) {
        nmcScore = 60
        flags.push(`NMC name mismatch: Form "${formName}" vs NMC "${nmcResult.name}"`)
        nmcDetail += ` — NAME MISMATCH`
      }
    } else {
      nmcScore = 0
      nmcDetail = `MCI #${formMciNumber} not found in NMC database`
      flags.push(`MCI number ${formMciNumber} not found in NMC Indian Medical Register`)
    }
  } else {
    nmcDetail = "No MCI number provided"
  }

  checks.push({
    check: "NMC Live Verification",
    passed: nmcScore >= 60,
    score: nmcScore,
    weight: 20,
    detail: nmcDetail,
  })

  // --- Calculate total weighted score ---
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0)
  const weightedScore = checks.reduce((sum, c) => sum + (c.score * c.weight / 100), 0)
  const totalScore = Math.round((weightedScore / totalWeight) * 100)

  // --- Auto-approve decision ---
  const hasBlockedDegree = isBlocked
  const allCriticalPassed = checks.filter(c => c.weight >= 20).every(c => c.passed)
  const autoApprove = totalScore >= 80 && paymentPaid && !hasBlockedDegree && allCriticalPassed

  return {
    totalScore,
    autoApprove,
    checks,
    flags,
  }
}
