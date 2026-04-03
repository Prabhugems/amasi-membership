"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle, XCircle, Shield, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

function VerifyContent() {
  const searchParams = useSearchParams()
  const id = searchParams.get("id")

  const { data, isLoading } = useQuery({
    queryKey: ["verify", id],
    queryFn: async () => {
      if (!id) return null
      const res = await fetch(`/api/card?id=${id}`)
      return res.json()
    },
    enabled: !!id,
  })

  if (!id) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="mx-auto w-20 h-20 rounded-full bg-muted flex items-center justify-center">
          <Shield className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">Membership Verification</h2>
        <p className="text-muted-foreground">Scan a QR code from an AMASI membership card to verify.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Verifying membership...</p>
      </div>
    )
  }

  const card = data?.card

  if (!card) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="mx-auto w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
          <XCircle className="h-10 w-10 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-red-700">Not Verified</h2>
        <p className="text-muted-foreground">
          No active AMASI membership found for #{id}. This membership may be inactive or invalid.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto py-8 space-y-6">
      {/* Verified badge */}
      <div className="text-center space-y-4">
        <div className="mx-auto w-20 h-20 rounded-full bg-green-50 border-2 border-green-200 flex items-center justify-center shadow-sm">
          <ShieldCheck className="h-10 w-10 text-green-600" />
        </div>
        <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-6 py-2.5">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="font-bold text-green-800 text-sm tracking-wide">Verified AMASI Member</span>
        </div>
      </div>

      {/* Member details */}
      <Card className="border-green-200 shadow-md">
        <CardContent className="pt-6">
          <div className="text-center mb-5">
            {card.profilePhoto ? (
              <img src={card.profilePhoto} alt="" className="h-24 w-24 rounded-full object-cover mx-auto border-4 border-green-100 shadow-sm" />
            ) : (
              <div className="h-24 w-24 rounded-full bg-green-50 flex items-center justify-center mx-auto text-3xl font-bold text-green-700 border-4 border-green-100">
                {card.name?.charAt(0)}
              </div>
            )}
            <h3 className="text-xl font-bold mt-4">{card.salutation} {card.name}</h3>
            <p className="text-sm font-mono font-semibold text-green-700 mt-1">AMASI-{String(card.amasiNumber).padStart(5, "0")}</p>
            <div className="flex justify-center gap-2 mt-3">
              <Badge className="bg-green-600">{card.membershipLabel}</Badge>
              {card.votingEligible && <Badge variant="outline" className="text-green-600 border-green-300">Voting Rights</Badge>}
            </div>
          </div>

          <div className="divide-y text-sm">
            {card.pgDegree && (
              <div className="flex justify-between py-2.5">
                <span className="text-muted-foreground">Qualification</span>
                <span className="font-medium">{card.pgDegree}</span>
              </div>
            )}
            {card.mciNumber && (
              <div className="flex justify-between py-2.5">
                <span className="text-muted-foreground">MCI/Council No.</span>
                <span className="font-medium">{card.mciNumber}</span>
              </div>
            )}
            {card.state && (
              <div className="flex justify-between py-2.5">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium">{card.state}{card.zone ? ` (${card.zone})` : ""}</span>
              </div>
            )}
            <div className="flex justify-between py-2.5">
              <span className="text-muted-foreground">Member Since</span>
              <span className="font-medium">{new Date(card.joiningDate).getFullYear()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-center pt-2">
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-full px-4 py-2">
          <Shield className="h-3.5 w-3.5" />
          <span>Verified by AMASI -- Association of Minimal Access Surgeons of India</span>
        </div>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Verifying...</div>}>
      <VerifyContent />
    </Suspense>
  )
}
