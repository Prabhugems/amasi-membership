"use client"

import { useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Download, Printer, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

function CertificateContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id")
  const certRef = useRef<HTMLDivElement>(null)

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

  const handleDownload = async () => {
    if (!certRef.current) return
    try {
      const html2canvas = (await import("html2canvas")).default
      const canvas = await html2canvas(certRef.current, { scale: 2, backgroundColor: "#fff", useCORS: true })
      const link = document.createElement("a")
      link.download = `AMASI-Certificate-${cert.amasiNumber}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
      toast.success("Certificate downloaded!")
    } catch { toast.error("Download failed") }
  }

  const handlePrint = () => {
    if (!certRef.current) return
    const win = window.open("")
    if (win) {
      win.document.write(`<html><head><title>AMASI Certificate</title>
        <style>@media print{body{margin:0}}</style></head>
        <body>${certRef.current.outerHTML}</body></html>`)
      win.document.close()
      setTimeout(() => win.print(), 500)
    }
  }

  if (!id) return <p className="text-center text-muted-foreground py-16">No membership number provided.</p>
  if (isLoading) return (
    <div className="text-center py-16">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      <p className="text-muted-foreground mt-2">Generating certificate...</p>
    </div>
  )
  if (!cert) return <p className="text-center text-muted-foreground py-16">Member not found.</p>

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
      <div className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
          <Download className="h-7 w-7 text-amber-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Membership Certificate</h2>
          <p className="text-muted-foreground text-sm">AMASI #{cert.amasiNumber} -- Dr. {cert.name}</p>
        </div>
      </div>

      <div className="overflow-auto border rounded-xl shadow-2xl bg-white flex justify-center">
        <div
          ref={certRef}
          style={{
            width: "707px",
            height: "1000px",
            position: "relative",
            background: "#fff",
          }}
        >
          {/* Template background — has border, logo, body text, seal, signatures for the correct term */}
          <img
            src={cert.templateUrl || "/certificates/term-2024-2026.png"}
            alt=""
            crossOrigin="anonymous"
            style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
          />

          {/* Member Name — centered in the blank area between "hereby Admit" and signatures */}
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

          {/* Membership No — left, above signatures area */}
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

          {/* Date — right, above signatures area */}
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

      <div className="flex justify-center gap-4">
        <Button onClick={handleDownload} size="lg" className="gap-2 px-6">
          <Download className="h-5 w-5" /> Download PNG
        </Button>
        <Button variant="outline" onClick={handlePrint} size="lg" className="gap-2 px-6">
          <Printer className="h-5 w-5" /> Print
        </Button>
      </div>
    </div>
  )
}

export default function CertificatePage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
      <CertificateContent />
    </Suspense>
  )
}
