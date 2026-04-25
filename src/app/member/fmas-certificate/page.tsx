"use client"

import { useRef, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  Printer, Loader2, FileImage, FileText,
  Award, CheckCircle2, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { AdminBackLink } from "@/components/ui/admin-back-link"

const certificateCSS = `
@keyframes certFadeIn {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.cert-frame {
  animation: certFadeIn 0.6s ease-out;
  background: linear-gradient(145deg, #fafafa 0%, #f5f5f5 100%);
  box-shadow:
    0 1px 0 rgba(0,0,0,0.03),
    0 4px 8px rgba(0,0,0,0.04),
    0 16px 48px rgba(0,0,0,0.08),
    0 32px 80px rgba(0,0,0,0.06);
}
.cert-inner-shadow {
  box-shadow:
    inset 0 0 0 1px rgba(0,0,0,0.06),
    inset 0 2px 4px rgba(0,0,0,0.02);
}
.verified-glow {
  box-shadow: 0 0 0 3px rgba(34,197,94,0.15), 0 2px 8px rgba(34,197,94,0.1);
}
`

function FmasCertificateContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id")
  const certRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["fmas-certificate", id],
    queryFn: async () => {
      if (!id) return null
      const res = await fetch(`/api/credential?type=FMAS&id=${id}`)
      if (res.status === 404) return { credential: null }
      return res.json()
    },
    enabled: !!id,
    retry: false,
  })

  const cert = data?.credential

  const captureCanvas = async (scale = 2) => {
    if (!certRef.current) return null
    const html2canvas = (await import("html2canvas")).default
    return html2canvas(certRef.current, { scale, backgroundColor: "#fff", useCORS: true })
  }

  const handleDownloadPNG = async () => {
    setDownloading("png")
    try {
      const canvas = await captureCanvas(3)
      if (!canvas) return
      const link = document.createElement("a")
      link.download = `AMASI-FMAS-${cert.amasiNumber}-${cert.year}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
      toast.success("FMAS certificate downloaded as PNG")
    } catch {
      toast.error("Download failed")
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadPDF = async () => {
    setDownloading("pdf")
    try {
      const canvas = await captureCanvas(2)
      if (!canvas) return
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const imgData = canvas.toDataURL("image/png")
      const pageW = 210, pageH = 297, margin = 15
      const availW = pageW - margin * 2, availH = pageH - margin * 2
      const ratio = canvas.width / canvas.height
      let drawW = availW, drawH = drawW / ratio
      if (drawH > availH) { drawH = availH; drawW = drawH * ratio }
      pdf.addImage(imgData, "PNG", (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH)
      pdf.save(`AMASI-FMAS-${cert.amasiNumber}-${cert.year}.pdf`)
      toast.success("FMAS certificate downloaded as PDF (A4)")
    } catch {
      toast.error("PDF generation failed")
    } finally {
      setDownloading(null)
    }
  }

  const handlePrint = async () => {
    if (!certRef.current) return
    try {
      const canvas = await captureCanvas(2)
      if (!canvas) return
      const win = window.open("")
      if (!win) return
      win.document.write(`<html><head><title>FMAS Certificate - ${cert.amasiNumber}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          @media print { body { margin: 0; } }
          body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: white; }
          img { max-width: 100%; max-height: 100vh; }
        </style></head>
        <body><img src="${canvas.toDataURL("image/png")}" /></body></html>`)
      win.document.close()
      setTimeout(() => win.print(), 500)
    } catch {
      toast.error("Print failed")
    }
  }

  if (!id) return (
    <div className="text-center py-16 space-y-3">
      <Award className="h-12 w-12 mx-auto text-muted-foreground/30" />
      <p className="text-muted-foreground">No membership number provided.</p>
    </div>
  )

  if (isLoading) return (
    <div className="text-center py-16">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      <p className="text-muted-foreground mt-3">Loading your FMAS certificate...</p>
    </div>
  )

  if (isError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertCircle className="h-10 w-10 text-destructive mb-3" />
      <p className="text-lg font-medium">Failed to load certificate</p>
    </div>
  )

  if (!cert) return (
    <div className="text-center py-16 space-y-3">
      <Award className="h-12 w-12 mx-auto text-muted-foreground/30" />
      <p className="text-muted-foreground">No FMAS credential on record for this AMASI number.</p>
      <p className="text-xs text-muted-foreground/70">If you believe this is incorrect, please contact AMASI office.</p>
    </div>
  )

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <style dangerouslySetInnerHTML={{ __html: certificateCSS }} />

      <div className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
          <Award className="h-7 w-7 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">FMAS Certificate</h1>
          <p className="text-muted-foreground text-sm">Fellow of Minimal Access Surgery &mdash; Dr. {cert.name}</p>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="verified-glow inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-50 border border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800">Awarded {cert.year}</span>
        </div>
      </div>

      <div className="cert-frame rounded-2xl p-4 sm:p-6">
        <div className="cert-inner-shadow rounded-xl overflow-hidden bg-white">
          <div className="overflow-auto flex justify-center">
            <div
              ref={certRef}
              style={{ width: "707px", height: "1000px", position: "relative", background: "#fff" }}
            >
              <img
                src={cert.templateUrl}
                alt="FMAS certificate"
                crossOrigin="anonymous"
                style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
              />
              <div style={{
                position: "absolute",
                top: "46%",
                left: 0,
                right: 0,
                textAlign: "center",
                fontFamily: "'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive",
              }}>
                <p style={{
                  fontSize: "34px",
                  fontStyle: "italic",
                  color: "#1a1a1a",
                  margin: 0,
                }}>
                  Dr. {cert.name}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Button onClick={handleDownloadPNG} size="lg" className="gap-2" disabled={downloading === "png"}>
            {downloading === "png" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
            PNG
          </Button>
          <Button onClick={handleDownloadPDF} size="lg" variant="outline" className="gap-2" disabled={downloading === "pdf"}>
            {downloading === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            PDF (A4)
          </Button>
          <Button variant="outline" onClick={handlePrint} size="lg" className="gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {(cert.presidentName || cert.convocationPlace) && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-1 text-xs text-muted-foreground">
          {cert.year && <p>Year of convocation: <strong>{cert.year}</strong></p>}
          {cert.convocationPlace && <p>Convocation: <strong>{cert.convocationPlace}</strong></p>}
          {cert.presidentName && <p>President: <strong>{cert.presidentName}</strong></p>}
        </div>
      )}
    </div>
  )
}

export default function FmasCertificatePage() {
  return (
    <>
      <AdminBackLink />
      <Suspense fallback={
        <div className="p-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      }>
        <FmasCertificateContent />
      </Suspense>
    </>
  )
}
