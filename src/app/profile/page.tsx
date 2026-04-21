"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle, ArrowLeft, Users, Search } from "lucide-react"
import { HelpButton } from "@/components/ui/help-button"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ProfileIdentify } from "@/components/profile/profile-identify"
import { ProfileView } from "@/components/profile/profile-view"
import { ProfileEditForm } from "@/components/profile/profile-edit-form"
import { ProfileReview } from "@/components/profile/profile-review"
import { ProfileOtp } from "@/components/profile/profile-otp"
import { dbToFormData, computeDiff, formChangesToDb } from "@/lib/profile-mapper"
import type { ProfileFormData, ChangeEntry } from "@/lib/profile-mapper"

type Phase = "identify" | "otp" | "view" | "edit" | "review" | "success"

function ProfileContent() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const [phase, setPhase] = useState<Phase>(initialQuery ? "identify" : "identify")
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null) // null = checking
  const [rawMember, setRawMember] = useState<any>(null)
  const [originalData, setOriginalData] = useState<ProfileFormData | null>(null)
  const [formData, setFormData] = useState<ProfileFormData | null>(null)
  const [changes, setChanges] = useState<ChangeEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(!!initialQuery) // start loading if auto-search
  const [isSaving, setIsSaving] = useState(false)

  // Check if admin is logged in — skip OTP if so
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setIsAdmin(!!d.authenticated))
      .catch(() => setIsAdmin(false))
  }, [])

  // Auto-search if ?q= param is provided — wait for admin check to finish first
  useEffect(() => {
    if (isAdmin === null) return // still checking admin status
    if (initialQuery && phase === "identify") {
      setIsLoading(true)
      fetch(`/api/members/search?q=${encodeURIComponent(initialQuery)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.status && d.data?.[0]) handleMemberFound(d.data[0])
          else setError("No member found for that query.")
        })
        .catch(() => setError("Search failed. Please try again."))
        .finally(() => setIsLoading(false))
    }
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMemberFound = (member: any) => {
    if (!member) {
      setError("No member found. Please check your email, phone, or membership number.")
      return
    }
    setError(null)
    setRawMember(member)
    // Convert the raw DB row (spread in API response) to form data
    const mapped = dbToFormData(member)
    setOriginalData(mapped)
    setFormData({ ...mapped })
    setPhase(isAdmin === true ? "view" : "otp")
  }

  const handleEdit = () => {
    setPhase("edit")
  }

  const handleReview = () => {
    if (!originalData || !formData) return
    const diff = computeDiff(originalData, formData)
    if (diff.length === 0) {
      setError("No changes to save.")
      return
    }
    setError(null)
    setChanges(diff)
    setPhase("review")
  }

  const handleSave = async () => {
    if (!originalData || !formData) return
    setIsSaving(true)
    setError(null)

    try {
      const dbChanges = formChangesToDb(originalData, formData)
      const memberId = formData.id

      const res = await fetch(`/api/members/${encodeURIComponent(memberId)}/update`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: dbChanges }),
      })

      const result = await res.json()
      if (result.status) {
        setPhase("success")
      } else {
        setError(result.message || "Failed to save changes")
      }
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleStartOver = () => {
    setPhase("identify")
    setRawMember(null)
    setOriginalData(null)
    setFormData(null)
    setChanges([])
    setError(null)
  }

  return (
    <div className="space-y-6">
      {/* Navigation bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 -mt-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
          <span className="text-border">|</span>
          <Link href="/members" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Users className="h-3.5 w-3.5" />
            Members
          </Link>
          <span className="text-border">|</span>
          <Link href="/search" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Search className="h-3.5 w-3.5" />
            Search
          </Link>
        </div>
        {formData && phase !== "identify" && (
          <Button variant="outline" size="sm" onClick={handleStartOver} className="text-xs">
            Search Another Member
          </Button>
        )}
      </div>

      {phase === "identify" && (
        <ProfileIdentify
          onFound={handleMemberFound}
          isLoading={isLoading}
          error={error}
        />
      )}

      {phase === "otp" && formData && (
        <ProfileOtp
          email={formData.email}
          onVerified={() => setPhase("view")}
          onBack={handleStartOver}
        />
      )}

      {phase === "view" && formData && (
        <ProfileView data={formData} onEdit={handleEdit} />
      )}

      {phase === "edit" && formData && (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <ProfileEditForm
            data={formData}
            onChange={setFormData}
            onSave={handleReview}
            onCancel={() => {
              setFormData(originalData ? { ...originalData } : null)
              setError(null)
              setPhase("view")
            }}
            isAdmin={isAdmin ?? false}
          />
        </>
      )}

      {phase === "review" && (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <ProfileReview
            changes={changes}
            onConfirm={handleSave}
            onBack={() => setPhase("edit")}
            isSaving={isSaving}
          />
        </>
      )}

      {phase === "success" && (
        <div className="mx-auto max-w-lg text-center space-y-4 py-12">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
          <h2 className="text-2xl font-bold">Profile Updated</h2>
          <p className="text-muted-foreground">
            Your profile has been updated successfully. Changes will be reflected across all AMASI services.
          </p>
          <div className="flex justify-center gap-3 pt-4">
            <Button variant="outline" onClick={handleStartOver}>Search Another</Button>
            <Button onClick={() => {
              // Reload the updated member data
              setPhase("identify")
              setTimeout(() => {
                if (formData) {
                  fetch(`/api/members/search?q=${encodeURIComponent(formData.email)}`)
                    .then((r) => r.json())
                    .then((d) => {
                      if (d.status && d.data?.[0]) handleMemberFound(d.data[0])
                    })
                }
              }, 100)
            }}>View Updated Profile</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProfilePage() {
  return (
    <>
      <Suspense fallback={<div className="p-6">Loading...</div>}>
        <ProfileContent />
      </Suspense>
      <HelpButton />
    </>
  )
}
