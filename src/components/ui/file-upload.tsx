"use client"

import { useState, useRef } from "react"
import { Upload, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OCRVerification } from "@/lib/membership-types"

interface FileUploadProps {
  label: string
  accept?: string
  onFileSelect: (file: File) => void
  onRemove: () => void
  preview?: string
  ocrResult?: OCRVerification | null
  uploading?: boolean
  error?: string
  required?: boolean
}

export function FileUpload({
  label,
  accept = "image/*,.pdf",
  onFileSelect,
  onRemove,
  preview,
  ocrResult,
  uploading,
  error,
  required,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFileSelect(file)
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>

      {!preview ? (
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-input hover:border-primary/50",
            error && "border-destructive"
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Click or drag & drop to upload
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            JPG, PNG or PDF (max 5MB)
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFileSelect(file)
            }}
          />
        </div>
      ) : (
        <div className="border rounded-lg p-3">
          <div className="flex items-start gap-3">
            <img
              src={preview}
              alt={label}
              className="h-20 w-20 object-cover rounded border"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium truncate">{label}</p>
                <button
                  type="button"
                  onClick={onRemove}
                  className="p-1 hover:bg-accent rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {uploading && (
                <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying document...
                </div>
              )}

              {ocrResult && !uploading && (
                <div
                  className={cn(
                    "mt-2 p-2 rounded text-xs",
                    ocrResult.verified
                      ? ocrResult.confidence === "high"
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning"
                      : "bg-destructive/10 text-destructive"
                  )}
                >
                  <div className="flex items-center gap-1">
                    {ocrResult.verified ? (
                      <CheckCircle className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    <span className="font-medium">
                      {ocrResult.verified ? "Verified" : "Needs Review"}
                      {ocrResult.confidence !== "low" && ` (${ocrResult.confidence} confidence)`}
                    </span>
                  </div>
                  <p className="mt-1">{ocrResult.message}</p>
                  {ocrResult.matchedField && (
                    <p className="mt-0.5 font-medium">{ocrResult.matchedField}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {error && !preview && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
