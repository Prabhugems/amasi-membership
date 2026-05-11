"use client"

import Link from "next/link"
import { Search, UserPlus, FileSearch, Users, LogIn, Headphones, Menu, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { FocusToggle } from "@/components/focus/focus-toggle"
import { useRouter, usePathname } from "next/navigation"
import { useState } from "react"
import { useAdminRole } from "@/hooks/use-admin-role"
import { cn } from "@/lib/utils"

const PUBLIC_ROUTES = ["/apply", "/member", "/verify", "/support", "/card", "/login"]
const NO_SEARCH_ROUTES = ["/reports", "/admin", "/audit", "/notifications", "/upgrades"]

const PUBLIC_NAV_ITEMS = [
  { href: "/apply", label: "Apply", icon: UserPlus },
  { href: "/apply/status", label: "Track Status", icon: FileSearch },
  { href: "/membership", label: "Know Your Membership", icon: Search },
  { href: "/directory", label: "Directory", icon: Users },
  { href: "/member", label: "Member Login", icon: LogIn },
  { href: "/support", label: "Support", icon: Headphones },
]

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const adminRole = useAdminRole()
  const [query, setQuery] = useState("")
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Pages with their own standalone layout — render no header at all.
  if (PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + "/"))) return null

  if (adminRole === null) {
    return (
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="flex h-16 items-center gap-4 px-6">
          <Link href="/apply" className="flex items-center gap-2 shrink-0" aria-label="AMASI home">
            <span className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">A</span>
            </span>
            <span className="font-semibold text-sm hidden sm:inline">AMASI</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {PUBLIC_NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="flex-1 md:flex-none" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              className="md:hidden p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileNavOpen}
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {mobileNavOpen && (
          <nav className="md:hidden border-t bg-card px-4 py-2 flex flex-col gap-1">
            {PUBLIC_NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        )}
      </header>
    )
  }

  const showSearch = !NO_SEARCH_ROUTES.some(r => pathname === r || pathname.startsWith(r + "/"))

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
        {showSearch && (
          <form onSubmit={handleSearch} className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by email or phone..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </form>
        )}
      </div>
      <div className="flex items-center gap-2">
        <FocusToggle />
        <ThemeToggle />
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
          <span className="text-primary-foreground text-xs font-bold">P</span>
        </div>
      </div>
    </header>
  )
}
