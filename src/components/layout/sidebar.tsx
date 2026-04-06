"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/providers/sidebar-provider"
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  BarChart3,
  Search,
  Menu,
  X,
  UserPlus,
  FileSearch,
  Ticket,
  Headphones,
  LogIn,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  LogOut,
  ArrowUpCircle,
  Bell,
  Shield,
  ScrollText,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"

interface NavItem {
  name: string
  href: string
  icon: typeof LayoutDashboard
  badgeKey?: "pending" | "tickets" | "upgrades"
  superAdminOnly?: boolean
}

interface NavSection {
  label: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    label: "Admin",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "All Members", href: "/members", icon: Users },
      { name: "Pending Actions", href: "/pending", icon: ClipboardCheck, badgeKey: "pending" },
      { name: "Search Member", href: "/search", icon: Search },
      { name: "Reports", href: "/reports", icon: BarChart3 },
      { name: "Upgrades", href: "/upgrades", icon: ArrowUpCircle, badgeKey: "upgrades" as const },
      { name: "Support Tickets", href: "/tickets", icon: Ticket, badgeKey: "tickets" },
      { name: "Notifications", href: "/notifications", icon: Bell },
      { name: "Activity Log", href: "/audit", icon: ScrollText },
      { name: "Admin Users", href: "/admin", icon: Shield, superAdminOnly: true },
    ],
  },
  {
    label: "Membership",
    items: [
      { name: "Apply", href: "/apply", icon: UserPlus },
      { name: "Track Status", href: "/apply/status", icon: FileSearch },
      { name: "Member Login", href: "/member", icon: LogIn },
      { name: "Support", href: "/support", icon: Headphones },
    ],
  },
]

function useAdminRole() {
  const [adminRole, setAdminRole] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated && data.user?.adminRole) {
          setAdminRole(data.user.adminRole)
        }
      })
      .catch(() => {})
  }, [])

  return adminRole
}

function useBadgeCounts() {
  const [counts, setCounts] = useState<{ pending: number; tickets: number; upgrades: number }>({
    pending: 0,
    tickets: 0,
    upgrades: 0,
  })

  useEffect(() => {
    let cancelled = false

    async function fetchCounts() {
      try {
        const [dashRes, ticketsRes, upgradesRes] = await Promise.all([
          fetch("/api/dashboard").then((r) => r.json()).catch(() => null),
          fetch("/api/tickets?all=1").then((r) => r.json()).catch(() => null),
          fetch("/api/members/upgrade?all=1").then((r) => r.json()).catch(() => null),
        ])

        if (cancelled) return

        const pending = dashRes?.data?.pendingApplicationsCount ?? 0
        const openTickets =
          (Array.isArray(ticketsRes) ? ticketsRes.filter((t: { status: string }) => t.status === "open").length : 0)
        const pendingUpgrades =
          (Array.isArray(upgradesRes) ? upgradesRes.filter((u: { status: string }) => u.status === "pending_review" || u.status === "pending").length : 0)

        setCounts({ pending, tickets: openTickets, upgrades: pendingUpgrades })
      } catch {
        // silently fail — badges just show 0
      }
    }

    fetchCounts()
    // Refresh every 60 seconds
    const interval = setInterval(fetchCounts, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return counts
}

export function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { collapsed, toggle } = useSidebar()
  const counts = useBadgeCounts()
  const router = useRouter()
  const adminRole = useAdminRole()
  const isSuperAdmin = adminRole === "super_admin"

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  const publicRoutes = ["/apply", "/member", "/verify", "/support", "/card", "/login"]
  const isPublicPage = publicRoutes.some(r => pathname === r || pathname.startsWith(r + "/"))
  if (isPublicPage) return null

  return (
    <>
      {/* Mobile menu button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-card border shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        data-sidebar
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r bg-card flex flex-col transition-all duration-200 lg:translate-x-0",
          collapsed ? "lg:w-16 w-64" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo / brand */}
        <div className="flex h-16 items-center gap-3 border-b px-4 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-bold text-sm">A</span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="font-semibold text-sm leading-tight">AMASI</h1>
              <p className="text-xs text-muted-foreground truncate">Membership Management</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1 p-3 overflow-y-auto flex-1">
          {sections.map((section, idx) => (
            <div key={section.label}>
              {idx > 0 && <div className="my-3 border-t" />}
              {!collapsed && (
                <p className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                  {section.label}
                </p>
              )}
              {collapsed && idx > 0 && null}
              {section.items.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => {
                const isActive = pathname === item.href
                const badgeCount = item.badgeKey ? counts[item.badgeKey] : 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.name : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
                      collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {/* Active indicator bar */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-primary-foreground" />
                    )}
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="truncate flex-1">{item.name}</span>
                        {badgeCount > 0 && (
                          <span className={cn(
                            "ml-auto text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5",
                            isActive
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-primary/10 text-primary"
                          )}>
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        )}
                      </>
                    )}
                    {/* Badge dot in collapsed mode */}
                    {collapsed && badgeCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Logout + Footer */}
        <div className={cn("border-t px-4 py-3 shrink-0", collapsed && "px-2")}>
          {!collapsed ? (
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors mb-3"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign Out
            </button>
          ) : (
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors mb-3 mx-auto block"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
          {!collapsed ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">AMASI v1.0</p>
                <a
                  href="https://www.amasi.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
                >
                  www.amasi.org
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
              <button
                onClick={toggle}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={toggle}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
