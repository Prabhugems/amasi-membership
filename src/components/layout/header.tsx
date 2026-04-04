"use client"

import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useRouter, usePathname } from "next/navigation"
import { useState } from "react"

const PUBLIC_ROUTES = ["/apply", "/member", "/verify", "/support", "/card", "/login"]

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [query, setQuery] = useState("")

  if (PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + "/"))) return null

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`)
      setQuery("")
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-card px-6">
      <div className="flex-1">
        <form onSubmit={handleSearch} className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by email or phone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </form>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
          <span className="text-primary-foreground text-xs font-bold">P</span>
        </div>
      </div>
    </header>
  )
}
