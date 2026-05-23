/**
 * Per-key merge for the `uploads` sub-object of a draft application's
 * step_data. Stage B of the upload-cure (2026-05-23).
 *
 * BACKGROUND
 *   The pre-Stage-B save-draft route did a shallow merge:
 *     { ...existing.step_data, ...incoming.step_data }
 *   That replaced the `uploads` map wholesale. When the client posted an
 *   entry with `fileUrl: null` (the pre-Stage-A resume bug), the server's
 *   good fileUrl was overwritten with null — six paid applicants needed
 *   manual rebuilds on 2026-05-23 because of this. Stage A (commit
 *   2579b78) fixed the client-side cause; Stage B (this module) is
 *   defense-in-depth so even a still-buggy / stale / racing client can't
 *   damage the row.
 *
 * MERGE RULES (per docKey, comparing existing.uploads[k] vs incoming.uploads[k])
 *
 *   Rule 1.  Incoming entry has a truthy fileUrl
 *            → take incoming wholesale (a legitimate new/updated upload)
 *
 *   Rule 2.  Incoming entry's fileUrl is null / empty / whitespace-only
 *            AND existing entry has a truthy fileUrl
 *            → keep existing (the Stage B fix — refuse to clobber)
 *
 *   Rule 3.  Incoming key is absent from incoming.uploads
 *            → keep existing
 *            (closes the "empty incoming clobbers everything" hole; under
 *            this rule, posting uploads = {} is a no-op rather than a wipe)
 *
 *   Rule 4.  Existing key absent, incoming present
 *            → take incoming (the only place a fresh entry can land)
 *
 *   Rule 5 (REMOVAL).  Incoming entry === null
 *            → drop the key from merged (explicit removal sentinel)
 *
 *   Why a null sentinel? Rule 3 makes "key missing from incoming" mean
 *   "no opinion, keep existing." That conflicts with the old
 *   removal-by-omission flow (handleRemoveFile in apply/page.tsx used
 *   `delete copy[docType]`). The client must now signal a deliberate
 *   removal explicitly by sending `null` for the key. handleRemoveFile
 *   is patched in lockstep with this module.
 *
 * NEUTRALITY ON BYPASS MARKERS
 *   The rules above operate on whole entries, never on individual fields.
 *   When rule 1 takes incoming, incoming's bypass / bypassReason
 *   (or their absence) replace existing's. When rule 2 keeps existing,
 *   existing's bypass / bypassReason are preserved. This matches the
 *   intent: bypass markers travel with the fileUrl that earned them.
 */

export interface MergeUploadEntry {
  status?: string
  fileUrl?: string | null
  extracted?: Record<string, unknown>
  message?: string
  bypass?: boolean
  bypassReason?: string
  // Unknown future fields are carried through unchanged when the entry
  // is taken (rule 1 or rule 4). Index signature kept loose for
  // forward-compatibility with extensions the apply page may add.
  [key: string]: unknown
}

export function mergeDraftUploads(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, MergeUploadEntry> {
  const existingSafe =
    existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {}
  const incomingSafe =
    incoming && typeof incoming === "object" ? (incoming as Record<string, unknown>) : {}

  const out: Record<string, MergeUploadEntry> = {}

  // ── Pass 1: every key the incoming map mentions ──
  for (const [key, incomingRaw] of Object.entries(incomingSafe)) {
    // Rule 5: explicit removal sentinel.
    if (incomingRaw === null) {
      // Drop the key — don't carry existing through.
      continue
    }

    // Defensive: an incoming entry that isn't an object (string, number,
    // boolean, etc.) is treated as a no-op for that key — we fall back
    // to whatever existing has under rules 2/4.
    if (!incomingRaw || typeof incomingRaw !== "object") {
      const existingFallback = readEntry(existingSafe[key])
      if (existingFallback) out[key] = existingFallback
      continue
    }

    const incomingEntry = incomingRaw as MergeUploadEntry
    const incomingFileUrl = entryFileUrl(incomingEntry)

    if (incomingFileUrl) {
      // Rule 1
      out[key] = incomingEntry
      continue
    }

    const existingEntry = readEntry(existingSafe[key])
    const existingFileUrl = existingEntry ? entryFileUrl(existingEntry) : null

    if (existingFileUrl) {
      // Rule 2 — the Stage B fix
      out[key] = existingEntry as MergeUploadEntry
    } else {
      // Neither side has a fileUrl. Fresh / pre-OCR state. Take incoming
      // so the client's own representation (status: "processing", etc.)
      // is visible to the next read.
      out[key] = incomingEntry
    }
  }

  // ── Pass 2: every key existing has that incoming did NOT mention ──
  // Rule 3 — keep existing on missing.
  for (const [key, existingRaw] of Object.entries(existingSafe)) {
    if (key in incomingSafe) continue // already handled above
    const existingEntry = readEntry(existingRaw)
    if (existingEntry) out[key] = existingEntry
  }

  return out
}

function readEntry(raw: unknown): MergeUploadEntry | null {
  if (!raw || typeof raw !== "object") return null
  return raw as MergeUploadEntry
}

function entryFileUrl(entry: MergeUploadEntry | null | undefined): string | null {
  if (!entry || typeof entry !== "object") return null
  const fileUrl = entry.fileUrl
  if (typeof fileUrl !== "string") return null
  const trimmed = fileUrl.trim()
  return trimmed.length > 0 ? trimmed : null
}
