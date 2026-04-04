"use client"

import { Suspense, useState, useRef, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  CheckCircle,
  XCircle,
  Shield,
  ShieldCheck,
  Search,
  Loader2,
  Share2,
  Printer,
  QrCode,
  Phone,
  GraduationCap,
  MapPin,
  Calendar,
  Users,
  ExternalLink,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function VerifyContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const idParam = searchParams.get("id") || ""
  const [query, setQuery] = useState(idParam)
  const [searchId, setSearchId] = useState(idParam)
  const printRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["verify", searchId],
    queryFn: async () => {
      if (!searchId) return null
      const res = await fetch(`/api/card?id=${searchId}`)
      return res.json()
    },
    enabled: !!searchId,
  })

  const card = data?.card

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = query.trim().replace(/^AMASI-?/i, "")
      if (!trimmed) return
      setSearchId(trimmed)
      router.replace(`/verify?id=${encodeURIComponent(trimmed)}`)
    },
    [query, router]
  )

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/verify?id=${searchId}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: "AMASI Membership Verification",
          text: `Verified AMASI Member - ${card?.name}`,
          url,
        })
      } catch {
        // user cancelled
      }
    } else {
      await navigator.clipboard.writeText(url)
      alert("Verification link copied to clipboard")
    }
  }, [searchId, card?.name])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  return (
    <div className="min-h-[80vh] flex flex-col">
      {/* Hero header */}
      <div className="text-center pt-6 pb-8 space-y-4">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Official Membership Verification
          </h2>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base max-w-md mx-auto">
            Verify the membership status of an AMASI-registered surgeon
          </p>
        </div>

        {/* Trust indicators */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-full px-3 py-1.5">
            <Shield className="h-3.5 w-3.5 text-primary" />
            Verified by AMASI
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-full px-3 py-1.5">
            <Users className="h-3.5 w-3.5 text-primary" />
            3,500+ Active Members
          </div>
        </div>
      </div>

      {/* Search form */}
      <div className="max-w-lg mx-auto w-full px-2">
        <form onSubmit={handleSearch} className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Enter AMASI Number (e.g. 1234)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 h-12 text-base rounded-xl border-2 focus-visible:ring-primary/20 focus-visible:border-primary"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="h-12 px-6 rounded-xl font-semibold"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Verify"
              )}
            </Button>
          </div>
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              type="button"
              onClick={() => {
                alert(
                  "To scan a QR code:\n\n1. Open your phone camera\n2. Point it at the AMASI membership card QR code\n3. Tap the link that appears to verify automatically"
                )
              }}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              <QrCode className="h-3.5 w-3.5" />
              Scan QR Code
            </button>
            <span className="text-muted-foreground/40">|</span>
            <a
              href="https://www.amasi.org/contact"
              target="_blank"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <Phone className="h-3.5 w-3.5" />
              Contact Support
            </a>
          </div>
        </form>
      </div>

      {/* Loading state */}
      {isLoading && searchId && (
        <div className="max-w-md mx-auto py-16 text-center">
          <div className="relative mx-auto w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <ShieldCheck className="absolute inset-0 m-auto h-6 w-6 text-primary/60" />
          </div>
          <p className="text-muted-foreground mt-4 text-sm">Verifying membership...</p>
        </div>
      )}

      {/* Not found state */}
      {!isLoading && searchId && data && !card && (
        <div className="max-w-md mx-auto py-12 text-center space-y-4">
          <div className="mx-auto w-20 h-20 rounded-full bg-red-50 border-2 border-red-100 flex items-center justify-center">
            <XCircle className="h-10 w-10 text-red-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-red-700">Member Not Found</h3>
            <p className="text-muted-foreground mt-2 text-sm max-w-sm mx-auto">
              This number does not match any active AMASI member. Please check the
              number and try again.
            </p>
          </div>
          <div className="pt-2">
            <a
              href="https://www.amasi.org/contact"
              target="_blank"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              Contact AMASI Support
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Verified member result */}
      {!isLoading && card && (
        <div ref={printRef} className="max-w-lg mx-auto w-full py-8 space-y-5 px-2">
          {/* Verified badge with animation */}
          <div className="text-center space-y-3">
            <div className="relative mx-auto w-20 h-20">
              <div className="absolute inset-0 rounded-full bg-green-100 animate-ping opacity-20" />
              <div className="relative w-20 h-20 rounded-full bg-green-50 border-2 border-green-200 flex items-center justify-center shadow-sm">
                <ShieldCheck className="h-10 w-10 text-green-600" />
              </div>
            </div>
            <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-6 py-2.5 shadow-sm">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="font-bold text-green-800 text-sm tracking-wide">
                Verified AMASI Member
              </span>
            </div>
          </div>

          {/* Member card */}
          <Card className="border-green-200/60 shadow-lg overflow-hidden">
            {/* Green accent bar */}
            <div className="h-1.5 bg-gradient-to-r from-green-500 via-primary to-green-500" />
            <CardContent className="pt-6 pb-5">
              {/* Photo and name */}
              <div className="text-center mb-6">
                {card.profilePhoto ? (
                  <img
                    src={card.profilePhoto}
                    alt=""
                    className="h-24 w-24 rounded-full object-cover mx-auto border-4 border-green-100 shadow-md"
                  />
                ) : (
                  <div className="h-24 w-24 rounded-full bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center mx-auto text-3xl font-bold text-green-700 border-4 border-green-100 shadow-md">
                    {card.name?.charAt(0)}
                  </div>
                )}
                <h3 className="text-xl font-bold mt-4">
                  {card.salutation} {card.name}
                </h3>
                <p className="text-sm font-mono font-semibold text-primary mt-1">
                  AMASI-{String(card.amasiNumber).padStart(5, "0")}
                </p>
                <div className="flex justify-center gap-2 mt-3">
                  <Badge className="bg-green-600 shadow-sm">
                    {card.membershipLabel}
                  </Badge>
                  {card.votingEligible && (
                    <Badge
                      variant="outline"
                      className="text-green-600 border-green-300"
                    >
                      Voting Rights
                    </Badge>
                  )}
                </div>
              </div>

              {/* Membership status */}
              <div className="bg-green-50/50 rounded-xl p-4 mb-5 border border-green-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-semibold text-green-800">
                      Active Member
                    </span>
                  </div>
                  <span className="text-xs text-green-600">
                    Since{" "}
                    {new Date(card.joiningDate).toLocaleDateString("en-IN", {
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>

              {/* Details */}
              <div className="divide-y text-sm">
                {card.pgDegree && (
                  <div className="flex items-center gap-3 py-3">
                    <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Qualification</span>
                    <span className="font-medium ml-auto text-right">
                      {card.pgDegree}
                    </span>
                  </div>
                )}
                {card.mciNumber && (
                  <div className="flex items-center gap-3 py-3">
                    <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">MCI/Council No.</span>
                    <span className="font-medium ml-auto">{card.mciNumber}</span>
                  </div>
                )}
                {card.state && (
                  <div className="flex items-center gap-3 py-3">
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium ml-auto">
                      {card.state}
                      {card.zone ? ` (${card.zone})` : ""}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3 py-3">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Member Since</span>
                  <span className="font-medium ml-auto">
                    {new Date(card.joiningDate).getFullYear()}
                  </span>
                </div>
              </div>

              {/* QR code */}
              {card.qrCode && (
                <div className="mt-5 pt-5 border-t flex items-center gap-4">
                  <img
                    src={card.qrCode}
                    alt="Verification QR Code"
                    className="w-20 h-20 rounded-lg border"
                  />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">
                      Scan to Verify
                    </p>
                    <p>
                      Scan this QR code to verify this member&apos;s credentials
                      on the official AMASI portal.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="flex gap-3 justify-center print:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              className="rounded-lg gap-2"
            >
              <Share2 className="h-4 w-4" />
              Share Verification
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="rounded-lg gap-2"
            >
              <Printer className="h-4 w-4" />
              Print Certificate
            </Button>
          </div>

          {/* Footer trust badge */}
          <div className="text-center pt-2 print:pt-6">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-full px-4 py-2">
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span>
                Verified by AMASI -- Association of Minimal Access Surgeons of
                India
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Empty state when no search yet */}
      {!searchId && !isLoading && (
        <div className="max-w-md mx-auto py-12 text-center space-y-6 px-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="space-y-2">
              <div className="mx-auto w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center">
                <Search className="h-5 w-5 text-primary/60" />
              </div>
              <p className="text-xs text-muted-foreground">
                Enter member number
              </p>
            </div>
            <div className="space-y-2">
              <div className="mx-auto w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-primary/60" />
              </div>
              <p className="text-xs text-muted-foreground">
                Instant verification
              </p>
            </div>
            <div className="space-y-2">
              <div className="mx-auto w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-primary/60" />
              </div>
              <p className="text-xs text-muted-foreground">
                View credentials
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground mt-4">Loading...</p>
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  )
}
