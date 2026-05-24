"use client"

// Per-document upload control for admin-attached docs (when an applicant
// emails their MCI cert / PG degree etc instead of uploading via the
// apply page). Used by:
//   - /pending Edit dialog       → kind="application"
//   - /incomplete (drafts)       → kind="draft"
//
// Behaviour is identical for both; the difference is which JSONB the
// server writes to (applications.documents vs draft_applications.step_data.uploads).
// The bypass:user_bypass marker is set server-side — admin never sees it.

import { useRef, useState } from "react"
import { CheckCircle, AlertCircle, Upload, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { DOC_LABELS, type DocType } from "@/lib/membership-types"
import { cn } from "@/lib/utils"

interface ExistingDoc {
  fileUrl?: string | null
  url?: string | null
  status?: string
  bypass?: boolean
}

interface AdminDocumentUploaderProps {
  kind: "application" | "draft"
  id: string
  /** Required doc keys for this membership type (from MEMBERSHIP_TYPES.requiredDocs). */
  requiredDocs: string[]
  /** Currently-uploaded docs keyed by docKey. Pass app.documents or step_data.uploads. */
  existingDocs: Record<string, ExistingDoc | undefined> | null | undefined
  /** Called after a successful upload so the parent can refetch and re-render. */
  onUploaded?: (docKey: string, fileUrl: string) => void
}

function docLabel(key: string): string {
  return DOC_LABELS[key as DocType] || key.replace(/_/g, " ")
}

export function AdminDocumentUploader({
  kind,
  id,
  requiredDocs,
  existingDocs,
  onUploaded,
}: AdminDocumentUploaderProps) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Documents
      </p>
      <div className="border rounded-md divide-y bg-card">
        {requiredDocs.map((docKey) => {
          const existing = existingDocs?.[docKey]
          const fileUrl = existing?.fileUrl || existing?.url || null
          return (
            <DocumentRow
              key={docKey}
              kind={kind}
              id={id}
              docKey={docKey}
              currentUrl={fileUrl}
              status={existing?.status}
              onUploaded={onUploaded}
            />
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Attached docs are marked as admin-bypass (no OCR re-verification). Use for
        applicants who emailed their documents directly.
      </p>
    </div>
  )
}

interface DocumentRowProps {
  kind: "application" | "draft"
  id: string
  docKey: string
  currentUrl: string | null
  status?: string
  onUploaded?: (docKey: string, fileUrl: string) => void
}

function DocumentRow({ kind, id, docKey, currentUrl, status, onUploaded }: DocumentRowProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isUploaded = !!currentUrl

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append("kind", kind)
      form.append("id", id)
      form.append("docKey", docKey)
      form.append("file", file)
      const res = await fetch("/api/admin/attach-document", { method: "POST", body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.status) {
        const msg = json?.message || "Upload failed"
        setError(msg)
        toast.error(msg)
        return
      }
      toast.success(`${docLabel(docKey)} attached`)
      onUploaded?.(docKey, json.fileUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed"
      setError(msg)
      toast.error(msg)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      {/* Status indicator */}
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md shrink-0",
          isUploaded
            ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
            : "bg-muted text-muted-foreground"
        )}
      >
        {isUploaded ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      </span>

      {/* Label + status text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{docLabel(docKey)}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {isUploaded ? (
            <>
              {status === "extracted" ? "Verified" : "Uploaded"}
              {" · "}
              <a
                href={currentUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                View <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </>
          ) : (
            <span className="text-red-600 dark:text-red-400">Missing</span>
          )}
          {error && <span className="text-red-600 dark:text-red-400"> · {error}</span>}
        </p>
      </div>

      {/* Upload / Replace button */}
      <Button
        type="button"
        size="sm"
        variant={isUploaded ? "outline" : "default"}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="shrink-0"
      >
        {uploading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            Uploading
          </>
        ) : isUploaded ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Replace
          </>
        ) : (
          <>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Upload
          </>
        )}
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
    </div>
  )
}
