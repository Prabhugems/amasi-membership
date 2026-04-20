"use client"

import { useRef, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  Download, Printer, Loader2, FileImage, FileText,
  Share2, ShieldCheck, Copy, Mail, Award, CheckCircle2, ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { AdminBackLink } from "@/components/ui/admin-back-link"

/* ------------------------------------------------------------------ */
/*  Certificate frame CSS                                             */
/* ------------------------------------------------------------------ */
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

function CertificateContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id")
  const certRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["certificate", id],
    queryFn: async () => {
      if (!id) return null
      const res = await fetch(`/api/certificate?id=${id}`)
      return res.json()
    },
    enabled: !!id,
  })

  const cert = data?.certificate

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
      link.download = `AMASI-Certificate-${cert.amasiNumber}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
      toast.success("Certificate downloaded as PNG!")
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
      // A4 portrait
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const imgData = canvas.toDataURL("image/png")

      // Fit certificate into A4 with margins
      const pageW = 210
      const pageH = 297
      const margin = 15
      const availW = pageW - margin * 2
      const availH = pageH - margin * 2

      const imgRatio = canvas.width / canvas.height
      let drawW = availW
      let drawH = drawW / imgRatio
      if (drawH > availH) {
        drawH = availH
        drawW = drawH * imgRatio
      }

      const x = (pageW - drawW) / 2
      const y = (pageH - drawH) / 2

      pdf.addImage(imgData, "PNG", x, y, drawW, drawH)
      pdf.save(`AMASI-Certificate-${cert.amasiNumber}.pdf`)
      toast.success("Certificate downloaded as PDF (A4)!")
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
      win.document.write(`<html><head><title>AMASI Certificate - ${cert.amasiNumber}</title>
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

  const verifyUrl = cert ? `${typeof window !== "undefined" ? window.location.origin : ""}/verify?id=${cert.amasiNumber}` : ""

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(verifyUrl)
    toast.success("Verification link copied!")
  }

  const handleShareLink = async () => {
    if (navigator.share) {
      await navigator.share({
        title: `AMASI Membership Certificate - Dr. ${cert.name}`,
        text: `Verify AMASI membership for Dr. ${cert.name} (#${cert.amasiNumber})`,
        url: verifyUrl,
      })
    } else {
      handleCopyLink()
    }
  }

  const handleEmailSelf = () => {
    const subject = encodeURIComponent(`AMASI Membership Certificate - ${cert.amasiNumber}`)
    const body = encodeURIComponent(
      `Dear Dr. ${cert.name},\n\nYour AMASI Membership Certificate is available for download at:\n${typeof window !== "undefined" ? window.location.href : ""}\n\nVerify your membership:\n${verifyUrl}\n\nRegards,\nAMASI`
    )
    window.open(`mailto:${cert.email || ""}?subject=${subject}&body=${body}`)
  }

  if (!id) return (
    <div className="text-center py-16 space-y-3">
      <Award className="h-12 w-12 mx-auto text-muted-foreground/30" />
      <p className="text-muted-foreground">No membership number provided.</p>
      <p className="text-sm text-muted-foreground/70">Access this page from your membership card or profile.</p>
    </div>
  )

  if (isLoading) return (
    <div className="text-center py-16">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      <p className="text-muted-foreground mt-3">Generating your certificate...</p>
    </div>
  )

  if (!cert) return (
    <div className="text-center py-16 space-y-3">
      <Award className="h-12 w-12 mx-auto text-muted-foreground/30" />
      <p className="text-muted-foreground">Member not found.</p>
    </div>
  )

  const typeMap: Record<string, string> = {
    "Life Member": "Life Member [LM]",
    "Associate Life Member": "Associate Life Member [ALM]",
    "Associate Candidate Member": "Associate Candidate Member [ACM]",
    "International Life Member": "International Life Member [ILM]",
  }
  const typeLabel = typeMap[cert.membershipType] || cert.membershipType
  const dateStr = cert.joiningDate
    ? new Date(cert.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-")
    : new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-")

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <style dangerouslySetInnerHTML={{ __html: certificateCSS }} />

      {/* Header */}
      <div className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
          <Award className="h-7 w-7 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Membership Certificate</h1>
          <p className="text-muted-foreground text-sm">AMASI #{cert.amasiNumber} &mdash; Dr. {cert.name}</p>
        </div>
      </div>

      {/* Verification Badge */}
      <div className="flex justify-center">
        <div className="verified-glow inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-50 border border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800">This certificate is verified</span>
          <a
            href={verifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-green-600 hover:text-green-700 underline underline-offset-2 flex items-center gap-0.5"
          >
            Verify <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Certificate preview in frame */}
      <div className="cert-frame rounded-2xl p-4 sm:p-6">
        <div className="cert-inner-shadow rounded-xl overflow-hidden bg-white">
          <div className="overflow-auto flex justify-center">
            <div
              ref={certRef}
              style={{
                width: "707px",
                height: "1000px",
                position: "relative",
                background: "#fff",
              }}
            >
              {/* Template background */}
              <img
                src={cert.templateUrl || "/certificates/term-2024-2026.png"}
                alt="AMASI membership certificate"
                crossOrigin="anonymous"
                style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
              />

              {/* Member Name */}
              <div style={{
                position: "absolute",
                top: "54%",
                left: 0,
                right: 0,
                textAlign: "center",
                fontFamily: "Georgia, 'Times New Roman', serif",
              }}>
                <p style={{
                  fontSize: "30px",
                  fontWeight: "bold",
                  color: "#111",
                  margin: "0 0 14px",
                }}>
                  Dr. {cert.name}
                </p>
                <p style={{ fontSize: "15px", margin: "0", color: "#333" }}>
                  As {/^[aeiou]/i.test(typeLabel) ? "an" : "a"} {typeLabel}
                </p>
                <p style={{ fontSize: "13px", margin: "5px 0", color: "#444" }}>
                  Association of Minimal Access Surgeons of India
                </p>
              </div>

              {/* Membership No */}
              <div style={{
                position: "absolute",
                top: "72%",
                left: "9%",
                fontFamily: "Georgia, serif",
                fontSize: "11px",
                color: "#222",
              }}>
                Membership No: {cert.amasiNumber}
              </div>

              {/* Date */}
              <div style={{
                position: "absolute",
                top: "72%",
                right: "14%",
                fontFamily: "Georgia, serif",
                fontSize: "11px",
                color: "#222",
              }}>
                Date: {dateStr}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Download buttons */}
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

        {/* Share options */}
        <div className="grid grid-cols-3 gap-3">
          <Button variant="ghost" size="sm" onClick={handleShareLink} className="gap-1.5 text-xs">
            <Share2 className="h-3.5 w-3.5" /> Share
          </Button>
          <Button variant="ghost" size="sm" onClick={handleEmailSelf} className="gap-1.5 text-xs">
            <Mail className="h-3.5 w-3.5" /> Email
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopyLink} className="gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" /> Copy Link
          </Button>
        </div>
      </div>

      {/* Verification info footer */}
      <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Certificate Verification</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          This certificate can be verified online at any time. Share the verification link below
          with anyone who needs to confirm your AMASI membership status.
        </p>
        <div className="flex items-center gap-2 mt-1">
          <code className="flex-1 text-xs bg-background rounded-md px-3 py-2 border truncate">
            {verifyUrl}
          </code>
          <Button variant="outline" size="sm" onClick={handleCopyLink} className="flex-shrink-0">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function CertificatePage() {
  return (
    <>
      <AdminBackLink />
      <Suspense fallback={
        <div className="p-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      }>
        <CertificateContent />
      </Suspense>
    </>
  )
}
