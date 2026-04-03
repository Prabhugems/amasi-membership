"use client"

import { useState, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Search, Download, Share2, CreditCard, UserPen, Award, ShieldCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

function CardContent() {
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") || ""
  const [query, setQuery] = useState(initialId)
  const [searchId, setSearchId] = useState(initialId)
  const cardRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["card", searchId],
    queryFn: async () => {
      if (!searchId) return null
      // First search member by email/phone/name, then get card by AMASI number
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
    setSearchId(query.trim())
  }

  const handleDownload = async () => {
    if (!cardRef.current) return
    try {
      const html2canvas = (await import("html2canvas")).default
      const canvas = await html2canvas(cardRef.current, {
        scale: 3,
        backgroundColor: null,
        useCORS: true,
      })
      const link = document.createElement("a")
      link.download = `AMASI-Card-${card.amasiNumber}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
      toast.success("Card downloaded!")
    } catch {
      toast.error("Download failed. Try screenshot instead.")
    }
  }

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({
        title: `AMASI Membership Card — ${card.name}`,
        text: `AMASI Membership #${card.amasiNumber}`,
        url: card.verifyUrl,
      })
    } else {
      await navigator.clipboard.writeText(card.verifyUrl)
      toast.success("Verification link copied!")
    }
  }

  const isDirect = searchParams.get("direct") === "1"

  return (
    <div className="space-y-8">
      {!isDirect && (
        <>
          <div className="text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <CreditCard className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Digital Membership Card</h2>
              <p className="text-muted-foreground text-sm">Enter your email, phone, or membership number</p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex gap-3 max-w-md mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Email, phone, or AMASI number..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
          />
        </div>
        <Button type="submit" disabled={isLoading || !query}>
          {isLoading ? "Loading..." : "View Card"}
        </Button>
      </form>
        </>
      )}

      {data && !data.status && (
        <p className="text-center text-muted-foreground">No member found for #{searchId}</p>
      )}

      {card && (() => {
        // Color themes per membership type
        const mt = (card.membershipType || "").toLowerCase()
        const theme = mt.includes("lm") && !mt.includes("alm") && !mt.includes("ilm")
          ? { bg: "linear-gradient(135deg, #0f766e 0%, #065f46 50%, #064e3b 100%)", accent: "#34d399", badge: "bg-emerald-400/20 text-emerald-200", label: "LIFE MEMBER" }
          : mt.includes("alm") || mt.includes("associate life")
            ? { bg: "linear-gradient(135deg, #1e40af 0%, #1e3a8a 50%, #172554 100%)", accent: "#60a5fa", badge: "bg-blue-400/20 text-blue-200", label: "ASSOCIATE LIFE MEMBER" }
            : mt.includes("acm") || mt.includes("candidate")
              ? { bg: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4c1d95 100%)", accent: "#a78bfa", badge: "bg-purple-400/20 text-purple-200", label: "ASSOCIATE CANDIDATE" }
              : { bg: "linear-gradient(135deg, #b45309 0%, #92400e 50%, #78350f 100%)", accent: "#fbbf24", badge: "bg-amber-400/20 text-amber-200", label: "INTERNATIONAL MEMBER" }

        return (
        <div className="max-w-md mx-auto space-y-4">
          {/* The Card */}
          <div ref={cardRef}>
            <div className="relative overflow-hidden rounded-2xl shadow-2xl" style={{
              background: theme.bg,
              aspectRatio: "1.586/1",
            }}>
              {/* Background pattern */}
              <div className="absolute inset-0 opacity-[0.07]">
                <svg width="100%" height="100%">
                  <defs>
                    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
                      <circle cx="12" cy="12" r="1.5" fill="white" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#dots)" />
                </svg>
              </div>

              {/* Diagonal stripe accent */}
              <div className="absolute top-0 right-0 w-40 h-40 opacity-10" style={{
                background: `linear-gradient(135deg, transparent 30%, ${theme.accent} 100%)`,
              }} />
              <div className="absolute bottom-0 left-0 w-32 h-32 opacity-[0.06]" style={{
                background: `radial-gradient(circle, ${theme.accent} 0%, transparent 70%)`,
              }} />

              <div className="relative p-6 h-full flex flex-col justify-between text-white">
                {/* Top: Logo + type badge */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center border border-white/20">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-bold text-lg tracking-wider">AMASI</p>
                      <p className="text-[10px] text-white/60 -mt-0.5">Minimal Access Surgeons of India</p>
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider ${theme.badge}`}>
                    {theme.label}
                  </div>
                </div>

                {/* Middle: Photo + Number */}
                <div className="flex items-center gap-4">
                  {card.profilePhoto ? (
                    <img src={card.profilePhoto} alt="" className="h-[68px] w-[68px] rounded-full object-cover border-2 border-white/30 shadow-lg" />
                  ) : (
                    <div className="h-[68px] w-[68px] rounded-full bg-white/15 flex items-center justify-center text-2xl font-bold border-2 border-white/20">
                      {card.name?.charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="text-[26px] font-bold tracking-widest font-mono leading-none">{String(card.amasiNumber).padStart(5, "0")}</p>
                    <p className="text-[15px] font-semibold mt-1.5">{card.salutation} {card.name}</p>
                    {card.pgDegree && <p className="text-[11px] text-white/60 mt-0.5">{card.pgDegree}</p>}
                  </div>
                </div>

                {/* Bottom: Details + QR + Voting */}
                <div className="flex items-end justify-between">
                  <div className="space-y-0.5">
                    {card.mciNumber && <p className="text-[10px] text-white/60">MCI: {card.mciNumber}</p>}
                    {card.state && <p className="text-[10px] text-white/60">{card.state}{card.zone ? ` • ${card.zone}` : ""}</p>}
                    <p className="text-[10px] text-white/60">Member since {new Date(card.joiningDate).getFullYear()}</p>
                    {card.votingEligible ? (
                      <div className="flex items-center gap-1 mt-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <p className="text-[11px] font-semibold" style={{ color: theme.accent }}>Voting Rights Active</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 mt-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-white/30" />
                        <p className="text-[10px] text-white/40">No Voting Rights</p>
                      </div>
                    )}
                  </div>
                  <div className="bg-white rounded-xl p-2 shadow-lg ring-1 ring-white/20">
                    <img src={card.qrCode} alt="QR" className="h-[64px] w-[64px] rounded-sm" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={handleDownload} className="flex-1 gap-2">
              <Download className="h-4 w-4" /> Download Card
            </Button>
            <Button variant="outline" onClick={handleShare} className="flex-1 gap-2">
              <Share2 className="h-4 w-4" /> Share Link
            </Button>
          </div>

          {/* Quick actions */}
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
    <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
      <CardContent />
    </Suspense>
  )
}
