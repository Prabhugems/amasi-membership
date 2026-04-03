"use client"

import { useState } from "react"
import { Search, UserCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface ProfileIdentifyProps {
  onFound: (member: any) => void
  isLoading: boolean
  error: string | null
}

export function ProfileIdentify({ onFound, isLoading, error }: ProfileIdentifyProps) {
  const [query, setQuery] = useState("")

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    try {
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (data.status && data.data?.length > 0) {
        onFound(data.data[0])
      } else {
        onFound(null)
      }
    } catch {
      onFound(null)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <UserCircle className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">My Profile</h2>
        <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
          Enter your email address, phone number, or AMASI membership number to access your profile
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 pb-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Email, phone, or AMASI number..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            <Button type="submit" disabled={isLoading || !query.trim()} className="w-full h-11 font-semibold">
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Searching...
                </span>
              ) : (
                "Find My Profile"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive text-center">{error}</p>
        </div>
      )}

      <p className="text-xs text-center text-muted-foreground">
        Your identity will be verified via OTP before any changes can be saved.
      </p>
    </div>
  )
}
