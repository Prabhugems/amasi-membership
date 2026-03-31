"use client"

import { FileUpload } from "@/components/ui/file-upload"
import { getMembershipType, DOC_LABELS } from "@/lib/membership-types"
import type { ApplicationFormData, DocType, DocumentUpload } from "@/lib/membership-types"

interface StepDocumentsProps {
  formData: ApplicationFormData
  onChange: (data: Partial<ApplicationFormData>) => void
  onFileUpload: (docType: string, file: File) => void
  onFileRemove: (docType: string) => void
  errors: Record<string, string>
}

export function StepDocuments({
  formData,
  onChange,
  onFileUpload,
  onFileRemove,
  errors,
}: StepDocumentsProps) {
  const type = getMembershipType(formData.membershipType)
  if (!type) return null

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Upload Documents</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Upload required documents. Each document will be automatically verified using OCR.
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4">
        <h4 className="text-sm font-medium mb-2">Required for {type.name}:</h4>
        <ul className="text-sm text-muted-foreground space-y-1">
          {type.requiredDocs.map((doc) => (
            <li key={doc} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {DOC_LABELS[doc]}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4">
        {type.requiredDocs
          .filter((doc) => doc !== "profile")
          .map((doc) => {
            const upload = formData.documents[doc]
            return (
              <FileUpload
                key={doc}
                label={DOC_LABELS[doc]}
                required
                preview={upload?.preview}
                ocrResult={upload?.ocrResult}
                uploading={upload?.uploading}
                error={errors[doc]}
                onFileSelect={(file) => onFileUpload(doc, file)}
                onRemove={() => onFileRemove(doc)}
              />
            )
          })}

        <div className="border-t pt-4">
          <FileUpload
            label="Profile Photo"
            required
            accept="image/*"
            preview={formData.documents.profile?.preview}
            ocrResult={null}
            uploading={false}
            error={errors.profile}
            onFileSelect={(file) => onFileUpload("profile", file)}
            onRemove={() => onFileRemove("profile")}
          />
        </div>
      </div>
    </div>
  )
}
