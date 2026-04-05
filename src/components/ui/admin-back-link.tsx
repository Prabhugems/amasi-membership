"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft, LayoutDashboard } from "lucide-react"

export function AdminBackLink() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.authenticated) setIsAdmin(true) })
      .catch(() => {})
  }, [])

  if (!isAdmin) return null

  return (
    <div className="fixed top-4 left-4 z-[60]">
      <Link
        href="/"
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border shadow-md text-sm font-medium text-muted-foreground hover:text-foreground hover:shadow-lg transition-all"
      >
        <LayoutDashboard className="h-4 w-4" />
        Dashboard
      </Link>
    </div>
  )
}
