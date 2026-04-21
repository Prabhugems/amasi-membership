"use client"

import { useState, useRef, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  Search, Download, Share2, CreditCard, UserPen, Award, ShieldCheck,
  Printer, FileImage, FileText, MessageCircle, Wallet, RotateCcw,
  Loader2, Phone, Mail, Globe, MapPin, AlertCircle,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { AdminBackLink } from "@/components/ui/admin-back-link"

/* ------------------------------------------------------------------ */
/*  Auto-suggest search with debounced API calls                      */
/* ------------------------------------------------------------------ */
function useSearchSuggestions(query: string) {
  return useQuery({
    queryKey: ["member-suggestions", query],
    queryFn: async () => {
      if (!query || query.length < 2) return []
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      if (!data.status || !data.data) return []
      return data.data.slice(0, 6).map((m: Record<string, string>) => ({
        id: m.membership_no || m.amasi_number,
        name: m.name || m.full_name,
        email: m.email,
        type: m.membership_type,
      }))
    },
    enabled: query.length >= 2,
    staleTime: 30_000,
  })
}

/* ------------------------------------------------------------------ */
/*  Shimmer animation CSS (injected once)                             */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Card data interface                                               */
/* ------------------------------------------------------------------ */
interface CardData {
  amasiNumber: string
  name: string
  salutation?: string
  profilePhoto?: string
  pgDegree?: string
  mciNumber?: string
  state?: string
  zone?: string
  joiningDate: string
  votingEligible?: boolean
  qrCode: string
  verifyUrl: string
  membershipType: string
  email?: string
  phone?: string
}

interface ThemeData {
  bg: string
  accent: string
  badge: string
  label: string
}

const shimmerCSS = `
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes float {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(-4px) rotate(0.5deg); }
}
.card-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    transparent 30%,
    rgba(255,255,255,0.08) 38%,
    rgba(255,255,255,0.18) 42%,
    rgba(255,255,255,0.08) 46%,
    transparent 54%
  );
  background-size: 200% 100%;
  animation: shimmer 4s ease-in-out infinite;
  pointer-events: none;
  border-radius: inherit;
  z-index: 2;
}
.card-gold-border {
  box-shadow:
    0 0 0 2px rgba(212,175,55,0.6),
    0 0 0 4px rgba(212,175,55,0.2),
    0 20px 60px -12px rgba(0,0,0,0.4);
}
.card-standard-shadow {
  box-shadow:
    0 20px 60px -12px rgba(0,0,0,0.35),
    0 8px 20px -6px rgba(0,0,0,0.15);
}
.card-float {
  animation: float 6s ease-in-out infinite;
}
`

/* ------------------------------------------------------------------ */
/*  Card Front                                                        */
/* ------------------------------------------------------------------ */
function CardFront({ card, theme }: { card: CardData; theme: ThemeData }) {
  const isLife = theme.label.includes("LIFE MEMBER") && !theme.label.includes("ASSOCIATE")
  return (
    <div
      className={`card-shimmer relative overflow-hidden rounded-2xl ${isLife ? "card-gold-border" : "card-standard-shadow"}`}
      style={{
        background: theme.bg,
        aspectRatio: "1.586/1",
      }}
    >
      {/* Watermark logo */}
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.06] pointer-events-none" style={{ zIndex: 1 }}>
        <img src="/amasi-logo.png" alt="" className="w-52 h-52 object-contain" />
      </div>

      {/* Dot pattern */}
      <div className="absolute inset-0 opacity-[0.05]">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="dots-front" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="1" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots-front)" />
        </svg>
      </div>

      {/* Diagonal accent */}
      <div className="absolute top-0 right-0 w-48 h-48 opacity-10" style={{
        background: `linear-gradient(135deg, transparent 30%, ${theme.accent} 100%)`,
      }} />
      <div className="absolute bottom-0 left-0 w-40 h-40 opacity-[0.06]" style={{
        background: `radial-gradient(circle, ${theme.accent} 0%, transparent 70%)`,
      }} />

      {/* Gold corner accents for life members */}
      {isLife && (
        <>
          <div className="absolute top-3 left-3 w-8 h-8 border-t-2 border-l-2 border-amber-400/40 rounded-tl-lg" />
          <div className="absolute top-3 right-3 w-8 h-8 border-t-2 border-r-2 border-amber-400/40 rounded-tr-lg" />
          <div className="absolute bottom-3 left-3 w-8 h-8 border-b-2 border-l-2 border-amber-400/40 rounded-bl-lg" />
          <div className="absolute bottom-3 right-3 w-8 h-8 border-b-2 border-r-2 border-amber-400/40 rounded-br-lg" />
        </>
      )}

      <div className="relative p-5 sm:p-6 h-full flex flex-col justify-between text-white" style={{ zIndex: 3 }}>
        {/* Top: Logo + type badge */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/amasi-logo.png" alt="AMASI" className="h-10 w-10 rounded-lg object-contain" />
            <div>
              <p className="font-bold text-lg tracking-[0.2em]">AMASI</p>
              <p className="text-[9px] text-white/50 -mt-0.5 tracking-wide">Association of Minimal Access Surgeons of India</p>
            </div>
          </div>
          <div className={`px-3 py-1 rounded-full text-[9px] font-bold tracking-wider backdrop-blur-sm ${theme.badge}`}>
            {theme.label}
          </div>
        </div>

        {/* Middle: Photo + Details */}
        <div className="flex items-center gap-4">
          {(card.profilePhoto) ? (
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-white/10 blur-sm" />
              <img
                src={card.profilePhoto}
                alt="Member profile photo"
                className="relative h-[72px] w-[72px] rounded-full object-cover border-2 border-white/30 shadow-lg"
              />
            </div>
          ) : (
            <div className="h-[72px] w-[72px] rounded-full bg-white/15 flex items-center justify-center border-2 border-white/30 backdrop-blur-sm shadow-lg overflow-hidden">
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-white/40" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[28px] font-bold tracking-[0.15em] font-mono leading-none" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
              {String(card.amasiNumber).padStart(5, "0")}
            </p>
            <p className="text-[15px] font-semibold mt-1.5 truncate">{card.salutation} {card.name as string}</p>
            {card.pgDegree && <p className="text-[11px] text-white/50 mt-0.5 truncate">{card.pgDegree}</p>}
          </div>
        </div>

        {/* Bottom: Details + QR + Voting */}
        <div className="flex items-end justify-between">
          <div className="space-y-0.5">
            {card.mciNumber && <p className="text-[10px] text-white/50">MCI: {card.mciNumber}</p>}
            {card.state && <p className="text-[10px] text-white/50">{card.state}{card.zone ? ` \u2022 ${card.zone}` : ""}</p>}
            <p className="text-[10px] text-white/50">Member since {new Date(card.joiningDate).getFullYear()}</p>
            {card.votingEligible ? (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[11px] font-semibold" style={{ color: theme.accent }}>Voting Rights Active</p>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="h-1.5 w-1.5 rounded-full bg-white/25" />
                <p className="text-[10px] text-white/35">No Voting Rights</p>
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl p-2 shadow-xl ring-1 ring-white/20">
            <img src={card.qrCode} alt="Membership verification QR code" className="h-[64px] w-[64px] rounded-sm" crossOrigin="anonymous" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Card Back                                                         */
/* ------------------------------------------------------------------ */
function CardBack({ card, theme }: { card: CardData; theme: ThemeData }) {
  const isLife = theme.label.includes("LIFE MEMBER") && !theme.label.includes("ASSOCIATE")
  return (
    <div
      className={`card-shimmer relative overflow-hidden rounded-2xl ${isLife ? "card-gold-border" : "card-standard-shadow"}`}
      style={{
        background: theme.bg,
        aspectRatio: "1.586/1",
      }}
    >
      {/* Watermark */}
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.06] pointer-events-none" style={{ zIndex: 1 }}>
        <img src="/amasi-logo.png" alt="" className="w-52 h-52 object-contain" />
      </div>

      {/* Dot pattern */}
      <div className="absolute inset-0 opacity-[0.05]">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="dots-back" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="1" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots-back)" />
        </svg>
      </div>

      {isLife && (
        <>
          <div className="absolute top-3 left-3 w-8 h-8 border-t-2 border-l-2 border-amber-400/40 rounded-tl-lg" />
          <div className="absolute top-3 right-3 w-8 h-8 border-t-2 border-r-2 border-amber-400/40 rounded-tr-lg" />
          <div className="absolute bottom-3 left-3 w-8 h-8 border-b-2 border-l-2 border-amber-400/40 rounded-bl-lg" />
          <div className="absolute bottom-3 right-3 w-8 h-8 border-b-2 border-r-2 border-amber-400/40 rounded-br-lg" />
        </>
      )}

      <div className="relative p-5 sm:p-6 h-full flex flex-col justify-between text-white" style={{ zIndex: 3 }}>
        {/* Top: Magnetic strip style */}
        <div>
          <div className="h-9 -mx-6 bg-black/30 mb-4" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.15em] text-white/70">MEMBERSHIP CARD</p>
              <p className="text-[10px] text-white/40 mt-0.5">Valid for identification purposes</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold tracking-wider text-white/70">#{String(card.amasiNumber).padStart(5, "0")}</p>
            </div>
          </div>
        </div>

        {/* Middle: QR code + verification details */}
        <div className="flex items-center gap-5">
          <div className="bg-white rounded-xl p-3 shadow-xl ring-1 ring-white/20 flex-shrink-0">
            <img src={card.qrCode} alt="Membership verification QR code" className="h-[80px] w-[80px] rounded-sm" crossOrigin="anonymous" />
          </div>
          <div className="space-y-2.5 min-w-0 flex-1">
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">Verify Online</p>
              <p className="text-[11px] text-white/70 truncate">{card.verifyUrl}</p>
            </div>
            {card.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="h-3 w-3 text-white/40 flex-shrink-0" />
                <p className="text-[10px] text-white/50 truncate">{card.email}</p>
              </div>
            )}
            {card.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3 w-3 text-white/40 flex-shrink-0" />
                <p className="text-[10px] text-white/50">{card.phone}</p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom: AMASI address */}
        <div className="space-y-2">
          <div className="h-px bg-white/10" />
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-white/40 flex-shrink-0" />
                <p className="text-[9px] text-white/40 leading-relaxed">
                  45, Pankaja Mills Rd, Sowripalayam Pirivu, Coimbatore, Tamil Nadu 641045
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Phone className="h-2.5 w-2.5 text-white/40 flex-shrink-0" />
                  <span className="text-[9px] text-white/40">+91 7358105244</span>
                </span>
                <span className="flex items-center gap-1">
                  <Mail className="h-2.5 w-2.5 text-white/40 flex-shrink-0" />
                  <span className="text-[9px] text-white/40">amasi.india@gmail.com</span>
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[8px] text-white/30">This card is the property of AMASI.</p>
              <p className="text-[8px] text-white/30">If found, please return to the above address.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                      */
/* ------------------------------------------------------------------ */
function CardContent() {
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") || ""
  const [query, setQuery] = useState(initialId)
  const [searchId, setSearchId] = useState(initialId)
  const [showBack, setShowBack] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [walletLoading, setWalletLoading] = useState<string | null>(null)
  const cardFrontRef = useRef<HTMLDivElement>(null)
  const cardBackRef = useRef<HTMLDivElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  const { data: suggestions } = useSearchSuggestions(query)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["card", searchId],
    queryFn: async () => {
      if (!searchId) return null
      const searchRes = await fetch(`/api/members/search?q=${encodeURIComponent(searchId)}`)
      const searchData = await searchRes.json()
      if (!searchData.status || !searchData.data?.[0]) return { status: false }
      const member = searchData.data[0]
      const amasiNum = member.membership_no || member.amasi_number
      if (!amasiNum) return { status: false }
      const cardRes = await fetch(`/api/card?id=${amasiNum}`)
      return cardRes.json()
    },
    enabled: !!searchId,
  })

  const card = data?.card

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setShowSuggestions(false)
    setSearchId(query.trim())
  }

  const handleSelectSuggestion = (s: { id: string; name: string }) => {
    setQuery(s.id || s.name)
    setSearchId(s.id || s.name)
    setShowSuggestions(false)
  }

  const captureCard = useCallback(async (ref: React.RefObject<HTMLDivElement | null>, scale = 3) => {
    if (!ref.current) return null
    const html2canvas = (await import("html2canvas")).default
    return html2canvas(ref.current, { scale, backgroundColor: null, useCORS: true })
  }, [])

  const handleDownloadPNG = async () => {
    setDownloading("png")
    try {
      const canvas = await captureCard(showBack ? cardBackRef : cardFrontRef)
      if (!canvas) return
      const link = document.createElement("a")
      link.download = `AMASI-Card-${card.amasiNumber}-${showBack ? "back" : "front"}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
      toast.success("Card downloaded as PNG!")
    } catch {
      toast.error("Download failed. Try screenshot instead.")
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadPDF = async () => {
    setDownloading("pdf")
    try {
      const frontCanvas = await captureCard(cardFrontRef, 2)
      const backCanvas = await captureCard(cardBackRef, 2)
      if (!frontCanvas) return

      const { jsPDF } = await import("jspdf")
      // Credit card aspect ratio 85.6mm x 53.98mm
      const w = 85.6
      const h = 53.98
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [w, h] })

      const frontImg = frontCanvas.toDataURL("image/png")
      pdf.addImage(frontImg, "PNG", 0, 0, w, h)

      if (backCanvas) {
        pdf.addPage([w, h], "landscape")
        const backImg = backCanvas.toDataURL("image/png")
        pdf.addImage(backImg, "PNG", 0, 0, w, h)
      }

      pdf.save(`AMASI-Card-${card.amasiNumber}.pdf`)
      toast.success("Card downloaded as PDF!")
    } catch {
      toast.error("PDF generation failed.")
    } finally {
      setDownloading(null)
    }
  }

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({
        title: `AMASI Membership Card - ${card.name}`,
        text: `AMASI Membership #${card.amasiNumber}`,
        url: card.verifyUrl,
      })
    } else {
      await navigator.clipboard.writeText(card.verifyUrl)
      toast.success("Verification link copied!")
    }
  }

  const handleWhatsApp = () => {
    const text = encodeURIComponent(
      `Check out my AMASI Membership Card!\n\nMember: ${card.salutation} ${card.name}\nAMASI #${card.amasiNumber}\n\nVerify: ${card.verifyUrl}`
    )
    window.open(`https://wa.me/?text=${text}`, "_blank")
  }

  const handlePrint = async () => {
    try {
      const frontCanvas = await captureCard(cardFrontRef, 2)
      const backCanvas = await captureCard(cardBackRef, 2)
      if (!frontCanvas) return

      const win = window.open("")
      if (!win) return
      win.document.write(`<html><head><title>AMASI Card - ${card.amasiNumber}</title>
        <style>
          @media print { body { margin: 0; } img { page-break-after: always; } }
          body { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px; background: #f5f5f5; }
          img { max-width: 400px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        </style></head><body>
        <img src="${frontCanvas.toDataURL("image/png")}" />
        ${backCanvas ? `<img src="${backCanvas.toDataURL("image/png")}" />` : ""}
        </body></html>`)
      win.document.close()
      setTimeout(() => win.print(), 500)
    } catch {
      toast.error("Print failed.")
    }
  }

  const handleAddToWallet = async (type: "apple" | "google") => {
    if (!card) return
    setWalletLoading(type)
    try {
      const res = await fetch(`/api/card/wallet?id=${card.amasiNumber}&type=${type}`)
      const data = await res.json()
      if (res.status === 501) {
        toast.info("Coming soon \u2014 wallet passes are being set up")
        return
      }
      if (!res.ok) {
        toast.error(data.error || "Failed to generate wallet pass")
        return
      }
      if (type === "google" && data.url) {
        window.open(data.url, "_blank")
        toast.success("Opening Google Wallet...")
      } else if (type === "apple" && data.passUrl) {
        window.open(data.passUrl, "_blank")
        toast.success("Downloading Apple Wallet pass...")
      }
    } catch {
      toast.error("Failed to generate wallet pass. Please try again.")
    } finally {
      setWalletLoading(null)
    }
  }

  const isDirect = searchParams.get("direct") === "1"

  // Theme mapping
  const getTheme = (card: CardData): ThemeData => {
    const mt = (card.membershipType || "").toLowerCase()
    if (mt.includes("lm") && !mt.includes("alm") && !mt.includes("ilm"))
      return { bg: "linear-gradient(135deg, #0f766e 0%, #065f46 50%, #064e3b 100%)", accent: "#34d399", badge: "bg-emerald-400/20 text-emerald-200", label: "LIFE MEMBER" }
    if (mt.includes("alm") || mt.includes("associate life"))
      return { bg: "linear-gradient(135deg, #1e40af 0%, #1e3a8a 50%, #172554 100%)", accent: "#60a5fa", badge: "bg-blue-400/20 text-blue-200", label: "ASSOCIATE LIFE MEMBER" }
    if (mt.includes("acm") || mt.includes("candidate"))
      return { bg: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4c1d95 100%)", accent: "#a78bfa", badge: "bg-purple-400/20 text-purple-200", label: "ASSOCIATE CANDIDATE" }
    return { bg: "linear-gradient(135deg, #b45309 0%, #92400e 50%, #78350f 100%)", accent: "#fbbf24", badge: "bg-amber-400/20 text-amber-200", label: "INTERNATIONAL MEMBER" }
  }

  return (
    <div className="space-y-8">
      <style dangerouslySetInnerHTML={{ __html: shimmerCSS }} />

      {!isDirect && (
        <>
          <div className="text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <CreditCard className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Digital Membership Card</h1>
              <p className="text-muted-foreground text-sm">Enter your email, phone, or membership number</p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="relative max-w-md mx-auto">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Email, phone, or AMASI number..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setShowSuggestions(true)
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="pl-9"
                />

                {/* Auto-suggestions dropdown */}
                {showSuggestions && suggestions && suggestions.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-xl overflow-hidden"
                  >
                    {(suggestions as Array<{ id: string; name: string; email: string; type: string }>).map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        className="w-full px-3 py-2.5 text-left hover:bg-accent transition-colors flex items-center gap-3"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          handleSelectSuggestion(s)
                        }}
                      >
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                          {s.name?.charAt(0) || "?"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{s.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {s.id ? `#${s.id}` : ""}{s.email ? ` \u2022 ${s.email}` : ""}{s.type ? ` \u2022 ${s.type}` : ""}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button type="submit" disabled={isLoading || !query}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "View Card"}
              </Button>
            </div>
          </form>
        </>
      )}

      {isLoading && (
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground mt-2 text-sm">Loading membership card...</p>
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-3" />
          <p className="text-lg font-medium">Failed to load card</p>
          <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page</p>
        </div>
      )}

      {data && !data.status && !isLoading && (
        <p className="text-center text-muted-foreground">No member found for &ldquo;{searchId}&rdquo;</p>
      )}

      {card && (() => {
        const theme = getTheme(card)

        return (
          <div className="max-w-md mx-auto space-y-6">
            {/* Card flip toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {showBack ? "Back" : "Front"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {card.salutation} {card.name} &bull; #{String(card.amasiNumber).padStart(5, "0")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBack(!showBack)}
                className="group gap-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 group-hover:rotate-180 transition-transform duration-300" />
                Flip Card
              </Button>
            </div>

            {/* Card display with perspective */}
            <div className="card-float">
              {/* Front - always rendered for PDF capture, hidden when showing back */}
              <div ref={cardFrontRef} className={showBack ? "absolute -left-[9999px] top-0" : ""}>
                <CardFront card={card} theme={theme} />
              </div>
              <div ref={cardBackRef} className={showBack ? "" : "absolute -left-[9999px] top-0"}>
                <CardBack card={card} theme={theme} />
              </div>
            </div>

            {/* Primary actions */}
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={handleDownloadPNG} className="gap-2" disabled={downloading === "png"}>
                {downloading === "png" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />} Download PNG
              </Button>
              <Button onClick={handleDownloadPDF} variant="outline" className="gap-2" disabled={downloading === "pdf"}>
                {downloading === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Download PDF
              </Button>
            </div>

            {/* Secondary actions */}
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={handleShare} className="gap-1.5 text-xs">
                <Share2 className="h-3.5 w-3.5" /> Share Link
              </Button>
              <Button variant="outline" size="sm" onClick={handleWhatsApp} className="gap-1.5 text-xs">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 text-xs">
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
            </div>

            {/* Wallet passes */}
            <div className="flex gap-3">
              <button
                onClick={() => handleAddToWallet("apple")}
                disabled={walletLoading === "apple"}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-muted-foreground/20 hover:border-primary/30 hover:bg-accent/50 text-muted-foreground hover:text-foreground text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {walletLoading === "apple" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                Apple Wallet
              </button>
              <button
                onClick={() => handleAddToWallet("google")}
                disabled={walletLoading === "google"}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-muted-foreground/20 hover:border-primary/30 hover:bg-accent/50 text-muted-foreground hover:text-foreground text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {walletLoading === "google" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                Google Wallet
              </button>
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-3 gap-3">
              <a href={`/profile?q=${encodeURIComponent(card.email)}`} className="flex flex-col items-center gap-2 p-4 rounded-xl border hover:border-primary/30 hover:bg-accent/50 transition-all text-center group">
                <div className="p-2 rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 transition-colors">
                  <UserPen className="h-4 w-4" />
                </div>
                <span className="text-xs font-medium">Edit Profile</span>
              </a>
              <a href={`/member/certificate?id=${card.amasiNumber}`} className="flex flex-col items-center gap-2 p-4 rounded-xl border hover:border-primary/30 hover:bg-accent/50 transition-all text-center group">
                <div className="p-2 rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-100 transition-colors">
                  <Award className="h-4 w-4" />
                </div>
                <span className="text-xs font-medium">Certificate</span>
              </a>
              <a href={card.verifyUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 p-4 rounded-xl border hover:border-primary/30 hover:bg-accent/50 transition-all text-center group">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <span className="text-xs font-medium">Verify</span>
              </a>
            </div>

            {!card.profilePhoto && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <p className="text-sm font-medium text-amber-800">Photo missing on your card</p>
                <p className="text-xs text-amber-600 mt-1">Upload your photo via the Member Portal to complete your card</p>
                <a href="/member" className="inline-block mt-2 text-xs font-semibold text-primary hover:underline">Go to Member Portal →</a>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Scan the QR code on the card to verify membership online
            </p>
          </div>
        )
      })()}
    </div>
  )
}

export default function CardPage() {
  return (
    <>
      <AdminBackLink />
      <Suspense fallback={<div className="p-6 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></div>}>
        <CardContent />
      </Suspense>
    </>
  )
}
